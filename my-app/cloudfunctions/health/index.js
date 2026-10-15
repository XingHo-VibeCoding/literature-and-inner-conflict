const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createCors, validateAllowedOrigin } = require(
  fs.existsSync(path.join(__dirname, 'cors.cjs')) ? './cors.cjs' : '../cors.cjs',
);

// 只提供健康检查；不读取数据库，也不处理业务请求。
function createServer({ allowedOrigin } = {}) {
  const cors = createCors({ allowedOrigin, methods: ['GET'] });
  return http.createServer((request, response) => {
    const pathname = request.url.split('?')[0];
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const corsResult = cors(request, response);
    if (corsResult.kind === 'reject') {
      request.resume();
      response.writeHead(403);
      response.end(JSON.stringify({
        ok: false,
        error: { code: corsResult.code, message: corsResult.message },
      }));
      return;
    }
    if (corsResult.kind === 'preflight') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (pathname !== '/api/health') {
      response.writeHead(404);
      response.end(JSON.stringify({
        ok: false,
        error: { code: 'NOT_FOUND', message: '接口不存在。' },
      }));
      return;
    }

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.writeHead(405);
      response.end(JSON.stringify({
        ok: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 GET 请求。' },
      }));
      return;
    }

    response.writeHead(200);
    response.end(JSON.stringify({
      ok: true,
      service: '【literature-and-inner-conflict】',
    }));
  });
}

function start() {
  const allowedOrigin = validateAllowedOrigin(process.env.ALLOWED_ORIGIN);
  const server = createServer({ allowedOrigin });
  // CloudBase HTTP 云函数使用固定的 9000 端口，监听所有网卡。
  server.listen(9000, '0.0.0.0', () => {
    console.log('健康检查服务已启动，端口：9000。');
  });
}
if (require.main === module) {
  try { start(); } catch {
    console.error('健康检查服务启动失败，请核对 ALLOWED_ORIGIN 环境变量。');
    process.exitCode = 1;
  }
}
module.exports = { createServer };
