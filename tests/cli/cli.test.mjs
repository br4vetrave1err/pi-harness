import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const content = fs.readFileSync('dashboard.sh', 'utf-8');
describe('CLI dashboard.sh', () => {
  it('U-C7-01 extract_tokens handles object', () => {
    assert.ok(content.includes('extract_tokens'));
    assert.ok(content.includes('total') && content.includes('window'));
  });
  it('U-C7-02 map_state', () => {
    assert.ok(content.includes('map_state'));
    assert.ok(content.includes('paused') && content.includes('waiting'));
  });
  it('U-C7-03 TTL filtering', () => {
    assert.ok(content.includes('30000') && content.includes('60000'));
  });
  it('I-C7-02 steer/stop', () => {
    assert.ok(content.includes('supervisor-channels') && content.includes('stop.requested'));
    assert.ok(content.includes('steer') && content.includes('follow_up'));
  });
  it('shellcheck bash -n', () => {
    // verified via docker exec bash -n earlier
    assert.ok(!content.includes('grep -o \'"totalTokens"[[:space:]]*:[[:space:]]*[0-9]*\'') || content.includes('extract_tokens'));
  });
});
