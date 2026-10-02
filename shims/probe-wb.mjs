import * as wb from 'dsh-workbuddy-connect';
console.log('=== WorkBuddy 关键导出 ===');
for (const k of ['WORKBUDDY_VARIANTS','CN_VARIANT','AI_VARIANT','WorkBuddyUpstreamClient','WorkBuddyCredentialStore','WorkBuddyCatalog','createWorkBuddyShim','parseModelCatalog','FALLBACK_WORKBUDDY_MODELS'])
  console.log('  ', k.padEnd(28), typeof wb[k]);
console.log('\nCN_VARIANT:', JSON.stringify(wb.CN_VARIANT)?.slice(0,300));
console.log('\n=== 试装配 CN ===');
const client = new wb.WorkBuddyUpstreamClient();
const store = new wb.WorkBuddyCredentialStore({ variant: wb.CN_VARIANT, refresh: (c)=>client.refreshToken(c) });
const catalog = new wb.WorkBuddyCatalog(wb.FALLBACK_WORKBUDDY_MODELS);
catalog.setVisible(true);
console.log('store ok, catalog ok, 模型数:', catalog.current().length);
try {
  const shim = wb.createWorkBuddyShim({ store, client, catalog, logger: {warn(){},error(){}} });
  await shim.ready;
  console.log('✅ shim 启动:', shim.baseUrl());
  const r = await fetch(`${shim.baseUrl()}/v1/models`);
  const j = await r.json();
  console.log('   /v1/models 模型数:', (j.data||[]).length, '| 前5:', (j.data||[]).slice(0,5).map(m=>m.id).join(', '));
  const first = (j.data||[])[0];
  if (first) {
    const cr = await fetch(`${shim.baseUrl()}/v1/chat/completions`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:first.id, messages:[{role:'user',content:'说 ok'}], stream:false })});
    const txt = await cr.text();
    console.log('   调用', first.id, '-> HTTP', cr.status);
    console.log('   ', txt.slice(0,220));
  }
  await shim.close();
} catch(e) { console.log('❌ shim 失败:', e.message.slice(0,300)); }
