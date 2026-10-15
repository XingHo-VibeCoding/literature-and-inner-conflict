import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function requireOrigin(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} 必须配置为完整 HTTPS 公网来源。`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash || value.includes('*')) {
    throw new Error(`${name} 必须是无路径、无凭证、无通配符的 HTTPS 来源。`);
  }
  return parsed.origin;
}

export default defineConfig(({ mode }) => {
  // VITE 变量只配置公开地址和测试账号标识，不能放密码或密钥。
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiOrigin = requireOrigin(env.VITE_API_ORIGIN, 'VITE_API_ORIGIN');
  const staticOrigin = requireOrigin(env.VITE_STATIC_ORIGIN, 'VITE_STATIC_ORIGIN');
  const authOrigin = mode === 'development'
    ? requireOrigin(env.VITE_AUTH_ORIGIN, 'VITE_AUTH_ORIGIN') : null;
  const loginRoutes = {
    '/__day20-auth/signin': { method: 'POST', upstream: '/auth/v1/signin' },
    '/__day20-auth/user/me': { method: 'GET', upstream: '/auth/v1/user/me' },
  };
  const loginProxy = {};
  if (authOrigin) {
    for (const [localPath, route] of Object.entries(loginRoutes)) {
      loginProxy[`^${localPath}$`] = {
        target: authOrigin, changeOrigin: true,
        headers: { Origin: staticOrigin },
        rewrite: () => route.upstream,
      };
    }
  }
  return {
    plugins: [react(), ...(authOrigin ? [{
      name: 'day20-local-login',
      // 只允许既有登录POST和身份GET，其他方法在转发前停止。
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const route = loginRoutes[request.url];
          if (!route || request.method === route.method) return next();
          response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: route.method });
          response.end(JSON.stringify({ error: '本地登录核验入口不支持此请求方法。' }));
        });
      },
    }] : [])],
    server: {
      host: 'localhost', port: 5173, strictPort: true,
      proxy: {
        // 本地同源代理只转发本任务指定的公网接口，不放行localhost跨域。
        '^/api/(?:health|entries)(?:\\?|$)': {
          target: apiOrigin, changeOrigin: true,
          headers: { Origin: staticOrigin },
        },
        ...loginProxy,
      },
    },
  };
});
