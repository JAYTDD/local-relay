import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkBuddyStatus } from '../src/panel/workbuddy-status.mjs';

function wbProvider(variant, models) {
  return {
    def: { prefix: variant === 'cn' ? 'wb' : 'wbai', label: `WB ${variant}`, kind: 'workbuddy' },
    provider: {
      id: variant === 'cn' ? 'workbuddy' : 'workbuddy-ai',
      models: () => models,
      refreshModels: async () => ({ models, errors: [] }),
    },
    models,
  };
}

test('variants lists cn and global', () => {
  const st = createWorkBuddyStatus({ providers: () => [] });
  assert.deepEqual(st.variants().sort(), ['cn', 'global']);
});

test('document exposes models with normalized credits and no token', async () => {
  const st = createWorkBuddyStatus({
    providers: () => [wbProvider('cn', [{ id: 'glm-5.3', name: 'GLM-5.3', billing: { credits: 'x0.79 credits' }, contextWindow: 1000000 }])],
  });
  const doc = await st.document('cn');
  assert.equal(doc.status, 'signed-in');
  assert.equal(doc.models.length, 1);
  assert.equal(doc.models[0].id, 'glm-5.3');
  // normalizeCredits 是字符串归一化：'x0.79 credits' → 'x0.79'
  assert.equal(doc.models[0].credits, 'x0.79');
  assert.equal(JSON.stringify(doc).includes('accessToken'), false);
});

test('control rejects unknown action', async () => {
  const st = createWorkBuddyStatus({ providers: () => [wbProvider('cn', [])] });
  const out = await st.control('cn', { action: 'nope' });
  assert.equal(out.state, 'failed');
  assert.match(out.reason, /unknown action/);
});

test('control rejects unknown variant', async () => {
  const st = createWorkBuddyStatus({ providers: () => [] });
  const out = await st.control('bogus', { action: 'clear' });
  assert.equal(out.state, 'failed');
});

test('document and control survive a provider that failed to start', async () => {
  const broken = {
    def: { prefix: 'wbai', label: 'WB global', kind: 'workbuddy' },
    provider: null,
    models: [],
    error: 'boom',
  };
  const st = createWorkBuddyStatus({ providers: () => [broken] });
  const doc = await st.document('global');
  assert.equal(doc.status, 'signed-out');
  assert.equal(doc.reason, 'boom');
  const out = await st.control('global', { action: 'refresh' });
  assert.equal(out.state, 'failed');
  assert.equal(out.reason, 'boom');
});
