import { test, expect } from '@playwright/test';

test.describe('Landing & Lobby Navigation', () => {
  test('renders mobile landing UI with branding and controls', async ({ page }) => {
    await page.goto('/');

    // Check title and branding
    await expect(page).toHaveTitle(/Retort/i);
    const brand = page.locator('text=RETORT');
    await expect(brand).toBeVisible();

    // Default mode is Join Room
    const joinTab = page.getByRole('button', { name: 'Join Room' });
    const createTab = page.getByRole('button', { name: 'Create Room' });
    await expect(joinTab).toBeVisible();
    await expect(createTab).toBeVisible();

    // Verify inputs for Join mode
    const roomCodeInput = page.getByPlaceholder('e.g. ABCD');
    const nicknameInput = page.getByPlaceholder('e.g. Quipster');
    await expect(roomCodeInput).toBeVisible();
    await expect(nicknameInput).toBeVisible();

    // Switch to Create mode
    await createTab.click();
    await expect(page.getByRole('button', { name: 'Create Room', exact: true }).last()).toBeVisible();
    await expect(roomCodeInput).toBeHidden();

    // Switch back to Join mode
    await joinTab.click();
    await expect(roomCodeInput).toBeVisible();
  });

  test('pre-fills room code from URL query parameter', async ({ page }) => {
    await page.goto('/?code=RETX');

    const roomCodeInput = page.getByPlaceholder('e.g. ABCD');
    await expect(roomCodeInput).toHaveValue('RETX');
  });

  test('enforces 4-letter uppercase code formatting', async ({ page }) => {
    await page.goto('/');
    const roomCodeInput = page.getByPlaceholder('e.g. ABCD');

    // Type lowercase letters
    await roomCodeInput.fill('abcd');
    await expect(roomCodeInput).toHaveValue('ABCD');
  });
});
