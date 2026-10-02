/**
 * WorkBuddy 供应商：从 dsh-workbuddy-connect 提取协议层。
 * 两个变体（国内 workbuddy / 国际 workbuddy-ai）各自独立的凭据、目录与 shim。
 */
import * as wb from 'dsh-workbuddy-connect';

const logger = {
  warn: (...a) => console.error('[workbuddy][warn]', ...a),
  error: (...a) => console.error('[workbuddy][error]', ...a),
};

/**
 * @param {'cn'|'global'} variantId
 */
export function createWorkBuddyProvider(variantId) {
  const variant = variantId === 'global' ? wb.AI_VARIANT : wb.CN_VARIANT;
  const fallback = variantId === 'global' ? wb.FALLBACK_WORKBUDDY_AI_MODELS : wb.FALLBACK_WORKBUDDY_MODELS;

  const client = new wb.WorkBuddyUpstreamClient();
  const store = new wb.WorkBuddyCredentialStore({
    variant,
    refresh: (credential) => client.refreshToken(credential),
  });
  const catalog = new wb.WorkBuddyCatalog(fallback);
  if (variantId === 'global') catalog.setUseMaximumContextWindow(true);
  // 插件默认不可见，发现成功后才 setVisible(true)；独立网关直接暴露
  catalog.setVisible(true);

  return {
    id: variant.id,
    label: variant.displayName,
    providerPrefix: variantId === 'global' ? 'workbuddy-ai' : 'workbuddy',
    shim: null,
    async start() {
      const shim = wb.createWorkBuddyShim({ store, client, catalog, logger });
      await shim.ready;
      this.shim = shim;
      await this.refreshModels();
      return this;
    },
    async refreshModels() {
      const errors = [];
      try {
        const credential = await store.resolve();
        const models = await client.fetchModels(credential);
        if (Array.isArray(models) && models.length > 0) catalog.set(models);
        catalog.setVisible(true);
      } catch (e) {
        errors.push(e.message);
        catalog.setVisible(true); // 至少暴露 fallback
      }
      return { models: catalog.current(), errors };
    },
    models() {
      return catalog.current();
    },
    async close() {
      await this.shim?.close();
    },
  };
}
