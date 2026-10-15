const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCors, validateAllowedOrigin } = require(
  fs.existsSync(path.join(__dirname, 'cors.cjs')) ? './cors.cjs' : '../cors.cjs',
);
const { createCloudBaseAuth } = require('./auth');
const { createCloudBaseQuery } = require('./db');
const { ApiError, createReader } = require('./service');
const { createWriter } = require('./writer');

const BODY_LIMIT = 64 * 1024;
function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers['content-type'] || '')
    || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) {
    request.resume();
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须使用 application/json 和 UTF-8 编码。');
  }
  if (Number(request.headers['content-length'] || 0) > BODY_LIMIT) {
    request.resume();
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求体不能超过64 KiB。');
  }
  return new Promise((resolve, reject) => {
    let size = 0, exceeded = false;
    const chunks = [];
    request.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        exceeded = true;
        chunks.length = 0;
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求体不能超过64 KiB。'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (exceeded) return;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text));
      } catch { reject(new ApiError(400, 'INVALID_INPUT', '请求体必须是有效的 UTF-8 JSON。')); }
    });
    request.on('error', () => reject(new ApiError(400, 'INVALID_INPUT', '请求体读取失败，请重新提交。')));
    request.on('aborted', () => reject(new ApiError(400, 'INVALID_INPUT', '请求已中断，请重新提交。')));
  });
}

function createServer({ authenticate, read, write, allowedOrigin, logError = () => {}, logEvent = () => {} }) {
  const cors = createCors({ allowedOrigin, methods: ['GET', 'POST'] });
  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let writing = false;
    try {
      const corsResult = cors(request, response);
      if (corsResult.kind === 'reject') throw new ApiError(403, corsResult.code, corsResult.message);
      if (corsResult.kind === 'preflight') {
        response.writeHead(204);
        response.end();
        return;
      }
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
      writing = kind === 'entries' && request.method === 'POST';
      if (request.method !== 'GET' && !writing) {
        response.setHeader('Allow', kind === 'entries' ? 'GET, POST' : 'GET');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', kind === 'entries'
          ? '此接口仅支持 GET 或 POST 请求。' : '此接口仅支持 GET 请求。');
      }
      if (!writing && (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) !== 0)) {
        throw new ApiError(400, 'INVALID_INPUT', 'GET 请求不能包含请求体。');
      }
      if (writing && url.search) throw new ApiError(400, 'INVALID_INPUT', '新建日精进不接受查询参数。');
      const ownerId = await authenticate(request.headers.authorization);
      let data;
      if (writing) {
        const body = await readJson(request);
        data = await write({ ownerId, body, timeZone: request.headers['x-client-time-zone'] });
      } else data = await read({ kind, ownerId, bookId, params: url.searchParams });
      const status = writing ? 201 : 200;
      response.writeHead(status);
      response.end(JSON.stringify({ ok: true, data, error: null }));
      // 只记录关联 ID 与结果，不记录原文、日期、用户身份、凭证或请求头。
      if (writing) { try { logEvent({ requestId, method: 'POST', path: '/api/entries', status, code: 'CREATED' }); } catch {} }
    } catch (error) {
      request.resume();
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      const code = known ? error.code : writing ? 'WRITE_FAILED' : 'INTERNAL_ERROR';
      if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
      if (status >= 500) { try { logError({ requestId, code }); } catch {} }
      response.writeHead(status);
      response.end(JSON.stringify({
        ok: false, data: null,
        error: {
          code,
          message: known ? error.message : writing ? '写入失败，请稍后重试。' : '读取失败，请稍后重试。',
          retryable: known ? error.retryable : true,
          ...(known && error.fields ? { fields: error.fields } : {}),
        },
      }));
    }
  });
}

function start() {
  const env = process.env;
  const allowedOrigin = validateAllowedOrigin(env.ALLOWED_ORIGIN);
  const authenticate = createCloudBaseAuth(env.CLOUDBASE_ENV_ID);
  const query = createCloudBaseQuery(env.CLOUDBASE_ENV_ID, env.CLOUDBASE_APIKEY);
  const packedCatalog = path.join(__dirname, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(fs.existsSync(packedCatalog)
    ? packedCatalog : path.join(__dirname, '..', '..', 'shared', 'catalog.json'), 'utf8'));
  const read = createReader({
    query,
    bookIds: new Set(catalog.books.map((book) => book.id)), cursorSecret: env.CURSOR_SECRET,
  });
  const write = createWriter({ query });
  const server = createServer({ authenticate, read, write, allowedOrigin,
    logError: (event) => console.error('业务请求失败。', event),
    logEvent: (event) => console.log('日精进写入成功。', event),
  });
  server.listen(9000, '0.0.0.0', () => console.log('日精进写入与列表读取接口已启动，端口：9000。'));
  const shutdown = () => server.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
if (require.main === module) {
  try { start(); } catch {
    console.error('业务接口启动失败，请核对云函数环境变量。');
    process.exitCode = 1;
  }
}
module.exports = { createServer };
