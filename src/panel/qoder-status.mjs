/**
 * Qoder 面板占位。
 *
 * 原因：dsh-qoder-connect 的 createQoderTransport / getMachineId 未从包导出，
 * 且本机尚未安装 qoderclicn、无 Qoder 凭据，无法完成装配验证。
 * 这里明确返回 not-implemented，避免面板显示成"已登录但无模型"而误导。
 */
export function createQoderStatus() {
  return {
    async document() {
      return {
        status: 'not-implemented',
        reason: 'Qoder 通道尚未接入：需要 qoderclicn 登录后再装配 transport（见 README 已知限制）',
        models: [],
      };
    },
  };
}
