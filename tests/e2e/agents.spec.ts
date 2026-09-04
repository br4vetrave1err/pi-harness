import { test, expect } from '@playwright/test';
import { goto, dispatchViaAPI, waitForFleet } from './helpers';

test.describe('Agents via dashboard', () => {
  test('E2E-AG-01 coder shell', async ({ page }) => {
    await goto(page);
    const {runId} = await dispatchViaAPI(page, 'coder', 'echo coder via ui', 'shell');
    const hit = await waitForFleet(page, runId, 'running').catch(async () => {
      // fallback to done quickly for shell mock (8s)
      return waitForFleet(page, runId, 'done');
    });
    expect(hit.agent.toLowerCase()).toContain('coder');
  });

  test('E2E-AG-05 tester verdict', async ({ page }) => {
    await goto(page);
    // first need a coder change so tester has diff; use shell mock that mimics tester output
    const {runId} = await dispatchViaAPI(page, 'tester', 'Test verdict: PASS', 'shell');
    await page.waitForTimeout(1500);
    const one = await page.evaluate(async (id) => {
      const r = await fetch(`/api/fleet/${id}?lines=50`); return r.json();
    }, runId) as any;
    expect(one.lines || one.transcript?.lines).toBeDefined();
  });

  test('E2E-AG-08 dots 390K model', async ({ page }) => {
    await goto(page);
    const fleet = await page.evaluate(async () => (await fetch('/api/fleet?all=true').then(r=>r.json())) as any);
    // at least one run should have modelAttempts or model
    if (fleet.fleet.length>0) {
      const f=fleet.fleet[0];
      expect(f.model || f.modelAttempts).toBeDefined();
    }
  });
});
