const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCloudBaseAuth } = require('./auth');
const { createCloudBaseQuery } = require('./db');
const { ApiError, createReader } = require('./service');

function createServer({ authenticate, read, logError = () => {} }) {
  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch {
        throw new ApiError(400, 'INVALID_INPUT', '请求地址无效。');
      }
      let kind, bookId;
      if (url.pathname === '/api/entries') kind = 'entries';
      else if (url.pathname === '/api/favorites') kind = 'favorites';
      else {
        const match = /^\/api\/books\/([^/]+)\/notes$/.exec(url.pathname);
        if (!match) throw new ApiError(404, 'NOT_FOUND', '接口不存在。');
        kind = 'notes';
        try { bookId = decodeURIComponent(match[1]); } catch {
          throw new ApiError(400, 'INVALID_INPUT', '作品 ID 格式无效。');
        }
        if (!bookId || bookId.length > 128 || /[\s/\u0000-\u001f]/.test(bookId)) {
          throw new ApiError(400, 'INVALID_INPUT', '作品 ID 格式无效。');
        }
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此接口仅支持 GET 请求。');
      }
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) !== 0) {
        throw new ApiError(400, 'INVALID_INPUT', 'GET 请求不能包含请求体。');
      }
      const ownerId = await authenticate(request.headers.authorization);
      const data = await read({ kind, ownerId, bookId, params: url.searchParams });
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true, data, error: null }));
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
      if (status >= 500) logError({ requestId, code: known ? error.code : 'INTERNAL_ERROR' });
      response.writeHead(status);
      response.end(JSON.stringify({
        ok: false, data: null,
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : '读取失败，请稍后重试。',
          retryable: known ? error.retryable : true,
        },
      }));
    }
  });
}

function start() {
  const env = process.env;
  const authenticate = createCloudBaseAuth(env.CLOUDBASE_ENV_ID);
  const query = createCloudBaseQuery(env.CLOUDBASE_ENV_ID, env.CLOUDBASE_APIKEY);
  const packedCatalog = path.join(__dirname, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(fs.existsSync(packedCatalog)
    ? packedCatalog : path.join(__dirname, '..', '..', 'shared', 'catalog.json'), 'utf8'));
  const read = createReader({
    query,
    bookIds: new Set(catalog.books.map((book) => book.id)), cursorSecret: env.CURSOR_SECRET,
  });
  const server = createServer({ authenticate, read, logError: (event) => console.error('读取请求失败。', event) });
  server.listen(9000, '0.0.0.0', () => console.log('读取接口已启动，端口：9000。'));
  const shutdown = () => server.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
if (require.main === module) {
  try { start(); } catch {
    console.error('读取接口启动失败，请核对云函数环境变量。');
    process.exitCode = 1;
  }
}
module.exports = { createServer };
