import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || 'http://localhost:3000';

describe('Integration /api/fleet', () => {
  it('I-C5-01 filtered vs all', async () => {
    const all = await fetch(`${base}/api/fleet?all=true`).then(r=>r.json());
    const filtered = await fetch(`${base}/api/fleet`).then(r=>r.json());
    assert.ok(Array.isArray(all.fleet));
    assert.ok(Array.isArray(filtered.fleet));
    assert.ok(all.total >= filtered.count);
    assert.equal(all.filtered, false);
    assert.equal(filtered.filtered, true);
  });
  it('I-C5-02 TTL activeOnly', async () => {
    const fleet = await fetch(`${base}/api/fleet`).then(r=>r.json());
    for (const f of fleet.fleet) {
      assert.ok(['running','waiting'].includes(f.status) || ['error','done'].includes(f.status));
      if (f.status==='done' || f.status==='error') {
        // should be recent
        const age = Date.now() - (f.lastUpdate||f.startedAt);
        if (f.status==='done') assert.ok(age < 35000, `done too old ${age}`);
        if (f.status==='error') assert.ok(age < 65000);
      }
    }
  });
  it('I-C5-06 fleet fields present', async () => {
    const all = await fetch(`${base}/api/fleet?all=true`).then(r=>r.json());
    if (all.fleet.length===0) return;
    const f=all.fleet[0];
    for (const k of ['runId','id','fullId','agent','task','status','fleetState','model','tokens','elapsed','durationMs','lines','sessionFile']) {
      assert.ok(k in f, `missing ${k}`);
    }
  });
  it('I-C5-08 object tokens normalized', async () => {
    const all = await fetch(`${base}/api/fleet?all=true`).then(r=>r.json());
    for (const f of all.fleet) {
      assert.equal(typeof f.tokens, 'number');
      assert.ok(!isNaN(f.tokens));
    }
  });
  it('I-C5-12 traversal blocked', async () => {
    const r = await fetch(`${base}/api/session/%2e%2e%2fetc%2fpasswd`);
    assert.equal(r.status, 400);
  });
  it('I-C5-15 dispatch shell', async () => {
    const r = await fetch(`${base}/api/dispatch`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({agent:'coder', task:'echo integration test', mode:'shell'})});
    assert.equal(r.status, 200);
    const j=await r.json();
    assert.ok(j.queued && j.runId);
    // wait for fleet
    await new Promise(res=>setTimeout(res,800));
    const fleet=await fetch(`${base}/api/fleet`).then(r=>r.json());
    assert.ok(fleet.fleet.some(x=>x.runId===j.runId) || fleet.total>=1);
  });
  it('I-C5-20 steer', async () => {
    // create a running
    const d=await fetch(`${base}/api/dispatch`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({agent:'coder', task:'sleep 5', mode:'shell'})}).then(r=>r.json());
    await new Promise(res=>setTimeout(res,500));
    const s=await fetch(`${base}/api/fleet/${d.runId}/steer`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:'hi', mode:'follow_up'})});
    assert.equal(s.status,200);
    const sj=await s.json();
    assert.equal(sj.status,'queued');
  });
});
