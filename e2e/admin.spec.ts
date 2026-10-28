import { test, expect } from '@playwright/test';

test.describe('Admin Command Center & Silent Supervision', () => {
  test('authenticates admin and displays silent observation dashboard', async ({ page }) => {
    await page.goto('/admin');

    // Login Gate
    await expect(page.getByText('Admin Command Center')).toBeVisible();
    await expect(page.getByText('Silent real-time game telemetry')).toBeVisible();

    const secretInput = page.locator('input[type="password"]');
    await secretInput.fill('RetortAdmin');
    await page.getByRole('button', { name: /Authorize Access/i }).click();

    // Authenticated Dashboard
    await expect(page.getByText('Silent Observer Active')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Game Supervision & Room Management')).toBeVisible();
    await expect(page.getByText('Active Rooms')).toBeVisible();
    await expect(page.getByText('Connected Players')).toBeVisible();
    await expect(page.getByText('Zero Player Notification')).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh Rooms/i })).toBeVisible();
  });

  test('rejects incorrect admin secret key with error toast', async ({ page }) => {
    await page.goto('/admin');
    const secretInput = page.locator('input[type="password"]');
    await secretInput.fill('invalid-secret-key-123');
    await page.getByRole('button', { name: /Authorize Access/i }).click();

    await expect(page.getByText('Invalid admin credentials')).toBeVisible();
  });
});
