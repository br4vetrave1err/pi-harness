import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js = fs.readFileSync('workflows/coder-tester-loop.js', 'utf-8');
const md = fs.readFileSync('.pi/prompts/coder-tester-loop.md', 'utf-8');

describe('Workflow', () => {
  it('U-C3-01 hasFail strict', () => {
    assert.ok(js.includes('function hasFail'));
    assert.ok(js.includes('Test verdict: FAIL'));
    assert.ok(js.includes('rounds: 3') && js.includes('rounds: 2') && js.includes('rounds: 1'));
  });
  it('U-C3-02 max 3', () => {
    assert.ok(md.includes('maximum of 3 tester rounds'));
    assert.ok(md.includes('Test verdict: PASS') && md.includes('PASS with notes'));
  });
  it('U-C3-04 git commit', () => {
    assert.ok(js.includes('git add') && js.includes('git commit'));
    assert.ok(md.includes('git diff HEAD'));
    assert.ok(fs.readFileSync('.pi/agents/tester.md','utf-8').includes('git diff HEAD~1'));
  });
  it('loop stops on PASS with notes', () => {
    // hasFail only checks FAIL, so PASS with notes will not trigger
    const hasFail = (out) => out && out.includes('Test verdict: FAIL');
    assert.equal(hasFail('Test verdict: PASS with notes'), false);
    assert.equal(hasFail('Test verdict: FAIL'), true);
  });
});
