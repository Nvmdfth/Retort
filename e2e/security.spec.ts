import { test, expect } from '@playwright/test';

test.describe('OWASP XSS & Client-Side Security Hardening', () => {
  test('Sanitizes and safely renders XSS payloads in nicknames without executing script', async ({ page }) => {
    let alertTriggered = false;
    page.on('dialog', (dialog) => {
      alertTriggered = true;
      dialog.dismiss();
    });

    await page.goto('/');

    // 16-character payload fitting within the input's maxLength={16} boundary
    const xssPayload = '<svg/onload=a()>';
    await page.getByRole('button', { name: 'Create Room' }).first().click();
    await page.getByPlaceholder('e.g. Quipster').fill(xssPayload);
    await page.locator('form button[type="submit"]').click();

    // Wait for room to be created and redirect to /room/[CODE]
    await page.waitForURL(/\/room\/[A-Z0-9]{4}/);

    // Verify nickname is rendered safely as escaped text
    const playerEntry = page.getByText(xssPayload);
    await expect(playerEntry).toBeVisible();

    // Verify that NO JavaScript alert was triggered
    expect(alertTriggered).toBe(false);
  });

  test('Enforces client-side max length attributes to prevent DOM buffer bloat', async ({ page }) => {
    await page.goto('/');

    const nicknameInput = page.getByPlaceholder('e.g. Quipster');
    await expect(nicknameInput).toHaveAttribute('maxlength', '16');

    const roomCodeInput = page.getByPlaceholder('e.g. ABCD');
    await expect(roomCodeInput).toHaveAttribute('maxlength', '4');

    // Attempt to paste 1,000 characters
    await nicknameInput.fill('A'.repeat(1000));
    const val = await nicknameInput.inputValue();
    expect(val.length).toBeLessThanOrEqual(16);
  });
});
