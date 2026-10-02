import * as q from 'dsh-qoder-connect';
console.log('=== Qoder 关键导出 ===');
for (const k of ['QoderCredentialStore','QoderCatalog','QoderUpstreamClient','createQoderShim','QODER_VARIANTS','CHINA_VARIANT','FALLBACK_QODER_MODELS','qoderOwnAuthPath'])
  console.log('  ', k.padEnd(26), typeof q[k]);
console.log('\nCHINA_VARIANT keys:', Object.keys(q.CHINA_VARIANT||{}).join(','));
console.log('\nFALLBACK_QODER_MODELS 数:', (q.FALLBACK_QODER_MODELS||[]).length);
