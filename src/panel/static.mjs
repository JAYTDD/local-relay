/**
 * 托管 Vite 构建产物。
 *
 * 约定：/panel 与 /panel/* 走静态；带扩展名的请求命中不到文件则 404，
 * 不带扩展名的回退 index.html（SPA 路由）。
 */
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const PREFIX = '/panel';

export function createStaticHandler({ distDir }) {
  const root = path.resolve(distDir);

  /** 把 /panel/xxx 映射到磁盘路径，越界返回 undefined */
  function resolveFile(pathname) {
    const rel = pathname.slice(PREFIX.length).replace(/^\/+/, '');
    const target = path.resolve(root, rel === '' ? 'index.html' : rel);
    if (target !== root && !target.startsWith(root + path.sep)) return undefined;
    return target;
  }

  function send(res, status, body, type) {
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  return {
    async handle(req, res, pathname) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) return false;

      if (!fs.existsSync(path.join(root, 'index.html'))) {
        send(res, 503, 'panel not built yet — run: npm run build:panel', 'text/plain; charset=utf-8');
        return true;
      }

      const target = resolveFile(pathname);
      if (target === undefined) {
        send(res, 404, 'not found', 'text/plain; charset=utf-8');
        return true;
      }

      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        const type = CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
        send(res, 200, fs.readFileSync(target), type);
        return true;
      }

      // 带扩展名 = 资源缺失；否则当 SPA 路由回退
      if (path.extname(pathname) !== '') {
        send(res, 404, 'not found', 'text/plain; charset=utf-8');
        return true;
      }
      send(res, 200, fs.readFileSync(path.join(root, 'index.html')), CONTENT_TYPES['.html']);
      return true;
    },
  };
}
