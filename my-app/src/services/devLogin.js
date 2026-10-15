const LOGIN_PATH = '/__day20-auth/signin';
const PROFILE_PATH = '/__day20-auth/user/me';
const TIMEOUT_MS = 30000;

class DevLoginError extends Error {
  constructor(message, { code, httpStatus = null, loginStatus = null, profileStatus = null }) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.loginStatus = loginStatus;
    this.profileStatus = profileStatus;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 仅由开发页面调用；认证代理不进入生产部署，凭证不保存到浏览器或文件。
export async function loginTestSession({ username, password, expectedUserId, signal, fetchImpl = globalThis.fetch }) {
  let loginStatus = null;
  let profileStatus = null;
  let token = null;
  let session = null;
  let profile = null;
  const error = (message, code) => new DevLoginError(message, {
    code, httpStatus: profileStatus ?? loginStatus, loginStatus, profileStatus,
  });
  if (typeof expectedUserId !== 'string' || !expectedUserId || expectedUserId.trim() !== expectedUserId) {
    throw error('本地测试账号配置缺失，请核对测试用户配置。', 'INVALID_CONFIGURATION');
  }
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    throw error('请填写已有测试账号的用户名和密码。', 'INVALID_INPUT');
  }
  if (typeof fetchImpl !== 'function') {
    throw error('当前环境无法发送登录请求。', 'INVALID_CONFIGURATION');
  }
  if (signal?.aborted) throw error('已取消本次登录与身份核验。', 'ABORTED');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const checkCancellation = () => {
    if (signal?.aborted) throw error('已取消本次登录与身份核验。', 'ABORTED');
    if (timedOut || controller.signal.aborted) {
      throw error('登录与身份核验超过 30 秒，请检查网络后手动重试。', 'TIMEOUT');
    }
  };
  try {
    const loginResponse = await fetchImpl(LOGIN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    loginStatus = loginResponse.status;
    // 请求已发送后立即放弃本函数内的账号密码引用；页面输入由界面同步清空。
    username = password = null;
    checkCancellation();
    if (loginStatus !== 200) {
      throw error('测试账号登录未成功，请核对已有用户名与密码。', 'LOGIN_FAILED');
    }
    try { session = await loginResponse.json(); } catch {
      throw error('登录接口返回异常，请核对当前认证服务。', 'INVALID_RESPONSE');
    }
    checkCancellation();
    if (!isObject(session) || typeof session.access_token !== 'string'
      || !session.access_token || session.access_token.length > 8192
      || /[\s\u0000-\u001f\u007f]/.test(session.access_token)) {
      throw error('登录响应未提供有效用户凭证，请重新登录。', 'INVALID_SESSION');
    }
    token = session.access_token;
    session = null;
    const profileResponse = await fetchImpl(PROFILE_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    profileStatus = profileResponse.status;
    checkCancellation();
    if (profileStatus !== 200) {
      throw error('用户身份核验未成功，请重新登录后再试。', 'PROFILE_FAILED');
    }
    try { profile = await profileResponse.json(); } catch {
      throw error('身份核验接口返回异常，请核对当前认证服务。', 'INVALID_RESPONSE');
    }
    checkCancellation();
    if (!isObject(profile) || typeof profile.sub !== 'string' || !profile.sub.trim()
      || profile.sub === 'anon' || profile.is_anonymous === true || profile.is_system_admin === true
      || profile.is_admin === true || ['anon', 'service_role', 'admin', 'system_admin'].includes(profile.role)
      || (profile.status !== undefined && profile.status !== 'ACTIVE')) {
      throw error('需要普通注册用户凭证，当前身份不符合测试要求。', 'INVALID_PROFILE');
    }
    if (profile.sub !== expectedUserId) {
      throw error('登录用户与已配置的测试账号不一致，请使用原测试账号。', 'TEST_USER_MISMATCH');
    }
    return { token, loginStatus, profileStatus, matched: true };
  } catch (caught) {
    if (signal?.aborted) throw error('已取消本次登录与身份核验。', 'ABORTED');
    if (timedOut) throw error('登录与身份核验超过 30 秒，请检查网络后手动重试。', 'TIMEOUT');
    if (caught instanceof DevLoginError) throw caught;
    // 不透传响应正文或底层错误，避免账号、密码、令牌与身份资料进入页面。
    throw error('登录或身份核验的网络请求失败，请检查网络后手动重试。', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    username = password = token = session = profile = null;
  }
}