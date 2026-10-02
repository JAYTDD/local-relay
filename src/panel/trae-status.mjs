/**
 * Trae 面板数据层。
 *
 * 原插件的 /plugins/dsh-connect-trae/usage 由 traeWebUsage(deps, region) 组装，
 * deps 需要 store / client / displayModels / enabledModelIds / regionEnabled /
 * discoverModels / rawDiagnostic 一整套服务。
 *
 * local-relay 的 provider 暴露了 { store, region, models(), refreshModels() }。
 * 本模块据此给出**真实**的登录态与账号信息（只读，不含 token）：
 *   - 登录态：store.status() → { state, edition, expiresAtMs, source }
 *   - 账号：  store.accounts() → [{ id, accountName, edition, region, tokenExpiresAtMs, selected }]
 *   - 额度/签到：需要 TraeUsageClient（未装配），因此明确留空而非编造。
 *
 * 注意：早期版本一律返回 signed-out，导致已登录的 Trae CN 被误报为"未登录"。
 * 面板必须反映真实状态，不能凭"依赖不全"就声称未登录。
 */

const REGIONS = ['cn', 'ai'];

const PREFIX_BY_REGION = { cn: 'trae', ai: 'traeg' };

function providerFor(providers, region) {
  return providers.find((p) => p.def.prefix === PREFIX_BY_REGION[region]);
}

/** 归一化模型行 */
function toModelRow(m) {
  return {
    id: m.id,
    name: m.name ?? m.id,
    ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
    ...(m.maxTokens === undefined ? {} : { maxTokens: m.maxTokens }),
    ...(Array.isArray(m.input) ? { input: m.input } : {}),
    ...(typeof m.creditMultiplier === 'number' ? { creditMultiplier: m.creditMultiplier } : {}),
  };
}

/** 未配置该区域时的文档 */
export function unconfiguredDocument(region) {
  return {
    status: 'signed-out',
    region,
    enabled: false,
    accounts: [],
    models: [],
    enabledModelIds: [],
    reason: `region not configured: ${region}`,
  };
}

export function createTraeStatus({ providers }) {
  return {
    regions() {
      return [...REGIONS];
    },

    async document(region) {
      const entry = providerFor(providers(), region);
      if (!entry) return unconfiguredDocument(region);

      // provider 启动失败时 entry.provider 为 null；此时仍要返回结构完整的文档
      const liveProvider = entry.provider;
      const models = (liveProvider?.models?.() ?? entry.models ?? []).map(toModelRow);
      const store = liveProvider?.store;

      if (!liveProvider) {
        return {
          ...unconfiguredDocument(region),
          enabled: false,
          models,
          enabledModelIds: models.map((m) => m.id),
          ...(entry.error === undefined ? {} : { reason: entry.error }),
        };
      }

      // 查询真实登录态；任何异常都退化为 signed-out 但带上原因
      let statusDoc = { state: 'signed-out' };
      let accounts = [];
      let reason;
      try {
        if (store) {
          statusDoc = (await store.status()) ?? { state: 'signed-out' };
          accounts = await store.accounts();
        } else {
          reason = 'credential store not wired';
        }
      } catch (e) {
        reason = String(e?.message ?? e);
      }

      const signedIn = statusDoc.state === 'signed-in';
      const selected = accounts.find((a) => a.selected) ?? accounts[0];

      return {
        status: signedIn ? 'signed-in' : 'signed-out',
        region,
        enabled: true,
        ...(signedIn ? {} : { reason: reason ?? statusDoc.reason ?? 'no credential' }),
        ...(statusDoc.reasonCode === undefined ? {} : { reasonCode: statusDoc.reasonCode }),
        accounts,
        ...(selected
          ? {
              accountId: selected.id,
              accountName: selected.accountName,
              tokenExpiresAtMs: selected.tokenExpiresAtMs,
            }
          : {}),
        models,
        enabledModelIds: models.map((m) => m.id),
      };
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
