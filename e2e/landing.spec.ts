import { test, expect } from '@playwright/test';

test.describe('Landing & Lobby Navigation', () => {
  test('renders mobile landing UI with branding and controls', async ({ page }) => {
    await page.goto('/');

    // Check title and exact branding
    await expect(page).toHaveTitle(/Retort/i);
    const brand = page.locator('span.font-black', { hasText: 'RETORT' });
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
    const createSubmitBtn = page.locator('form button[type="submit"]');
    await expect(createSubmitBtn).toHaveText('Create Room');
    await expect(roomCodeInput).toBeHidden();

    // Switch back to Join mode
    await joinTab.click();
    await expect(roomCodeInput).toBeVisible();
  });

  test('pre-fills and uppercase transforms room code from URL query parameter', async ({ page }) => {
    await page.goto('/?code=retx');

    const roomCodeInput = page.getByPlaceholder('e.g. ABCD');
    await expect(roomCodeInput).toHaveValue('RETX');
  });

  test('enforces 4-letter uppercase code formatting and truncation', async ({ page }) => {
    await page.goto('/');
    const roomCodeInput = page.getByPlaceholder('e.g. ABCD');

    // Type lowercase and excess characters beyond 4 chars
    await roomCodeInput.fill('abcdefgh');
    // Truncates to 4 uppercase letters
    await expect(roomCodeInput).toHaveValue('ABCD');
  });

  test('displays error toast when attempting to join non-existent room', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('e.g. ABCD').fill('ZZZZ');
    await page.getByPlaceholder('e.g. Quipster').fill('Tester');
    await page.getByRole('button', { name: 'Join Game' }).click();

    // Expect server error toast
    const errorToast = page.getByText(/Room not found/i);
    await expect(errorToast).toBeVisible({ timeout: 5000 });
  });
});
