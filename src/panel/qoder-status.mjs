/**
 * Qoder 面板数据层。
 *
 * 形状照抄源插件的 qoderWebStatus(deps)：
 *   - 登录态：store.status() → { state:'configured'|..., region, pat:{source,savedAtMs,patTail}, filePath }
 *   - 模型：modelSnapshot 的行（含 isReasoning、reasoningEfforts、supportsImages 等）
 *   - 额度：client.fetchCredits()（无参，与 WorkBuddy 不同）
 *   - 签到：client.checkIn()
 *   - 目录来源与探针：同另两个通道
 *
 * 早期版本这里是"未接入"占位，理由是 transport 未导出——那个结论是错的，
 * 详见 src/providers/qoder.mjs 顶部说明。
 */
import { normalizeCredits } from 'dsh-qoder-connect';

const VARIANTS = { cn: 'qoder', global: 'qoderg' };

function providerFor(providers, variant) {
  const prefix = VARIANTS[variant];
  if (!prefix) return undefined;
  return providers.find((p) => p.def.prefix === prefix);
}

/**
 * 模型行 → 面板字段（照源 modelSnapshot）。
 * 只挑已知字段：上游多返什么都不漏进响应体。
 */
export function toModelRow(model) {
  const supported = Array.isArray(model.supportedContextWindows) ? model.supportedContextWindows : [];
  const maxContextWindow = supported.length > 0 ? Math.max(...supported) : undefined;
  const defaultContextWindow = model.defaultContextWindow ?? model.contextWindow;
  const rate = normalizeCredits(model.priceFactor ?? model.billing?.credits);
  return {
    id: model.id,
    name: model.name ?? model.id,
    ...(typeof model.contextWindow === 'number' && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
    ...(typeof defaultContextWindow === 'number' && defaultContextWindow > 0 && defaultContextWindow < model.contextWindow
      ? { defaultContextWindow }
      : {}),
    ...(maxContextWindow === undefined || maxContextWindow <= defaultContextWindow ? {} : { maxContextWindow }),
    ...(model.reasoning?.supports === true ? { isReasoning: true } : {}),
    ...(Array.isArray(model.reasoning?.supportedEfforts) && model.reasoning.supportedEfforts.length > 0
      ? { reasoningEfforts: model.reasoning.supportedEfforts }
      : {}),
    ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultReasoningEffort: model.reasoning.defaultEffort }),
    ...(rate === undefined ? {} : { credits: rate }),
    ...(model.supportsImages === undefined ? {} : { supportsImages: model.supportsImages }),
  };
}

export function createQoderStatus({ providers }) {
  return {
    variants() {
      return Object.keys(VARIANTS);
    },

    async document(variant) {
      const entry = providerFor(providers(), variant);
      if (!entry) {
        return { status: 'signed-out', variant, reason: `variant not configured: ${variant}`, models: [] };
      }
      // provider 启动失败时 entry.provider 为 null
      const live = entry.provider;
      if (!live) {
        return {
          status: 'signed-out',
          variant,
          models: [],
          reason: entry.error ?? 'provider unavailable',
        };
      }

      // 登录态（真实读取；不含原始 PAT——status() 只给 patTail/source/savedAtMs）
      let auth = { state: 'signed-out' };
      try {
        auth = (await live.store?.status()) ?? { state: 'signed-out' };
      } catch (e) {
        return { status: 'signed-out', variant, models: [], reason: String(e?.message ?? e) };
      }
      if (auth.state !== 'configured') {
        return {
          status: 'signed-out',
          variant,
          models: [],
          ...(auth.reason === undefined ? {} : { reason: auth.reason }),
        };
      }

      const models = (live.models?.() ?? entry.models ?? []).map(toModelRow);

      // 目录来源
      let catalogField = {};
      if (live.catalogSource) {
        catalogField = { catalog: { ...(live.catalogSource() ?? {}) } };
      }

      // 额度（fetchCredits 无参）
      let creditsField = {};
      try {
        if (live.client?.fetchCredits) creditsField = { credits: await live.client.fetchCredits() };
      } catch (e) {
        creditsField = { creditsError: String(e?.message ?? e) };
      }

      // 签到状态（只读读取，不领取）
      let checkInField = {};
      try {
        if (live.client?.checkIn) checkInField = { checkIn: await live.client.checkIn() };
      } catch (e) {
        checkInField = { checkInError: String(e?.message ?? e) };
      }

      // 探针区（同 WorkBuddy 语义：候选 = 支持推理但上游未声明 effort 集）
      let probeField = {};
      const probeService = live.probeService;
      if (probeService) {
        const all = live.models?.() ?? entry.models ?? [];
        const candidates = all
          .filter((m) => m.reasoning?.supports === true && (m.reasoning.supportedEfforts?.length ?? 0) === 0)
          .map((m) => m.id);
        const results = all.flatMap((m) => {
          const record = probeService.recordFor(m.id);
          return record === undefined
            ? []
            : [{
                id: m.id,
                name: m.name ?? m.id,
                validation: record.validation,
                efforts: record.efforts,
                probedAt: record.probedAtMs,
              }];
        });
        probeField = { probe: { running: probeService.isRunning(), candidates, results } };
      }

      return {
        status: 'signed-in',
        variant,
        ...(auth.region === undefined ? {} : { region: auth.region }),
        // pat 只含 {source, savedAtMs, patTail}，是给人看的来源信息，不是密钥
        ...(auth.pat === undefined ? {} : { pat: auth.pat }),
        ...(auth.filePath === undefined ? {} : { filePath: auth.filePath }),
        ...catalogField,
        ...creditsField,
        ...checkInField,
        ...probeField,
        models,
      };
    },

    /** 手动探测一个模型的推理 effort（会真发上游请求并消耗额度） */
    async probe(variant, modelId) {
      const entry = providerFor(providers(), variant);
      if (!entry) return { state: 'failed', reason: `variant not configured: ${variant}` };
      if (!entry.provider) return { state: 'failed', reason: entry.error ?? 'provider unavailable' };
      if (typeof modelId !== 'string' || modelId === '') {
        return { state: 'failed', reason: 'probe requires a model id' };
      }
      const probeService = entry.provider.probeService;
      if (!probeService) {
        return { state: 'failed', reason: 'action not wired yet: probe (needs probe service)' };
      }
      try {
        return await probeService.probe(modelId, true);
      } catch (e) {
        return { state: 'failed', reason: String(e?.message ?? e) };
      }
    },

    /** 刷新模型目录 */
    async refresh(variant) {
      const entry = providerFor(providers(), variant);
      if (!entry) return { state: 'failed', reason: `variant not configured: ${variant}` };
      if (!entry.provider) return { state: 'failed', reason: entry.error ?? 'provider unavailable' };
      try {
        const out = await entry.provider.refreshModels();
        entry.models = entry.provider.models();
        return { state: 'updated', models: out.models ?? entry.models, errors: out.errors ?? [] };
      } catch (e) {
        return { state: 'failed', reason: String(e?.message ?? e) };
      }
    },
  };
}
