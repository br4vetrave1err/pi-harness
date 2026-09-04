import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Replicated readFleetStatus logic for unit testing (mirrors dashboard/server.js:25)
function mapState(s) {
  if (s==='running'||s==='pending') return 'running';
  if (s==='paused') return 'waiting';
  if (s==='complete') return 'done';
  if (s==='failed'||s==='stopped'||s==='error') return 'error';
  return s;
}
function extractTokens(j) {
  let t=j.totalTokens;
  if (typeof t==='object' && t!==null) return t.total || t.window || t.input || 0;
  return Number(t)||0;
}
function reconcile(j, now=Date.now()) {
  let state=j.state||'unknown';
  const startedAt=j.startedAt||0;
  const lastUpdate=j.lastUpdate||startedAt||0;
  let durationMs=j.durationMs;
  if ((state==='running'||state==='pending') && lastUpdate && (now - lastUpdate > 30000)) {
    state='failed';
    durationMs=lastUpdate-startedAt;
    if (durationMs<0) durationMs=0;
  }
  if (durationMs==null) durationMs=(state==='running'||state==='pending')?(now-startedAt):(lastUpdate-startedAt);
  if (durationMs<0) durationMs=0;
  const totalTokens=extractTokens(j);
  const dashboardStatus=mapState(state);
  return { state, dashboardStatus, durationMs, totalTokens, elapsed:Math.floor(durationMs/1000) };
}

describe('readFleetStatus stale', () => {
  it('U-C4-07 stale 35s -> failed frozen', () => {
    const now=Date.now();
    const j={state:'running', startedAt:now-36000, lastUpdate:now-35000, durationMs:36000};
    const r=reconcile(j, now);
    assert.equal(r.state,'failed');
    assert.equal(r.durationMs,1000);
  });
  it('U-C4-08 pending stale', () => {
    const now=Date.now();
    const j={state:'pending', startedAt:now-36000, lastUpdate:now-35000};
    const r=reconcile(j, now);
    assert.equal(r.state,'failed');
  });
  it('U-C4-09 fresh running duration computed', () => {
    const now=Date.now();
    const j={state:'running', startedAt:now-12000};
    const r=reconcile(j, now);
    assert.ok(r.durationMs >= 11000 && r.durationMs <= 13000);
  });
  it('U-C4-11 object tokens total', () => {
    const j={state:'complete', totalTokens:{total:4200, window:3100}};
    const r=reconcile(j);
    assert.equal(r.totalTokens,4200);
  });
  it('U-C4-12 object window fallback', () => {
    const j={state:'complete', totalTokens:{window:3100}};
    const r=reconcile(j);
    assert.equal(r.totalTokens,3100);
  });
  it('U-C4-04 paused -> waiting', () => {
    const r=reconcile({state:'paused'});
    assert.equal(r.dashboardStatus,'waiting');
  });
  it('U-C4-05 complete -> done', () => {
    const r=reconcile({state:'complete'});
    assert.equal(r.dashboardStatus,'done');
  });
  it('TTL done 30s hidden', () => {
    const now=Date.now();
    const j={state:'complete', startedAt:now-40000, lastUpdate:now-40000, durationMs:1000};
    const mapped=mapState(j.state);
    const age=now - j.lastUpdate;
    const show = mapped==='done' ? age<30000 : false;
    assert.equal(show,false);
  });
  it('TTL error 60s', () => {
    const now=Date.now();
    const j={state:'failed', lastUpdate:now-50000};
    const mapped=mapState(j.state);
    const age=now - j.lastUpdate;
    const show = mapped==='error' ? age<60000 : false;
    assert.equal(show,true);
  });
});
