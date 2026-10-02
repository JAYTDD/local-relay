/**
 * Trae 面板数据层。
 *
 * 原插件的 /plugins/dsh-connect-trae/usage 由 traeWebUsage(deps, region) 组装，
 * deps 需要 store / client / displayModels / enabledModelIds / regionEnabled /
 * discoverModels / rawDiagnostic 这一整套服务。
 *
 * local-relay 的 provider 目前只暴露 { id, shim, models(), refreshModels() }，
 * **没有** store / usageClient —— 因此本模块的契约是：
 *   - 一律返回 signed-out 形态的文档（含账号为空、模型来自 provider.models()）；
 *   - 不去调用 traeWebUsage（缺依赖必然抛错，包一层 try/catch 只是掩盖问题）；
 *   - 当后续任务把 store/client 装配到 provider 上时，只需把 buildLiveDocument
 *     的分支打开即可，调用点与返回契约不变。
 *
 * 这样面板在"未登录/依赖不全"时显示账号与模型，而不是整块报错。
 */
const REGIONS = ['cn', 'ai'];

const PREFIX_BY_REGION = { cn: 'trae', ai: 'traeg' };

function providerFor(providers, region) {
  return providers.find((p) => p.def.prefix === PREFIX_BY_REGION[region]);
}

/** 未登录/依赖不全时的文档；模型从 provider 本地目录读 */
export function fallbackDocument(provider, region) {
  const models = (provider?.models ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
    ...(m.maxTokens === undefined ? {} : { maxTokens: m.maxTokens }),
  }));
  return {
    status: 'signed-out',
    region,
    enabled: Boolean(provider),
    accounts: [],
    models,
    enabledModelIds: models.map((m) => m.id),
    ...(provider ? {} : { reason: `region not configured: ${region}` }),
  };
}

/**
 * 当且仅当 provider 上装配了 store + 用量客户端时才走完整文档。
 * 本计划的 provider 未装配，故恒走 fallback；保留此分支供后续任务接入。
 */
export function buildLiveDocument(provider) {
  const hasLiveServices = Boolean(provider?.usageClient) && Boolean(provider?.store);
  if (!hasLiveServices) return undefined;
  // 装配后在此调用 traeWebUsage；当前不实现，避免引入未定义的依赖。
  return undefined;
}

export function createTraeStatus({ providers }) {
  return {
    regions() {
      return [...REGIONS];
    },

    async document(region) {
      const entry = providerFor(providers(), region);
      if (!entry) return fallbackDocument(undefined, region);
      const live = buildLiveDocument(entry.provider);
      return live ?? fallbackDocument(entry, region);
    },

    async refresh(region) {
      const entry = providerFor(providers(), region);
      if (!entry) throw new Error(`trae region not configured: ${region}`);
      const out = await entry.provider.refreshModels();
      entry.models = entry.provider.models();
      return { models: out.models ?? entry.models, errors: out.errors ?? [] };
    },
  };
}
