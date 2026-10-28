import { test, expect } from '@playwright/test';

test.describe('Real-Time Multiplayer Party Game Loop', () => {
  test('Two mobile players create, join, submit prompts, and vote', async ({ browser }) => {
    // 1. Create two isolated browser contexts simulating two separate mobile phones
    const phone1Context = await browser.newContext();
    const phone2Context = await browser.newContext();

    const page1 = await phone1Context.newPage();
    const page2 = await phone2Context.newPage();

    // 2. Player 1 creates a new room
    await page1.goto('/');
    await page1.getByRole('button', { name: 'Create Room' }).first().click();
    await page1.getByPlaceholder('e.g. Quipster').fill('HostAlice');
    await page1.getByRole('button', { name: 'Create Room' }).last().click();

    // Wait for redirect to /room/[CODE]
    await page1.waitForURL(/\/room\/[A-Z0-9]{4}/);
    const roomUrl = page1.url();
    const roomCodeMatch = roomUrl.match(/\/room\/([A-Z0-9]{4})/);
    expect(roomCodeMatch).toBeTruthy();
    const roomCode = roomCodeMatch![1];

    // Verify Player 1 is in Lobby as VIP Host
    await expect(page1.getByText('Room Code')).toBeVisible();
    await expect(page1.getByText('HostAlice')).toBeVisible();
    await expect(page1.getByText('VIP Host')).toBeVisible();

    // Start button should initially be disabled or say Waiting for Players (min 2)
    const startBtn = page1.getByRole('button', { name: /Waiting For Players|Start Game/i });
    await expect(startBtn).toBeVisible();

    // 3. Player 2 joins via the landing page using roomCode
    await page2.goto(`/?code=${roomCode}`);
    await page2.getByPlaceholder('e.g. Quipster').fill('PlayerBob');
    await page2.getByRole('button', { name: 'Join Game' }).click();

    await page2.waitForURL(/\/room\/[A-Z0-9]{4}/);

    // 4. Both players should see each other in the live lobby
    await expect(page1.getByText('PlayerBob')).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText('HostAlice')).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText('PlayerBob')).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText('(You)')).toBeVisible();

    // Player 2 should see waiting message
    await expect(page2.getByText(/Waiting for the host to start/i)).toBeVisible();

    // Player 1 should now have active "Start Game" button
    const activeStartBtn = page1.getByRole('button', { name: 'Start Game' });
    await expect(activeStartBtn).toBeEnabled();
    await activeStartBtn.click();

    // 5. Phase 1: Simultaneous Writing
    // Both players should transition into Writing phase
    await expect(page1.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });

    // Live lock-in checklist is visible
    await expect(page1.getByText('Room Submissions')).toBeVisible();
    await expect(page2.getByText('Room Submissions')).toBeVisible();

    // Player 1 fills answer for Prompt 1 and submits
    const textareaP1 = page1.getByPlaceholder('Type your punchline here...');
    await textareaP1.fill('A very funny joke from Alice');
    await page1.getByRole('button', { name: /Submit & Next Prompt/i }).click();

    // Player 1 fills Prompt 2 and locks in
    await page1.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible' });
    await textareaP1.fill('Another punchline from Alice');
    await page1.getByRole('button', { name: 'Lock In Punchline' }).click();

    // Verify Player 1 is locked in
    await expect(page1.getByText(/all locked in/i)).toBeVisible();

    // Player 2 uses the Safety Quip button for Prompt 1 and submits
    const textareaP2 = page2.getByPlaceholder('Type your punchline here...');
    const safetyQuipBtn = page2.getByRole('button', { name: /Safety Quip/i });
    await expect(safetyQuipBtn).toBeVisible();
    await safetyQuipBtn.click();
    await expect(textareaP2).not.toHaveValue('');
    await page2.getByRole('button', { name: /Submit & Next Prompt/i }).click();

    // Player 2 uses Safety Quip for Prompt 2 and locks in
    await page2.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible' });
    await safetyQuipBtn.click();
    await page2.getByRole('button', { name: 'Lock In Punchline' }).click();

    // 6. Phase 2: Head-to-Head Duel & Voting
    // Server auto-advances to duel phase
    await expect(page1.getByText(/Duel 1 of|Loading next duel|JINX/i)).toBeVisible({ timeout: 15000 });
    await expect(page2.getByText(/Duel 1 of|Loading next duel|JINX/i)).toBeVisible({ timeout: 15000 });

    await phone1Context.close();
    await phone2Context.close();
  });
});
