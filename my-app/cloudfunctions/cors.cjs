// Day 20：精确允许一个静态托管来源；此校验不是登录凭证校验。
const ALLOWED_HEADERS = ['Accept', 'Authorization', 'Content-Type', 'X-Client-Time-Zone'];
const HEADER_NAMES = new Set(ALLOWED_HEADERS.map((name) => name.toLowerCase()));

function validateAllowedOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new Error('ALLOWED_ORIGIN 必须是完整的 HTTPS 来源地址。');
  }
  if (typeof value !== 'string' || !value || value.includes('*')
    || parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password
    || parsed.search || parsed.hash || value !== parsed.origin) {
    throw new Error('ALLOWED_ORIGIN 必须是无通配符、无路径的精确 HTTPS 来源地址。');
  }
  return value;
}

function createCors({ allowedOrigin, methods }) {
  // 测试可只注入业务依赖；生产启动必须先校验 ALLOWED_ORIGIN。
  if (allowedOrigin !== undefined) validateAllowedOrigin(allowedOrigin);
  const allowedMethods = [...methods, 'OPTIONS'];
  const methodNames = new Set(methods);
  return (request, response) => {
    const vary = response.getHeader('Vary');
    const varied = String(vary || '').split(',').map((name) => name.trim()).filter(Boolean);
    if (!varied.some((name) => name.toLowerCase() === 'origin')) varied.push('Origin');
    response.setHeader('Vary', varied.join(', '));
    const origin = request.headers.origin;
    if (origin === undefined) return { kind: 'continue' };
    if (!allowedOrigin || origin !== allowedOrigin) {
      return { kind: 'reject', code: 'CORS_ORIGIN_DENIED', message: '此页面来源未被允许访问接口。' };
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      if (!methodNames.has(method)) {
        return { kind: 'reject', code: 'CORS_METHOD_DENIED', message: '此跨域请求方法未被允许。' };
      }
      if (headers !== undefined && (typeof headers !== 'string' || (headers.trim()
        && !headers.split(',').every((name) => HEADER_NAMES.has(name.trim().toLowerCase()))))) {
        return { kind: 'reject', code: 'CORS_HEADERS_DENIED', message: '此跨域请求头未被允许。' };
      }
      response.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
      response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    }
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    return { kind: request.method === 'OPTIONS' ? 'preflight' : 'continue' };
  };
}

module.exports = { createCors, validateAllowedOrigin };
