import { test, expect } from '@playwright/test';

test.describe('Real-Time 3-Player Party Game Loop', () => {
  test('Three mobile players lobby, write quips, enforce author lockout, vote, and reveal results', async ({ browser }) => {
    // 1. Create three isolated browser contexts simulating 3 separate mobile phones
    const phone1Context = await browser.newContext();
    const phone2Context = await browser.newContext();
    const phone3Context = await browser.newContext();

    const p1 = await phone1Context.newPage();
    const p2 = await phone2Context.newPage();
    const p3 = await phone3Context.newPage();

    // 2. Player 1 creates room
    await p1.goto('/');
    await p1.getByRole('button', { name: 'Create Room' }).first().click();
    await p1.getByPlaceholder('e.g. Quipster').fill('Alice');
    await p1.locator('form button[type="submit"]').click();

    await p1.waitForURL(/\/room\/[A-Z0-9]{4}/);
    const roomCodeMatch = p1.url().match(/\/room\/([A-Z0-9]{4})/);
    expect(roomCodeMatch).toBeTruthy();
    const roomCode = roomCodeMatch![1];

    // 3. Player 2 and Player 3 join room
    await p2.goto(`/?code=${roomCode}`);
    await p2.getByPlaceholder('e.g. Quipster').fill('Bob');
    await p2.locator('form button[type="submit"]').click();
    await p2.waitForURL(/\/room\/[A-Z0-9]{4}/);

    await p3.goto(`/?code=${roomCode}`);
    await p3.getByPlaceholder('e.g. Quipster').fill('Charlie');
    await p3.locator('form button[type="submit"]').click();
    await p3.waitForURL(/\/room\/[A-Z0-9]{4}/);

    // 4. Verify all 3 players appear in the live lobby on all screens
    await expect(p1.getByText('3 Joined')).toBeVisible({ timeout: 10000 });
    await expect(p2.getByText('3 Joined')).toBeVisible({ timeout: 10000 });
    await expect(p3.getByText('3 Joined')).toBeVisible({ timeout: 10000 });

    // Host has active Start Game button
    const startBtn = p1.getByRole('button', { name: 'Start Game' });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // 5. Phase 1: Simultaneous Writing
    await expect(p1.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });
    await expect(p2.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });
    await expect(p3.getByText(/Write Your Funniest Quip/i)).toBeVisible({ timeout: 10000 });

    // Submit answers for Player 1
    const p1Textarea = p1.getByPlaceholder('Type your punchline here...');
    await p1Textarea.fill('Alice Quip #1');
    await p1.getByRole('button', { name: /Submit & Next Prompt/i }).click();
    await p1.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible' });
    await p1Textarea.fill('Alice Quip #2');
    await p1.getByRole('button', { name: 'Lock In Punchline' }).click();

    // Submit answers for Player 2
    const p2Textarea = p2.getByPlaceholder('Type your punchline here...');
    await p2Textarea.fill('Bob Quip #1');
    await p2.getByRole('button', { name: /Submit & Next Prompt/i }).click();
    await p2.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible' });
    await p2Textarea.fill('Bob Quip #2');
    await p2.getByRole('button', { name: 'Lock In Punchline' }).click();

    // Player 3 uses Safety Quip
    const p3Textarea = p3.getByPlaceholder('Type your punchline here...');
    const safetyQuipBtn = p3.getByRole('button', { name: /Safety Quip/i });
    await safetyQuipBtn.click();
    await expect(p3Textarea).not.toHaveValue('');
    await p3.getByRole('button', { name: /Submit & Next Prompt/i }).click();

    await p3.getByRole('button', { name: 'Lock In Punchline' }).waitFor({ state: 'visible' });
    await safetyQuipBtn.click();
    await p3.getByRole('button', { name: 'Lock In Punchline' }).click();

    // 6. Phase 2: Duel & Voting (Auto-transition when all 3 finish)
    // One player will be the eligible voter while the two authors are locked out
    const phones = [p1, p2, p3];

    // Wait for all 3 phones to reach DUEL_VOTING
    await Promise.all(phones.map((p) => p.getByText(/Duel 1 of|Duel Results/i).waitFor({ timeout: 15000 })));

    // Find the eligible voter who sees Card A and Card B buttons
    let voterPhone = null;
    for (const phone of phones) {
      if (await phone.getByRole('button', { name: /CARD A/i }).isVisible()) {
        voterPhone = phone;
        break;
      }
    }

    expect(voterPhone).not.toBeNull();

    // Find an author phone that displays author lockout
    let authorPhone = null;
    for (const phone of phones) {
      if (await phone.getByText(/You're In This Duel!/i).isVisible()) {
        authorPhone = phone;
        break;
      }
    }

    expect(authorPhone).not.toBeNull();

    // Eligible voter taps Card A
    const cardABtn = voterPhone!.getByRole('button', { name: /CARD A/i });
    await cardABtn.click();

    // 7. Phase 3: Vote Reveal & Duel Progression
    // The server immediately tallies the vote, displays the reveal breakdown,
    // and progresses to the subsequent duel.
    await expect(p1.getByText(/Duel Results|Duel 2 of/i)).toBeVisible({ timeout: 15000 });
    await expect(p2.getByText(/Duel Results|Duel 2 of/i)).toBeVisible({ timeout: 15000 });
    await expect(p3.getByText(/Duel Results|Duel 2 of/i)).toBeVisible({ timeout: 15000 });

    await phone1Context.close();
    await phone2Context.close();
    await phone3Context.close();
  });
});
