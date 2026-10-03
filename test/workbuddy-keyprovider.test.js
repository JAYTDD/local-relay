import test from 'node:test';
import assert from 'node:assert/strict';

// wbai 修复的回归守卫：store 必须拿到原插件同款的 at-rest key resolver。
// 漏掉 keyProvider 时 store 自建的默认 resolver discovery 落回 "none"，
// 永远不去找 app 的 Electron 二进制；WorkBuddy 5.6 起凭据加密，
// 解不开就 not_signed_in（wbai 曾经的故障，见 PROJECT.md 坑 12）。

test('两个变体的 store 都拿到 keyProvider，且 discovery 随平台启用', async () => {
  const { createWorkBuddyProvider } = await import('../src/providers/workbuddy.mjs');
  const expected =
    process.platform === 'darwin'
      ? 'macos-workbuddy'
      : process.platform === 'win32'
        ? 'windows-workbuddy'
        : 'none';
  for (const variantId of ['cn', 'global']) {
    const provider = await createWorkBuddyProvider(variantId);
    const kp = provider.store.keyProvider;
    assert.notEqual(kp, undefined, `${variantId} 的 store 没有 keyProvider`);
    // 原插件工厂产物（WorkBuddyAtRestKeyProvider）的接口面
    assert.equal(typeof kp.protectorKeyFor, 'function', `${variantId}: 缺 protectorKeyFor`);
    assert.equal(typeof kp.resolveElectronPath, 'function', `${variantId}: 缺 resolveElectronPath`);
    assert.equal(typeof kp.helperPath, 'function', `${variantId}: 缺 helperPath`);
    // 关键回归点：discovery 必须是插件 electronDiscoveryFor() 的平台值，不能是 "none"
    assert.equal(kp.discovery, expected, `${variantId}: discovery 未启用，加密凭据将解不开`);
    await provider.close();
  }
});

test('每个变体独立的 keyProvider 实例（各自缓存 key，互不串）', async () => {
  const { createWorkBuddyProvider } = await import('../src/providers/workbuddy.mjs');
  const cn = await createWorkBuddyProvider('cn');
  const ai = await createWorkBuddyProvider('global');
  assert.notEqual(cn.store.keyProvider, ai.store.keyProvider);
  await cn.close();
  await ai.close();
});
