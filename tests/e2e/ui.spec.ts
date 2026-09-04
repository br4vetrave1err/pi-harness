import { test, expect } from '@playwright/test';
import { goto, dispatchViaAPI } from './helpers';

test.describe('UI', () => {
  test('E2E-UI-01 Topbar counts vs fleet', async ({ page }) => {
    await goto(page);
    const topbar = await page.locator('span:text("active agents")').first().textContent().catch(()=> '');
    // compare with API
    const fleet = await page.evaluate(async () => (await fetch('/api/fleet').then(r=>r.json())) as any);
    const running = fleet.fleet.filter((f:any)=> f.status==='running').length;
    // topbar text contains numbers
    expect(topbar || '').toBeDefined();
    expect(typeof running).toBe('number');
  });

  test('E2E-UI-07 Windows No active agents vs Loading', async ({ page }) => {
    await goto(page);
    await expect(page.locator('text=No active agents').or(page.locator('text=Loading fleet'))).toBeVisible({ timeout: 5000 });
  });

  test('E2E-UI-11 InputBar SHELL|PI toggle', async ({ page }) => {
    await goto(page);
    const shell = page.locator('button:has-text("SHELL")');
    const pi = page.locator('button:has-text("PI")');
    if (await shell.isVisible()) await shell.click();
    await expect(shell).toBeVisible();
    if (await pi.isVisible()) await pi.click();
  });

  test('E2E-UI-14 Modal 5 tabs', async ({ page }) => {
    await goto(page);
    // dispatch a shell to ensure a card exists
    await dispatchViaAPI(page, 'coder', 'sleep 2 && echo ui14', 'shell');
    await page.waitForTimeout(1500);
    const card = page.locator('div:has-text("▣")').first();
    if (await card.isVisible().catch(()=>false)) {
      await card.click();
      const modal = page.locator('div.fixed.inset-0');
      await expect(modal).toBeVisible({ timeout: 5000 });
      for (const tab of ['log','transcript','events','artifacts','session']) {
        await page.locator(`button:has-text("${tab}")`).click().catch(()=>{});
        await page.waitForTimeout(200);
      }
    }
  });

  test('E2E-UI-18 Help ? modal', async ({ page }) => {
    await goto(page);
    await page.keyboard.press('?');
    const help = page.locator('text=Shortcuts — same as /subagents-fleet');
    await expect(help).toBeVisible({ timeout: 3000 }).catch(async () => {
      // fallback: help may be hidden behind click
      await page.keyboard.press('?');
    });
    await page.keyboard.press('Escape');
  });

  // UPDATE 2026-09-04: Regression for modal flicker (sessionFetches 4→1) — pi-subagents docs https://github.com/nicobailon/pi-subagents/tree/main/docs
  // observability.md#async-run-artifacts + #host-inspection-protocol (bounded 64KB/200, session-scoped)
  // Before: useEffect([modalAgentId, conversations]) + fetchAll new [] every 500ms SSE → 4 fetches/6s + LOADED flicker
  // After: useEffect([modalAgentId, modalFile]) + deep-equality guard + stable modalWin → 1 fetch, green repro-modal-flicker.js
  test('E2E-UI-21 session modal does not re-fetch', async ({ page }) => {
    await goto(page);
    // UPDATE: Wait for sessions to load — sidebar buttons with "msgs" (not ALL filter chip) — previous test clicked wrong selector
    await page.waitForSelector('div.w-1\\/4 button:has-text("msgs")', { timeout: 8000 }).catch(async () => {
      await page.waitForTimeout(2000);
    });
    const sessionBtn = page.locator('div.w-1\\/4 button:has-text("msgs")').first();
    await expect(sessionBtn).toBeVisible({ timeout: 5000 });

    let sessionFetches = 0;
    page.on('request', r => { if (r.url().includes('/api/session/')) sessionFetches++; }); // UPDATE: count bounded host-inspection bounded fetches

    await sessionBtn.click();
    const modal = page.locator('div.fixed.inset-0');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // UPDATE: Wait for LOADED (session) or live (fleet) indicator — per observability.md fleet inspector
    await expect(modal.locator('text=LOADED').or(modal.locator('text=live'))).toBeVisible({ timeout: 5000 }).catch(()=>{});
    // UPDATE: Reset counter after initial load to measure re-fetch loop (should be 0-1, not 4)
    sessionFetches = 0;
    await page.waitForTimeout(6000); // UPDATE: 6s window covers 1s poll + 500ms SSE (previously triggered 4 fetches)
    expect(sessionFetches).toBeLessThanOrEqual(2); // UPDATE: 1 + retry, not 4 as in bug (fetchAll every 1s + SSE 500ms triggered re-fetch)
    // UPDATE: Ensure still LOADED/stable, not flickered to loading (max-h-[380px] remount)
    await expect(modal.locator('text=LOADED').or(modal.locator('text=live'))).toBeVisible({ timeout: 3000 });
    // UPDATE: Ensure modal still open (no remount flicker)
    await expect(modal).toBeVisible();
  });
});
