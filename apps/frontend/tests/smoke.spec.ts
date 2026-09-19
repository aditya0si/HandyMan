import { test, expect } from '@playwright/test';

test.describe('JARVIS Smoke Tests', () => {
  test('boots and shows HUD with camera running', async ({ page }) => {
    await page.goto('/');

    // HUD banner. The exact pin is the M15 title (two-tier policy in App.tsx:
    // verify_milestone15.py owns the exact string, older verifiers use the
    // version-tolerant 'JARVIS · Milestone' lookup).
    await expect(page.getByText('JARVIS · Milestone 15')).toBeVisible({ timeout: 10000 });

    // Boot scene: the unified Briefing window plus the five dashboard widgets
    // (utils/bootScene.ts BOOT_APP_IDS + WIDGET_IDS) — 6 windows total. The
    // old `getByText('Briefing')` was a strict-mode violation: it resolved to
    // the window title AND the briefing form's own labels/buttons.
    const windows = page.locator('[data-testid="floating-window"]');
    await expect(windows.filter({ hasText: 'Briefing' }).first()).toBeVisible();
    await expect(windows).toHaveCount(6);

    // Camera pipeline state comes from CameraCapture via the shared
    // CameraState contract ('starting' | 'active' | 'error' | 'unsupported').
    // 'active' is notified only after getUserMedia resolved AND video.play()
    // returned, i.e. the fake media device is really streaming. The old
    // assertion waited for the literal text 'running', which no CameraState
    // value ever produces, so it could never pass.
    await expect(page.locator('[data-testid="hud-camera"]')).toHaveText('active', {
      timeout: 15000,
    });

    // A camera failure renders the ErrorBanner instead of 'active' — assert it
    // did not appear (guards against a silent degrade to the error path).
    await expect(page.getByText('Camera unavailable')).toHaveCount(0);
  });

  test('gracefully handles missing backend (offline sync)', async ({ page }) => {
    // Override the sync URL to a dummy port to simulate backend down
    await page.route('**/api/health', (route) => route.abort('failed'));

    await page.goto('/');

    // The HUD should show offline sync status
    await expect(page.getByText('offline').first()).toBeVisible({ timeout: 5000 });

    // The workspace should still boot
    await expect(page.getByText('JARVIS · Milestone 15')).toBeVisible();
  });
});
