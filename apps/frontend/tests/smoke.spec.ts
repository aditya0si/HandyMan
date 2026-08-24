import { test, expect } from '@playwright/test';

test.describe('JARVIS Smoke Tests', () => {
  test('boots and shows HUD with camera running', async ({ page }) => {
    await page.goto('/');
    
    // HUD should eventually be visible
    const hud = page.locator('div', { hasText: 'JARVIS · Milestone 15' }).first();
    await expect(hud).toBeVisible({ timeout: 10000 });
    
    // Check for some default boot windows
    await expect(page.getByText('Briefing')).toBeVisible();
    
    // Check camera state becomes running (using fake media stream)
    await expect(page.locator('text=running').first()).toBeVisible({ timeout: 10000 });
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
