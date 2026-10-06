#!/usr/bin/env node
/**
 * 一条命令依次启动前后端（开发态）：
 *   - 后端网关 src/server.mjs          → http://127.0.0.1:8790/v1
 *   - 前端 Vite dev server（热更新）   → http://127.0.0.1:5173/panel
 *
 * **顺序**：先起后端，等它真正监听端口了再起前端。网关要拉凭据、解析账号、
 * 抓模型目录才会 listen（server.mjs 的 boot 里 listen 在最后），而 Vite 一两秒
 * 就好了 —— 同时起的话浏览器先打开，面板打的全是连不上的 API，得手动刷新等后端。
 *
 * 零依赖：只用 node 内置模块，不引入 concurrently / npm-run-all。
 *
 * 两个子进程都用 stdio:'inherit'：输出直接进当前终端（保留颜色与进度条），
 * 也因此不需要在父进程里开管道 —— Windows 受限沙箱下带管道的 spawn 会 EPERM。
 * Ctrl+C 在 Windows 控制台是发给整个进程组的，两个子进程会自己收到；
 * 这里仍显式收尾，保证"谁先挂就一起挂"，不留孤儿进程占端口。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL_DIR = path.join(ROOT, 'panel');
const VITE_BIN = path.join(PANEL_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

const RELAY_PORT = process.env.RELAY_PORT ?? '8790';
const PANEL_PORT = process.env.PANEL_PORT ?? '5173';

if (!fs.existsSync(VITE_BIN)) {
  console.error('[dev] 前端依赖未安装：找不到 panel/node_modules/vite');
  console.error('[dev] 先执行一次：npm --prefix panel install');
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill();
      } catch {
        /* 进程可能刚好自己退了 */
      }
    }
  }
  // 留一点时间让子进程自己收尾（关闭 shim、释放端口）
  setTimeout(() => process.exit(code), 300);
}

function start(label, file, args, cwd) {
  const child = spawn(file, args, { cwd, env: process.env, stdio: 'inherit' });
  child.on('error', (e) => {
    console.error(`\n[dev] ${label} 启动失败: ${e.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev] ${label} 已退出（${signal ?? `code ${code}`}），一并停止另一个。`);
    shutdown(code ?? 0);
  });
  children.push({ label, child });
  return child;
}

/** 探测 127.0.0.1:port 是否能连上（连上即后端已 listen）。任何错误都当"还没起"。 */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 等网关监听端口。server.mjs 把 listen 放在所有 provider start() 之后，所以
 * "端口能连上" 就等价于 "后端真的可用"，不用额外探 HTTP。
 * 超时不阻断开发：打印提示后照样起前端（网关可能只是某个通道卡住）。
 */
async function waitForGateway(port, child, timeoutMs = 60_000) {
  const startedAt = Date.now();
  // 不打进度点：网关自己的启动日志（每个通道的 ✅/⚠️）就实时打在这行下面，
  // 点会和它挤在一起。
  console.log(`\n[dev] 等待后端就绪（127.0.0.1:${port}）…`);
  while (Date.now() - startedAt < timeoutMs) {
    if (shuttingDown) return false;
    // 自己起的网关已经退了（如端口被占）就不算就绪，交给 exit 处理器收尾
    if (child.exitCode !== null || child.signalCode !== null) return false;
    if (await portOpen(port)) {
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[dev] 后端就绪（${secs}s）`);
      return true;
    }
    await sleep(300);
  }
  console.warn(`[dev] 后端 ${timeoutMs / 1000}s 内未监听 ${port}，仍继续启动前端（面板 API 可能暂时连不上）。`);
  return false;
}

console.log('');
console.log('  local-relay  开发态');
console.log(`  后端网关    http://127.0.0.1:${RELAY_PORT}/v1`);
console.log(`  面板 API    http://127.0.0.1:${RELAY_PORT}/panel/api/health`);
console.log('  Ctrl+C 结束');

const gateway = start('gateway', process.execPath, [path.join(ROOT, 'src', 'server.mjs')], ROOT);
await waitForGateway(RELAY_PORT, gateway);

console.log(`  前端面板    http://127.0.0.1:${PANEL_PORT}/panel   ← 改 panel/src 即时热更新`);
console.log('');

// --host 127.0.0.1：不加的话 Vite 只监听 localhost，在本机解析成 ::1，
// 于是 127.0.0.1:5173 连不上（浏览器/脚本都会踩）。显式钉 IPv4 回环，
// 且不用裸 --host（那会绑 0.0.0.0，把带凭据的面板暴露到局域网）。
if (!shuttingDown) {
  start(
    'panel',
    process.execPath,
    [VITE_BIN, '--host', '127.0.0.1', '--port', PANEL_PORT, '--strictPort'],
    PANEL_DIR,
  );
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
