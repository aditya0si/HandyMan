"""SPIKE 1 (M11): re-confirm the two probe-gate facts against the LIVE app
with the backend DOWN:
  (a) new WebSocket('ws://localhost:4001')     -> native console [error]
  (b) fetch('http://localhost:4000/api/health', {mode:'no-cors'}).catch(()=>{})
                                                -> NOTHING logged
Delete after; evidence pasted into the report."""
from playwright.sync_api import sync_playwright

APP_URL = "http://localhost:5173"

JS_WS = """() => {
  const ws = new WebSocket('ws://localhost:4001');
  ws.onopen = () => {};
  ws.onerror = () => {};
  ws.onclose = () => {};
}"""

JS_FETCH = """() => fetch('http://localhost:4000/api/health', {mode:'no-cors'}).catch(() => {})"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, js in [("ws", JS_WS), ("fetch", JS_FETCH)]:
        page = browser.new_page()
        lines = []
        page.on("console", lambda m: lines.append(f"[{m.type}] {m.text}"))
        page.goto(APP_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        try:
            page.evaluate(js)
        except Exception as e:  # noqa: BLE001
            print(f"{name}: evaluate threw {e}")
        page.wait_for_timeout(2500)
        errs = [l for l in lines if l.startswith("[error]")]
        print(f"=== {name}: [error] lines = {len(errs)} ===")
        for l in errs:
            print(f"    {l}")
        page.close()
    browser.close()