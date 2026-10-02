import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraeStatus } from '../src/panel/trae-status.mjs';

/** 造一个 trae provider 桩：只有 update 会走 refreshModels */
function traeProvider(region, models) {
  return {
    def: { prefix: region === 'cn' ? 'trae' : 'traeg', label: `Trae ${region}`, kind: 'trae' },
    provider: {
      id: region === 'cn' ? 'trae' : 'trae-global',
      models: () => models,
      refreshModels: async () => ({ models, errors: [] }),
    },
    models,
  };
}

test('regions lists both trae regions', () => {
  const st = createTraeStatus({ providers: () => [traeProvider('cn', [{ id: 'glm-5.3' }])] });
  assert.deepEqual(st.regions().sort(), ['ai', 'cn']);
});

test('document returns signed-out shape when provider missing', async () => {
  const st = createTraeStatus({ providers: () => [] });
  const doc = await st.document('cn');
  assert.equal(doc.status, 'signed-out');
  assert.deepEqual(doc.models, []);
});

test('document falls back to local models when credential query fails', async () => {
  const st = createTraeStatus({
    providers: () => [traeProvider('cn', [{ id: 'glm-5.3', name: 'GLM-5.3' }])],
  });
  const doc = await st.document('cn');
  assert.equal(doc.status, 'signed-out');
  assert.equal(doc.models.length, 1);
  assert.equal(doc.models[0].id, 'glm-5.3');
});

test('refresh proxies provider refreshModels', async () => {
  const st = createTraeStatus({
    providers: () => [traeProvider('cn', [{ id: 'glm-5.3' }])],
  });
  const out = await st.refresh('cn');
  assert.equal(out.models.length, 1);
});
