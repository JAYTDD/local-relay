/**
 * 请求日志：环形缓冲，只记元数据（时间/通道/模型/结果/耗时/错误摘要），
 * 不记请求与响应正文——正文里可能带着用户的代码与凭据上下文。
 * 内存态，重启即清（诊断用途，不值得为它加写盘）。
 */
const CAP = Math.max(1, Number(process.env.RELAY_LOG_CAP) || 500);
let entries = [];
let dropped = 0;

/** 记一条请求元数据（字段由调用方决定，这里只负责环形与时间戳） */
export function logRequest(entry) {
  entries.push({ at: Date.now(), ...entry });
  if (entries.length > CAP) {
    dropped += entries.length - CAP;
    entries = entries.slice(entries.length - CAP);
  }
}

/** newest-first 快照（逐条拷贝，防调用方改内部态） */
export function snapshotLogs() {
  return { entries: entries.map((e) => ({ ...e })).reverse(), dropped, cap: CAP };
}

/** 测试与运维用：清空 */
export function resetLogs() {
  entries = [];
  dropped = 0;
}
