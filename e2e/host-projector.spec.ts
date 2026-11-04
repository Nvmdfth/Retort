import { test, expect } from '@playwright/test';

test.describe('Dual-Mode TV / Projector Host Route', () => {
  test('Renders 1080p widescreen host dashboard with room code and live sync', async ({ browser }) => {
    // 1. Phone creates room
    const phoneContext = await browser.newContext();
    const phonePage = await phoneContext.newPage();

    await phonePage.goto('/');
    await phonePage.getByRole('button', { name: 'Create Room' }).first().click();
    await phonePage.getByPlaceholder('e.g. Quipster').fill('TVHostUser');
    await phonePage.getByRole('button', { name: 'Create Room' }).last().click();

    await phonePage.waitForURL(/\/room\/[A-Z0-9]{4}/);
    const roomCodeMatch = phonePage.url().match(/\/room\/([A-Z0-9]{4})/);
    const roomCode = roomCodeMatch![1];

    // 2. Open TV Host View in a separate 1080p browser context
    const tvContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const tvPage = await tvContext.newPage();

    const tvHref = await phonePage.getByRole('link', { name: /Projector \/ TV View/ }).getAttribute('href');
    await tvPage.goto(tvHref!);

    // Verify TV UI elements
    await expect(tvPage.getByText('RETORT', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(tvPage.getByText(roomCode).first()).toBeVisible();
    await expect(tvPage.getByText('Join with your phone')).toBeVisible();
    await expect(tvPage.getByText('TVHostUser')).toBeVisible();
    await expect(tvPage.getByText('1 Connected')).toBeVisible();

    await phoneContext.close();
    await tvContext.close();
  });
});
