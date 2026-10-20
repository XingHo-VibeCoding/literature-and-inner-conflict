const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { RegistrationError, createRegistrar, TIMEOUT_MS } = require('./register');

const MAX_BODY_BYTES = 4096;
const HEADERS = new Set(['content-type', 'accept']);

function validateAllowedOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new Error('请配置精确的 HTTPS ALLOWED_ORIGIN。');
  }
  if (typeof value !== 'string' || parsed.protocol !== 'https:' || value !== parsed.origin
    || parsed.username || parsed.password || value.includes('*')) {
    throw new Error('请配置无路径、无通配符的精确 HTTPS ALLOWED_ORIGIN。');
  }
  return value;
}

function countHeader(request, name) {
  return request.rawHeaders.reduce((count, value, index) =>
    index % 2 === 0 && value.toLowerCase() === name ? count + 1 : count, 0);
}

async function readJson(request) {
  if (countHeader(request, 'content-type') !== 1
    || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers['content-type'] || '')
    || request.headers['content-encoding'] !== undefined) {
    throw new RegistrationError(415, 'INVALID_INPUT', '请使用 UTF-8 编码的 JSON 提交。');
  }
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RegistrationError(413, 'INVALID_INPUT', '注册请求不能超过 4 KB。');
  }
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    let done = false;
    request.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        reject(new RegistrationError(413, 'INVALID_INPUT', '注册请求不能超过 4 KB。'));
      } else chunks.push(chunk);
    });
    request.on('end', () => { if (!done) { done = true; resolve(); } });
    const failed = () => {
      if (!done) { done = true; reject(new RegistrationError(400, 'INVALID_INPUT', '注册请求未完整接收，请重新检查输入。')); }
    };
    request.on('error', failed);
    request.on('aborted', failed);
  });
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } catch {
    throw new RegistrationError(400, 'INVALID_INPUT', '注册请求不是有效的 UTF-8 JSON。');
  }
}

function createServer({ allowedOrigin, register, logEvent = () => {} }) {
  validateAllowedOrigin(allowedOrigin);
  if (typeof register !== 'function') throw new Error('注册处理器尚未配置。');
  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Vary', 'Origin');
    let status = 500;
    let code = 'REGISTRATION_UNAVAILABLE';
    const send = (nextStatus, payload, nextCode) => {
      status = nextStatus;
      code = nextCode;
      response.writeHead(status);
      response.end(status === 204 ? undefined : JSON.stringify(payload));
    };
    try {
      // 来源必须由浏览器发送且逐字相等；此约束不能代替多实例限流或反机器人服务。
      if (countHeader(request, 'origin') !== 1 || request.headers.origin !== allowedOrigin) {
        throw new RegistrationError(403, 'ORIGIN_DENIED', '此页面来源未被允许注册。');
      }
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      response.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
      if (request.url !== '/api/register') {
        throw new RegistrationError(404, 'NOT_FOUND', '注册接口地址不存在。');
      }
      if (request.method === 'OPTIONS') {
        const requestedHeaders = request.headers['access-control-request-headers'];
        if (request.headers['access-control-request-method'] !== 'POST'
          || (requestedHeaders !== undefined && (!requestedHeaders.trim()
            || !requestedHeaders.split(',').every((name) => HEADERS.has(name.trim().toLowerCase()))))) {
          throw new RegistrationError(403, 'PREFLIGHT_DENIED', '此注册请求的方法或请求头未被允许。');
        }
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
        send(204, null, 'PREFLIGHT_OK');
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS');
        throw new RegistrationError(405, 'METHOD_NOT_ALLOWED', '注册接口仅支持 POST。');
      }
      const input = await readJson(request);
      await register(input);
      send(201, { ok: true, data: { registered: true }, error: null }, 'REGISTERED');
    } catch (error) {
      request.resume();
      const known = error instanceof RegistrationError;
      const nextStatus = known ? error.status : 503;
      const nextCode = known ? error.code : 'REGISTRATION_RESULT_UNKNOWN';
      const message = known ? error.message : '注册结果尚未确认。请先尝试登录，勿重复注册。';
      if (known && Number.isInteger(error.retryAfter)) response.setHeader('Retry-After', String(error.retryAfter));
      send(nextStatus, { ok: false, data: null, error: { code: nextCode, message } }, nextCode);
    } finally {
      // 仅记录随机请求号、状态和固定错误码，禁止记录请求头、账号或正文。
      try { logEvent({ requestId, status, code }); } catch {}
    }
  });
}

function productionRegistrar(env) {
  const envId = env.CLOUDBASE_ENV_ID || '';
  const enabled = env.REGISTRATION_ENABLED === 'true';
  const secretId = env.REGISTRATION_SECRET_ID;
  const secretKey = env.REGISTRATION_SECRET_KEY;
  const token = env.REGISTRATION_SESSION_TOKEN;
  const hasConfig = typeof envId === 'string' && envId.trim() === envId
    && /^[a-z0-9][a-z0-9-]{2,127}$/.test(envId)
    && typeof secretId === 'string' && Boolean(secretId.trim())
    && typeof secretKey === 'string' && Boolean(secretKey.trim());
  let createUser;
  if (enabled && hasConfig) {
    // 管理 SDK 仅在生产启动时加载，不接受浏览器或已有 APIKey 替代 CAM 凭证。
    const tcb = require('tencentcloud-sdk-nodejs-tcb');
    const client = new tcb.tcb.v20180608.Client({
      credential: { secretId, secretKey, ...(token ? { token } : {}) },
      region: 'ap-shanghai',
      profile: {
        signMethod: 'TC3-HMAC-SHA256',
        httpProfile: { endpoint: 'tcb.tencentcloudapi.com', reqTimeout: TIMEOUT_MS / 1000 },
      },
    });
    createUser = (input) => client.CreateUser(input);
  }
  return createRegistrar({ envId, enabled, createUser });
}

function start() {
  const allowedOrigin = validateAllowedOrigin(process.env.ALLOWED_ORIGIN);
  const register = productionRegistrar(process.env);
  const server = createServer({ allowedOrigin, register, logEvent: (event) => console.log(JSON.stringify(event)) });
  server.listen(9000, '0.0.0.0');
  const stop = () => server.close();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return server;
}

if (require.main === module) start();
module.exports = { createServer, productionRegistrar, validateAllowedOrigin, MAX_BODY_BYTES };
