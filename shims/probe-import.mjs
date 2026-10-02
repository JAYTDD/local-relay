// 可行性验证：能否用桩独立导入 Trae 插件的协议层
const t = await import('dsh-connect-trae');
console.log('✅ 独立导入成功（未启动 cordis / DSH）');
const keys = [
  'TraeCredentialStore', 'TraeCatalog', 'TraeSoloUpstreamClient',
  'TraeSoloRemoteCatalogClient', 'createTraeShim', 'prepareSoloBody',
  'traeStorageCandidates', 'readTraeIdentity', 'refreshTraeCredential',
];
for (const k of keys) console.log('  ', k.padEnd(32), typeof t[k]);
