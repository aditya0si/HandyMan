"""Full M1-M15 verifier regression driver (self-managed processes).

Each verifier gets a FRESH, WARMED dev server on :5173 and a full port
cleanup before/after — the battle-tested model v15 already uses. This
eliminates three flake classes seen with a shared long-lived server on this
machine:
  - a dying/unresponsive shared server (vite would stall under many
    sequential Playwright browsers);
  - stale WebSocket users/builders carried between verifiers (the HUD showed
    Users 3 / Remote 1 in a run where it should be 1);
  - cold-compile races on the first navigation (the warm boot pre-compiles
    the whole module graph + downloads MediaPipe).

Notes:
- npx.cmd is a cmd SHIM: Popen(["npx.cmd","vite",...]) tracks the shim which
  exits right after spawning node, so poll() lies about the server. Vite is
  launched via its node bin directly (hoisted to the repo-root node_modules
  by npm workspaces) so the Popen handles the real server.
- Readiness is a REAL content check (#root), not a status code.
Output per verifier -> docs/screenshots/regression-vN.out; hashes printed.
"""
import hashlib
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent.parent
FE = REPO / "apps" / "frontend"
OUT = REPO / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
PY = sys.executable
VITE_BIN = REPO / "node_modules" / "vite" / "bin" / "vite.js"


def _listening_pids() -> set[str]:
    try:
        raw = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=20).stdout
    except Exception:  # noqa: BLE001
        return set()
    pids: set[str] = set()
    for line in raw.splitlines():
        if "LISTENING" in line and re.search(r"[:.]5173|[:.]4000|[:.]4001|[:.]4173", line):
            pids.add(line.split()[-1])
    return pids


def kill_port_listeners() -> None:
    for pid in _listening_pids():
        subprocess.run(["taskkill", "/PID", pid, "/F", "/T"],
                       capture_output=True, text=True)
    time.sleep(1)


def serves_root(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return '<div id="root">' in r.read().decode(errors="ignore")
    except Exception:  # noqa: BLE001 - not ready
        return False


def start_vite(log_path: Path) -> subprocess.Popen:
    log = open(log_path, "a", encoding="utf-8")
    proc = subprocess.Popen(
        ["node", str(VITE_BIN), "--port", "5173", "--strictPort"],
        cwd=str(FE), stdout=log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if serves_root("http://localhost:5173/"):
            return proc
        time.sleep(0.5)
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/F", "/T"],
                   capture_output=True, text=True)
    raise RuntimeError("vite dev server never served #root")


def stop_tree(proc: subprocess.Popen) -> None:
    if proc is None or proc.poll() is not None:
        return
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/F", "/T"],
                   capture_output=True, text=True)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def warm_dev(url: str) -> bool:
    """Boots once in a throwaway browser so the cold module compile + the
    MediaPipe WASM fetch land before the verifier's own boot wait."""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--use-fake-device-for-media-stream",
                    "--use-fake-ui-for-media-stream",
                    "--autoplay-policy=no-user-gesture-required",
                    "--mute-audio",
                ],
            )
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded")
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    ready = page.evaluate(
                        """() => ({
                          canvas: document.querySelectorAll('canvas').length,
                          hud: [...document.querySelectorAll('div')].some(
                            el => el.innerText &&
                                  el.innerText.includes('JARVIS · Milestone')),
                        })"""
                    )
                    if ready["canvas"] >= 1 and ready["hud"]:
                        return True
                except Exception:  # noqa: BLE001 - mid-navigation
                    pass
                page.wait_for_timeout(500)
            browser.close()
            return False
    except Exception:  # noqa: BLE001
        return False


def run_v(n: int) -> bool:
    out_path = OUT / f"regression-v{n}.out"
    try:
        result = subprocess.run(
            [PY, f"docs/scripts/verify_milestone{n}.py"],
            cwd=str(REPO), capture_output=True, text=True, timeout=420)
    except subprocess.TimeoutExpired:
        result = None
    with open(out_path, "w", encoding="utf-8") as fh:
        if result is not None:
            fh.write(result.stdout)
            if result.stderr:
                fh.write("\n--- stderr ---\n" + result.stderr)
            fh.write(f"\nEXIT {result.returncode}\n")
        else:
            fh.write("TIMEOUT after 420s\n")
    ok = result is not None and result.returncode == 0
    print(f"=== v{n} === {'PASS' if ok else 'FAIL'}"
          f" (exit {result.returncode if result else 'timeout'})", flush=True)
    return ok


def hash_out(n: int) -> str:
    return hashlib.sha256((OUT / f"regression-v{n}.out").read_bytes()).hexdigest()


def run_verifier(n: int, start_vite_for: bool) -> bool:
    """Runs one verifier against a fresh warmed dev server (v1-v13) or its
    own self-managed server (v14 preview, v15)."""
    dev = None
    try:
        kill_port_listeners()
        if start_vite_for:
            dev = start_vite(OUT / "regression-dev.log")
            ok_warm = warm_dev("http://localhost:5173/")
            print(f"v{n}: dev server warmed={ok_warm}", flush=True)
        return run_v(n)
    finally:
        if dev is not None:
            stop_tree(dev)
            dev = None
        kill_port_listeners()


def main() -> None:
    results: dict[int, bool] = {}
    try:
        kill_port_listeners()
        print("=== backend ports clean ===", flush=True)

        # v1-v13 each get their own warmed dev server on :5173.
        for n in range(1, 14):
            results[n] = run_verifier(n, start_vite_for=True)

        # v14 previews the PRODUCTION build (self-managed) and v15 self-manages
        # its own dev server + backend lifecycle; both need ports fully free.
        for n in (14, 15):
            results[n] = run_verifier(n, start_vite_for=False)

        print("\n=== HASH TABLE (sha256 of each verifier stdout) ===", flush=True)
        for n in range(1, 16):
            print(f"v{n:<3} {'PASS' if results[n] else 'FAIL'}  {hash_out(n)}", flush=True)
        print("\n=== REGRESSION " +
              ("ALL PASS" if all(results.values()) else "SOME FAILED") + " ===", flush=True)
    finally:
        kill_port_listeners()


if __name__ == "__main__":
    main()
