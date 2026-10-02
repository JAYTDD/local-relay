import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraeStatus } from '../src/panel/trae-status.mjs';

function fakeProvider({ usage }) {
  return {
    store: {
      status: async () => ({ state: 'signed-in' }),
      accounts: async () => [{ id: 'a1', accountName: 'tester', selected: true, tokenExpiresAtMs: 123 }],
    },
    models: () => [{ id: 'glm-5.3', name: 'glm-5.3' }],
    usage,
  };
}

const cnDeps = (provider) => ({
  providers: () => [{ def: { prefix: 'trae', kind: 'trae' }, provider, models: [] }],
});
const aiDeps = (provider) => ({
  providers: () => [{ def: { prefix: 'traeg', kind: 'trae' }, provider, models: [] }],
});

test('CN 区域把 snapshot / checkinStatus 映射进文档', async () => {
  const provider = fakeProvider({
    usage: {
      // 真实形状（照抄源 toCredits 的输入）：嵌套 summary + packs
      snapshot: async () => ({
        summary: { totalAmount: 100, consumedAmount: 40, consumptionRatio: 0.4 },
        packs: [
          { displayDesc: '免费', creditsLimit: 60, consumedCredits: 10, availableEndpoint: 0 },
          { displayDesc: 'Work', creditsLimit: 50, consumedCredits: 5, availableEndpoint: 1 },
        ],
      }),
      checkinStatus: async () => ({ checkedIn: false, credits: 5, enabled: true, didCheckedIn: false }),
    },
  });
  const doc = await createTraeStatus(cnDeps(provider)).document('cn');
  assert.equal(doc.credits.total, 100);
  assert.equal(doc.credits.consumed, 40);
  assert.equal(doc.credits.available, 60);
  assert.equal(doc.credits.generalAvailable, 50, 'endpoint 0 的剩余');
  assert.equal(doc.credits.workAvailable, 45, 'endpoint 1 的剩余');
  assert.equal(doc.credits.accounts.length, 2);
  assert.equal(doc.checkin.credits, 5);
});

test('额度快照缺 summary/packs 时不崩', async () => {
  const provider = fakeProvider({
    usage: {
      snapshot: async () => ({}),
      checkinStatus: async () => ({ checkedIn: false, credits: 0, enabled: true, didCheckedIn: false }),
    },
  });
  const doc = await createTraeStatus(cnDeps(provider)).document('cn');
  assert.equal(doc.credits.total, 0);
  assert.deepEqual(doc.credits.accounts, []);
});

test('AI 区域走 payStatus 且不谎报积分明细', async () => {
  const provider = fakeProvider({ usage: { payStatus: async () => ({ hasPackage: true, inTrial: false }) } });
  const doc = await createTraeStatus(aiDeps(provider)).document('ai');
  assert.equal(doc.payStatus.hasPackage, true);
  assert.equal(doc.credits, undefined, 'AI 区域不该有积分明细字段');
});

test('额度查询抛错时给 creditsError，文档仍可用', async () => {
  const provider = fakeProvider({
    usage: {
      snapshot: async () => { throw new Error('usage endpoint exploded'); },
      checkinStatus: async () => ({ checkedIn: true, credits: 0, enabled: true, didCheckedIn: true }),
    },
  });
  const doc = await createTraeStatus(cnDeps(provider)).document('cn');
  assert.equal(doc.status, 'signed-in');
  assert.match(doc.creditsError, /usage endpoint exploded/);
  assert.equal(doc.checkin.checkedIn, true, '一个失败不该拖垮另一个');
});

test('未装配 usage 时明确说明而不是静默留空', async () => {
  const doc = await createTraeStatus(cnDeps(fakeProvider({ usage: undefined }))).document('cn');
  assert.equal(doc.credits, undefined);
  assert.equal(doc.creditsError, undefined);
  assert.match(doc.usageUnavailable, /usage client not wired/);
});

test('额度文档不泄漏凭据字段', async () => {
  const provider = fakeProvider({
    usage: {
      // 上游多返的字段一个都不许透传
      snapshot: async () => ({
        summary: { totalAmount: 1, consumedAmount: 0, accessToken: 'SECRET' },
        packs: [{ displayDesc: 'x', creditsLimit: 1, consumedCredits: 0, availableEndpoint: 0, secret: 'SECRET' }],
        accessToken: 'SECRET',
      }),
      checkinStatus: async () => ({ checkedIn: false, credits: 0, enabled: true, didCheckedIn: false, token: 'SECRET' }),
    },
  });
  const doc = await createTraeStatus(cnDeps(provider)).document('cn');
  assert.equal(JSON.stringify(doc).includes('SECRET'), false, '响应体泄漏了 token');
});

test('签到的额外奖励字段透传，0 不显示', async () => {
  const provider = fakeProvider({
    usage: {
      snapshot: async () => ({}),
      checkinStatus: async () => ({ checkedIn: false, credits: 5, enabled: true, didCheckedIn: false, extraCredits: 3 }),
    },
  });
  const doc = await createTraeStatus(cnDeps(provider)).document('cn');
  assert.equal(doc.checkin.extraCredits, 3);
});
