const http = require('node:http');

// 只提供健康检查；不读取数据库，也不处理业务请求。
const server = http.createServer((request, response) => {
  const pathname = request.url.split('?')[0];
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');

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

// CloudBase HTTP 云函数使用固定的 9000 端口，监听所有网卡。
server.listen(9000, '0.0.0.0', () => {
  console.log('健康检查服务已启动，端口：9000。');
});
