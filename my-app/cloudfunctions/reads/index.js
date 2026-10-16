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
  const cors = createCors({ allowedOrigin, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
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
      let kind, bookId, entryId;
      if (url.pathname === '/api/entries') kind = 'entries';
      else if (url.pathname === '/api/favorites') kind = 'favorites';
      else {
        const entryMatch = /^\/api\/entries\/([^/]+)$/.exec(url.pathname);
        const noteMatch = /^\/api\/books\/([^/]+)\/notes$/.exec(url.pathname);
        if (!entryMatch && !noteMatch) throw new ApiError(404, 'NOT_FOUND', '接口不存在。');
        kind = entryMatch ? 'entry' : 'notes';
        let id;
        try { id = decodeURIComponent((entryMatch || noteMatch)[1]); } catch {
          throw new ApiError(400, 'INVALID_INPUT', '资源 ID 格式无效。');
        }
        if (!id.trim() || id.length > (entryMatch ? 512 : 128) || /[\/\u0000-\u001f\u007f]/.test(id)
          || (!entryMatch && /\s/.test(id))) {
          throw new ApiError(400, 'INVALID_INPUT', '资源 ID 格式无效。');
        }
        if (entryMatch) entryId = id;
        else bookId = id;
      }
      const methods = kind === 'entries' ? ['GET', 'POST']
        : kind === 'entry' ? ['PATCH', 'DELETE'] : ['GET'];
      writing = methods.includes(request.method) && request.method !== 'GET';
      if (!methods.includes(request.method)) {
        response.setHeader('Allow', methods.join(', '));
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', `此接口仅支持 ${methods.join('、')} 请求。`);
      }
      const jsonBody = request.method === 'POST' || request.method === 'PATCH';
      if (!jsonBody && (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) !== 0)) {
        throw new ApiError(400, 'INVALID_INPUT', `${request.method} 请求不能包含请求体。`);
      }
      let expectedRevision;
      if (request.method === 'DELETE') {
        const revisionText = url.searchParams.get('expectedRevision');
        if ([...url.searchParams.keys()].length !== 1 || !/^[1-9]\d*$/.test(revisionText || '')
          || !Number.isSafeInteger(Number(revisionText))) {
          throw new ApiError(400, 'INVALID_INPUT', '删除必须且只能提供一个有效的 expectedRevision 查询参数。');
        }
        expectedRevision = Number(revisionText);
      } else if (writing && url.search) {
        throw new ApiError(400, 'INVALID_INPUT', '新增或修改日精进不接受查询参数。');
      }
      const ownerId = await authenticate(request.headers.authorization);
      let data;
      if (writing) {
        const body = jsonBody ? await readJson(request) : undefined;
        data = await write({ ownerId, body, operation: request.method, entryId, expectedRevision,
          timeZone: request.headers['x-client-time-zone'] });
      } else data = await read({ kind, ownerId, bookId, params: url.searchParams });
      const status = request.method === 'POST' ? 201 : 200;
      response.writeHead(status);
      response.end(JSON.stringify({ ok: true, data, error: null }));
      // 只记录关联 ID 与结果，不记录原文、日期、用户身份、凭证或请求头。
      if (writing) {
        try {
          logEvent({ requestId, method: request.method,
            path: kind === 'entry' ? '/api/entries/:entryId' : '/api/entries', status,
            code: request.method === 'POST' ? 'CREATED' : request.method === 'PATCH' ? 'UPDATED' : 'DELETED' });
        } catch {}
      }
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
          message: status >= 500 ? '服务暂时不可用，请稍后重试。' : error.message,
          retryable: known ? error.retryable : true,
          ...(known && status < 500 && error.fields ? { fields: error.fields } : {}),
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
