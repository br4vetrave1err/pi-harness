import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve('dashboard/src/App.tsx');
const content = fs.readFileSync(appPath, 'utf-8');

describe('App.tsx components', () => {
  it('U-C6-01 Topbar', () => {
    assert.ok(content.includes('function Topbar'));
    assert.ok(content.includes('running') && content.includes('waiting') && content.includes('done'));
  });
  it('U-C6-02 Sidebar filter', () => {
    assert.ok(content.includes('function Sidebar'));
    assert.ok(content.includes('ALL') && content.includes('filter'));
    assert.ok(content.includes('conversations === null') && content.includes('skeleton'));
  });
  it('U-C6-03 AgentWindowCard', () => {
    assert.ok(content.includes('function AgentWindowCard'));
    assert.ok(content.includes('AGENT_COLORS') && content.includes('StatusDot'));
    assert.ok(content.includes('maxHeight: 160'));
  });
  it('U-C6-04 LogLineView', () => {
    assert.ok(content.includes('function LogLineView') || content.includes('LogLineView'));
  });
  it('U-C6-05 InputBar', () => {
    assert.ok(content.includes('function InputBar'));
    assert.ok(content.includes('SHELL') && content.includes('PI'));
    assert.ok(content.includes('onDispatch'));
  });
  it('U-C6-06 Modal 5 tabs', () => {
    assert.ok(content.includes('["log","transcript","events","artifacts","session"]'));
    assert.ok(content.includes('Send s') && content.includes('Stop D'));
  });
  it('U-C6-07 Keyboard shortcuts', () => {
    assert.ok(content.includes("e.key === 'f'") && content.includes("e.key === '?'"));
    assert.ok(content.includes("e.key === 'x'") && content.includes("showToolDetails"));
  });
  it('C4-P4-01 extended fields', () => {
    assert.ok(content.includes('windowTokens') && content.includes('totalCost'));
    assert.ok(content.includes('launchResolvedExtensions'));
    assert.ok(content.includes('children'));
  });
});
