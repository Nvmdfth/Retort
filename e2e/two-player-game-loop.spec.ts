import { test, expect } from '@playwright/test';

test.describe('2-Player Game Loop Verification', () => {
  test('Two players join, Start button activates, complete writing, and progress through duels', async ({ browser }) => {
    // 1. Create two isolated browser contexts representing two players
    const phone1Context = await browser.newContext();
    const phone2Context = await browser.newContext();

    const p1 = await phone1Context.newPage();
    const p2 = await phone2Context.newPage();

    // 2. Player 1 creates room
    await p1.goto('/');
    await p1.getByRole('button', { name: 'Create Room' }).first().click();
    await p1.getByPlaceholder('e.g. Quipster').fill('HostAlice');
    await p1.locator('form button[type="submit"]').click();

    await p1.waitForURL(/\/room\/[A-Z0-9]{4}/);
    const roomCodeMatch = p1.url().match(/\/room\/([A-Z0-9]{4})/);
    expect(roomCodeMatch).toBeTruthy();
    const roomCode = roomCodeMatch![1];

    // Verify 1-player state: button is disabled with "Waiting For Players (Min 2)"
    const waitBtn = p1.getByRole('button', { name: 'Waiting For Players (Min 2)' });
    await expect(waitBtn).toBeVisible({ timeout: 10000 });
    await expect(waitBtn).toBeDisabled();

    // 3. Player 2 joins using the room code
    await p2.goto(`/?code=${roomCode}`);
    await p2.getByPlaceholder('e.g. Quipster').fill('PlayerBob');
    await p2.locator('form button[type="submit"]').click();
    await p2.waitForURL(/\/room\/[A-Z0-9]{4}/);

    // 4. Verify button activates on Player 1's screen after Player 2 connects
    await expect(p1.getByText('2 Joined')).toBeVisible({ timeout: 10000 });
    await expect(p2.getByText('2 Joined')).toBeVisible({ timeout: 10000 });

    const startBtn = p1.getByRole('button', { name: 'Start Game' });
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await expect(startBtn).toBeEnabled();

    // Player 2 sees waiting notice instead of start button
    await expect(p2.getByText(/Waiting for the host to start/i)).toBeVisible();

    // 5. Host clicks Start Game
    await startBtn.click();

    // 6. Both players enter WRITING phase
    await expect(p1.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });
    await expect(p2.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });

    // 7. Player 1 submits 2 prompt responses
    const p1Textarea = p1.getByPlaceholder('Type your punchline here...');
    await p1Textarea.fill('Alice Quip #1');
    await p1.getByRole('button', { name: /Submit & Next Prompt/i }).click();

    await p1.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible', timeout: 10000 });
    await p1Textarea.fill('Alice Quip #2');
    await p1.getByRole('button', { name: 'Lock In Punchline' }).click();

    // 8. Player 2 submits 2 prompt responses
    const p2Textarea = p2.getByPlaceholder('Type your punchline here...');
    await p2Textarea.fill('Bob Quip #1');
    await p2.getByRole('button', { name: /Submit & Next Prompt/i }).click();

    await p2.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible', timeout: 10000 });
    await p2Textarea.fill('Bob Quip #2');
    await p2.getByRole('button', { name: 'Lock In Punchline' }).click();

    // 9. When both finish, transition to DUEL_VOTING
    // Both are authors in 2-player mode, so both see author lockout notice
    await expect(p1.getByRole('heading', { name: "You're In This Duel!" })).toBeVisible({ timeout: 15000 });
    await expect(p2.getByRole('heading', { name: "You're In This Duel!" })).toBeVisible({ timeout: 15000 });

    // 10. Auto-advances to DUEL_REVEAL after testing timer (5s)
    // Reveal displays card breakdowns, author attributions, and countdown to next duel
    await expect(p1.getByText(/Next matchup in/i)).toBeVisible({ timeout: 20000 });
    await expect(p2.getByText(/Next matchup in/i)).toBeVisible({ timeout: 20000 });
    await expect(p1.getByText(/By:\s*HostAlice/i)).toBeVisible({ timeout: 5000 });
    await expect(p1.getByText(/By:\s*PlayerBob/i)).toBeVisible({ timeout: 5000 });

    // 11. Cleanup contexts
    await phone1Context.close();
    await phone2Context.close();
  });
});
