import * as wb from 'dsh-workbuddy-connect';
import * as t from 'dsh-connect-trae';
console.log('WorkBuddy 变体:', Object.values(wb.WORKBUDDY_VARIANTS).map(v=>`${v.id}(${v.region})`).join(', '));
console.log('Trae 区域:', JSON.stringify(t.TRAE_REGIONS));
console.log('Trae providers:', JSON.stringify(t.TRAE_PROVIDERS));
console.log('REGION_GATEWAYS:', JSON.stringify(t.REGION_GATEWAYS));
console.log('\nWorkBuddy CN 模型数:', wb.FALLBACK_WORKBUDDY_MODELS.length, '| AI:', wb.FALLBACK_WORKBUDDY_AI_MODELS.length);
console.log('Trae FALLBACK CN:', (t.FALLBACK_TRAE_MODELS||[]).length, '| AI:', (t.FALLBACK_TRAE_MODELS_AI||[]).length);
