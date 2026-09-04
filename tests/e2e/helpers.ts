import { expect, Page } from '@playwright/test';
export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export async function goto(page: Page, url = BASE_URL) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await expect(page.locator('span:text("active agents")').first()).toBeVisible({ timeout: 5000 }).catch(()=>{});
}

export async function dispatch(page: Page, agent: string, task: string, mode: 'shell' | 'pi' = 'shell') {
  // via InputBar chip + mode toggle + Enter
  const chip = page.locator(`button:has-text("${agent.toUpperCase()}")`).first();
  if (await chip.isVisible().catch(()=>false)) await chip.click();
  const toggle = page.locator(`button:has-text("${mode.toUpperCase()}")`).first();
  if (await toggle.isVisible().catch(()=>false)) {
    const cls = await toggle.getAttribute('class').catch(()=> '');
    // click only if not already active (bg check not reliable, just click)
    await toggle.click().catch(()=>{});
  }
  const input = page.locator('input[placeholder*="Ask Codex"]');
  await input.fill(task);
  await input.press('Enter');
}

export async function dispatchViaAPI(page: Page, agent: string, task: string, mode: 'shell' | 'pi' = 'shell') {
  return page.evaluate(async ({agent, task, mode}) => {
    const r = await fetch('/api/dispatch', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({agent, task, mode})});
    return r.json();
  }, {agent, task, mode});
}

export async function waitForFleet(page: Page, runId: string, expectedState: string, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const fleet = await page.evaluate(async () => {
      const r = await fetch('/api/fleet?all=true'); return r.json();
    }) as any;
    const hit = fleet.fleet?.find((f:any)=> f.runId===runId || f.id===runId);
    if (hit && (hit.status===expectedState || hit.fleetState===expectedState)) return hit;
    // also check via direct GET /api/fleet/:id
    try {
      const one = await page.evaluate(async (id) => {
        const r = await fetch(`/api/fleet/${id}`); return r.ok ? r.json() : null;
      }, runId);
      if (one && (one.status===expectedState || one.fleetState===expectedState)) return one;
    } catch {}
    await page.waitForTimeout(500);
  }
  throw new Error(`waitForFleet ${runId} -> ${expectedState} timeout`);
}

export async function openModal(page: Page, selector = 'div.fixed.inset-0') {
  const modal = page.locator(selector).first();
  await expect(modal).toBeVisible({ timeout: 5000 });
  return modal;
}

export async function steer(page: Page, runId: string, message: string, mode: 'follow_up'|'steer'|'auto'='follow_up') {
  const input = page.locator('input[placeholder*="steer"]');
  await input.fill(message);
  const sel = page.locator('select').first();
  if (await sel.isVisible().catch(()=>false)) await sel.selectOption(mode);
  await page.locator('button:has-text("Send s")').click();
}

export async function stop(page: Page) {
  await page.locator('button:has-text("Stop D")').click();
}

export async function expectLogContains(page: Page, text: string) {
  const log = page.locator('div.max-h-\\[380px\\]').first();
  await expect(log).toContainText(text, { timeout: 5000 });
}

export async function getSessionFile(page: Page, runId: string) {
  return page.evaluate(async (id) => {
    const r = await fetch(`/api/fleet/${id}`); const j = await r.json(); return j.sessionFile || j.sessionId;
  }, runId);
}
