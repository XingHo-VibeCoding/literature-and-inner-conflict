const { ApiError } = require('./service');

// 由 CloudBase 验证真实登录令牌；请求里自填的用户 ID 永远不作为身份。
function createCloudBaseAuth(envId, fetchImpl = fetch) {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(envId || '')) {
    throw new Error('请在云函数配置有效的 CLOUDBASE_ENV_ID。');
  }
  const endpoint = `https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`;
  return async function authenticate(authorization) {
    const match = typeof authorization === 'string'
      && /^Bearer ([^\s]{1,8192})$/i.exec(authorization);
    if (!match) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录再读取个人数据。');
    const token = match[1];
    // 只用于拒绝非用户令牌；认证与身份归属仍以远端核验结果为准。
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (claims.role === 'anon' || claims.role === 'service_role'
          || claims.is_anonymous === true || claims.is_system_admin === true) {
          throw new ApiError(401, 'UNAUTHENTICATED', '请使用注册用户的登录凭证。');
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // 不在本地解码结果上建立信任，仍交给 CloudBase 核验。
    }
    let result;
    try {
      result = await fetchImpl(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      throw new ApiError(500, 'INTERNAL_ERROR', '暂时无法验证登录状态，请稍后重试。', true);
    }
    if ([400, 401, 403].includes(result.status)) {
      throw new ApiError(401, 'UNAUTHENTICATED', '登录凭证无效或已过期，请重新登录。');
    }
    if (!result.ok) {
      throw new ApiError(500, 'INTERNAL_ERROR', '暂时无法验证登录状态，请稍后重试。', true);
    }
    let profile;
    try { profile = await result.json(); } catch {
      throw new ApiError(500, 'INTERNAL_ERROR', '登录服务返回异常，请稍后重试。', true);
    }
    if (!profile || typeof profile.sub !== 'string' || !profile.sub.trim()
      || profile.sub === 'anon' || profile.is_anonymous === true
      || profile.is_system_admin === true
      || (profile.status !== undefined && profile.status !== 'ACTIVE')) {
      throw new ApiError(401, 'UNAUTHENTICATED', '无法确认有效的用户身份，请重新登录。');
    }
    return profile.sub;
  };
}

module.exports = { createCloudBaseAuth };
