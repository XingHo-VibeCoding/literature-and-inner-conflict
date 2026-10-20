const TIMEOUT_MS = 30000;
const REGISTRATION_TIMEOUT_MS = 15000;
const REGISTERED_LOGIN_MESSAGE = '账号已创建，自动登录未完成，请切换登录后重试。';
const REGISTRATION_UNKNOWN_MESSAGE = '注册结果尚未确认，请先尝试登录；不要立即重复注册。';
const BLOCKED_ROLES = new Set(['anon', 'anonymous', 'admin', 'system_admin', 'service_role', 'systemadmin', 'serviceaccount']);
const LOGIN_FAILURES = {
  invalid_username_or_password: ['INVALID_CREDENTIALS', '用户名或密码不正确，请核对后重试。'],
  invalid_password: ['INVALID_CREDENTIALS', '用户名或密码不正确，请核对后重试。'],
  not_found: ['INVALID_CREDENTIALS', '用户名或密码不正确，请核对后重试。'],
  user_not_found: ['INVALID_CREDENTIALS', '用户名或密码不正确，请核对后重试。'],
  invalid_status: ['ACCOUNT_LOCKED', '登录尝试过多，账号暂时锁定，请稍后重试。'],
  captcha_required: ['CAPTCHA_REQUIRED', '登录需要额外验证，请稍后重试；若仍出现此提示，请联系站点维护者。'],
  password_not_set: ['PASSWORD_NOT_SET', '此账号尚未设置密码，请完成账号设置后再登录。'],
  user_pending: ['ACCOUNT_INACTIVE', '此账号尚未激活，请完成账号激活后再登录。'],
  user_blocked: ['ACCOUNT_INACTIVE', '此账号已停用，请联系站点维护者。'],
  login_type_disabled: ['LOGIN_DISABLED', '本站暂未开启用户名密码登录，请联系站点维护者。'],
  unimplemented: ['LOGIN_DISABLED', '本站暂未开启用户名密码登录，请联系站点维护者。'],
  unauthorized_client: ['LOGIN_DISABLED', '本站登录配置暂不可用，请联系站点维护者。'],
  permission_denied: ['LOGIN_UNAVAILABLE', '本站登录请求暂未获允许，请联系站点维护者检查安全来源。'],
  resource_exhausted: ['RATE_LIMITED', '登录请求过于频繁，请稍后手动重试。'],
};

class AccountAuthError extends Error {
  constructor(message, { code, loginStatus = null, profileStatus = null, registrationStatus = null, registered = false }) {
    super(message);
    this.name = 'AccountAuthError';
    this.code = code;
    this.httpStatus = profileStatus ?? loginStatus ?? registrationStatus;
    this.loginStatus = loginStatus;
    this.profileStatus = profileStatus;
    this.registrationStatus = registrationStatus;
    if (registered) this.registered = true;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseAuthOrigin(value, label = '登录服务') {
  const invalid = () => new AccountAuthError(label + '须配置完整的 HTTPS 域名，不附加路径、凭证、通配符、查询参数或片段。', {
    code: 'INVALID_CONFIGURATION',
  });
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('*')) throw invalid();
  let parsed;
  try { parsed = new URL(value); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.href !== parsed.origin + '/') throw invalid();
  return parsed.origin;
}

function roleIsBlocked(value) {
  return typeof value === 'string' && BLOCKED_ROLES.has(value.toLowerCase());
}

function isOrdinaryProfile(profile) {
  if (!isObject(profile) || typeof profile.sub !== 'string' || !profile.sub.trim()
    || profile.sub.trim() !== profile.sub || roleIsBlocked(profile.sub) || profile.status !== 'ACTIVE'
    || profile.is_anonymous === true || profile.is_system_admin === true || profile.is_admin === true
    || roleIsBlocked(profile.role) || roleIsBlocked(profile.internal_user_type) || roleIsBlocked(profile.type)) return false;
  for (const collection of [profile.roles, profile.groups]) {
    if (Array.isArray(collection) && collection.some(value => roleIsBlocked(value)
      || (isObject(value) && (roleIsBlocked(value.id) || roleIsBlocked(value.role))))) return false;
  }
  if (Array.isArray(profile.providers) && profile.providers.some(value => isObject(value)
    && ['anonymous', 'anon'].includes(value.id?.toLowerCase?.()))) return false;
  return true;
}

function isRegistrationInputValid(username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(username)
    || typeof password !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9()!@#$%^&*|?><_-]{7,31}$/.test(password)) return false;
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/].filter(pattern => pattern.test(password)).length >= 3;
}

function isRegistrationSuccess(value) {
  return isObject(value) && Object.keys(value).sort().join(',') === 'data,error,ok'
    && value.ok === true && value.error === null && isObject(value.data)
    && Object.keys(value.data).join(',') === 'registered' && value.data.registered === true;
}

// 仅使用页内短期凭证；不读取存储、不保留刷新令牌，也不返回用户身份资料。
export function createAccountAuthClient({ authOrigin, registrationOrigin, registrationRequestOrigin = registrationOrigin, fetchImpl = globalThis.fetch } = {}) {
  const origin = parseAuthOrigin(authOrigin);
  if (typeof fetchImpl !== 'function') throw new AccountAuthError('当前环境无法发送登录请求。', { code: 'INVALID_CONFIGURATION' });
  const client = {
    async signIn({ username, password, signal } = {}) {
      let loginStatus = null;
      let profileStatus = null;
      let session = null;
      let profile = null;
      let token = null;
      let timedOut = false;
      const error = (message, code) => new AccountAuthError(message, { code, loginStatus, profileStatus });
      if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:+ @-]{1,47}$/.test(username)
        || typeof password !== 'string' || !password) {
        throw error('请填写用户名和密码。用户名为 2–48 位，以英文字母或数字开头，可含 -_.:+ @。', 'INVALID_INPUT');
      }
      if (signal?.aborted) throw error('已取消本次登录。', 'ABORTED');
      const controller = new AbortController();
      let rejectCancellation;
      const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
      const cancel = () => {
        controller.abort();
        rejectCancellation(error('已取消本次登录。', 'ABORTED'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        rejectCancellation(error('登录与身份核验超过 30 秒，请检查网络后手动重试。', 'TIMEOUT'));
      }, TIMEOUT_MS);
      const checkCancellation = () => {
        if (signal?.aborted) throw error('已取消本次登录。', 'ABORTED');
        if (timedOut) throw error('登录与身份核验超过 30 秒，请检查网络后手动重试。', 'TIMEOUT');
      };
      const wait = async promise => {
        const result = await Promise.race([promise, cancellation]);
        checkCancellation();
        return result;
      };
      try {
        const request = fetchImpl(origin + '/auth/v1/signin', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        });
        username = password = null;
        const loginResponse = await wait(request);
        loginStatus = loginResponse.status;
        if (loginStatus !== 200) {
          let failure = null;
          try { failure = await wait(loginResponse.json()); } catch (caught) {
            checkCancellation();
            if (caught instanceof AccountAuthError) throw caught;
          }
          const known = isObject(failure) && Object.hasOwn(LOGIN_FAILURES, failure.error) ? LOGIN_FAILURES[failure.error] : null;
          failure = null;
          if (known) throw error(known[1], known[0]);
          if (loginStatus === 429) throw error('登录请求过于频繁，请稍后手动重试。', 'RATE_LIMITED');
          if (loginStatus === 401) throw error('用户名或密码不正确，请核对后重试。', 'INVALID_CREDENTIALS');
          if (loginStatus >= 500) throw error('登录服务暂时不可用，请稍后手动重试。', 'LOGIN_UNAVAILABLE');
          throw error('登录未成功，请核对输入后手动重试。', 'LOGIN_FAILED');
        }
        try { session = await wait(loginResponse.json()); } catch (caught) {
          checkCancellation();
          if (caught instanceof AccountAuthError) throw caught;
          throw error('登录服务返回异常，请稍后重新登录。', 'INVALID_RESPONSE');
        }
        if (!isObject(session) || typeof session.access_token !== 'string' || !session.access_token
          || session.access_token.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(session.access_token)
          || (session.token_type !== undefined && session.token_type !== 'Bearer')) {
          throw error('登录响应未提供有效会话，请重新登录。', 'INVALID_SESSION');
        }
        token = session.access_token;
        session = null;
        const profileResponse = await wait(fetchImpl(origin + '/auth/v1/user/me', {
          method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        }));
        profileStatus = profileResponse.status;
        if (profileStatus !== 200) throw error('用户身份核验未成功，请重新登录后再试。', 'PROFILE_FAILED');
        try { profile = await wait(profileResponse.json()); } catch (caught) {
          checkCancellation();
          if (caught instanceof AccountAuthError) throw caught;
          throw error('身份核验服务返回异常，请重新登录。', 'INVALID_RESPONSE');
        }
        if (!isOrdinaryProfile(profile)) throw error('当前会话不是有效的普通用户账号，请使用已激活的普通账号登录。', 'INVALID_PROFILE');
        return { token, loginStatus, profileStatus };
      } catch (caught) {
        checkCancellation();
        if (caught instanceof AccountAuthError) throw caught;
        // 不展示认证响应正文或底层错误，防止密码、令牌及用户资料进入界面。
        throw error('登录或身份核验的网络请求失败，请检查网络后手动重试。', 'NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        username = password = token = session = profile = null;
      }
    },
    async signUp({ username, password, signal } = {}) {
      let registrationStatus = null;
      let registered = false;
      const error = (message, code) => new AccountAuthError(message, { code, registrationStatus });
      try {
        if (!registrationOrigin) throw error('本站注册服务尚未配置，请联系站点维护者。', 'REGISTRATION_NOT_CONFIGURED');
        let requestOrigin;
        try {
          parseAuthOrigin(registrationOrigin, '注册服务');
          // 空请求来源仅供页面在开发环境选择同源代理；正式页面传入公网来源。
          requestOrigin = registrationRequestOrigin === '' ? '' : parseAuthOrigin(registrationRequestOrigin, '注册请求地址');
        } catch {
          throw error('本站注册服务地址配置无效，请联系站点维护者。', 'INVALID_CONFIGURATION');
        }
        if (!isRegistrationInputValid(username, password)) {
          throw error('用户名须为 2–48 位，以字母或数字开头，仅含字母、数字、点、下划线或连字符。密码须为 8–32 位，以字母或数字开头，且包含大写、小写、数字、允许符号中的至少三类。', 'INVALID_INPUT');
        }
        if (signal?.aborted) throw error('已取消本次注册。', 'ABORTED');
        const controller = new AbortController();
        let timedOut = false;
        let rejectCancellation;
        const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
        const cancel = () => {
          controller.abort();
          rejectCancellation(error('已取消本次注册。' + REGISTRATION_UNKNOWN_MESSAGE, 'ABORTED'));
        };
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          rejectCancellation(error('注册等待超过 15 秒。' + REGISTRATION_UNKNOWN_MESSAGE, 'REGISTRATION_TIMEOUT'));
        }, REGISTRATION_TIMEOUT_MS);
        const checkCancellation = () => {
          if (signal?.aborted) throw error('已取消本次注册。' + REGISTRATION_UNKNOWN_MESSAGE, 'ABORTED');
          if (timedOut) throw error('注册等待超过 15 秒。' + REGISTRATION_UNKNOWN_MESSAGE, 'REGISTRATION_TIMEOUT');
        };
        const wait = async promise => {
          const result = await Promise.race([promise, cancellation]);
          checkCancellation();
          return result;
        };
        try {
          const response = await wait(fetchImpl(requestOrigin + '/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          }));
          registrationStatus = response.status;
          let envelope = null;
          try { envelope = await wait(response.json()); } catch (caught) {
            checkCancellation();
            if (caught instanceof AccountAuthError) throw caught;
          }
          if (registrationStatus === 201) {
            if (!isRegistrationSuccess(envelope)) throw error(REGISTRATION_UNKNOWN_MESSAGE, 'REGISTRATION_UNKNOWN');
            registered = true;
          } else {
            const serverCode = isObject(envelope) && isObject(envelope.error) ? envelope.error.code : null;
            if (registrationStatus === 409 && serverCode === 'USERNAME_TAKEN') {
              throw error('这个用户名已被使用，请换一个用户名；如果是你自己的账号，请切换登录。', 'USERNAME_TAKEN');
            }
            if (registrationStatus === 400) throw error('注册信息不符合要求，请检查用户名和密码后再提交。', 'INVALID_INPUT');
            if (registrationStatus === 429) throw error('注册请求过于频繁，请稍后再试。', 'RATE_LIMITED');
            if (registrationStatus === 503) {
              throw error('注册服务暂不可用或结果未确认，请先尝试登录；不要立即重复注册。',
                serverCode === 'REGISTRATION_RESULT_UNKNOWN' ? 'REGISTRATION_UNKNOWN' : 'REGISTRATION_UNAVAILABLE');
            }
            throw error(REGISTRATION_UNKNOWN_MESSAGE, 'REGISTRATION_UNKNOWN');
          }
          envelope = null;
        } catch (caught) {
          checkCancellation();
          if (caught instanceof AccountAuthError) throw caught;
          throw error('注册网络请求未完成。' + REGISTRATION_UNKNOWN_MESSAGE, 'REGISTRATION_NETWORK_ERROR');
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
        }
        const pendingLogin = client.signIn({ username, password, signal });
        username = password = null;
        const result = await pendingLogin;
        return { ...result, registered: true };
      } catch (caught) {
        if (registered) throw new AccountAuthError(REGISTERED_LOGIN_MESSAGE, {
          code: 'REGISTERED_LOGIN_FAILED', registrationStatus, registered: true,
          loginStatus: caught instanceof AccountAuthError ? caught.loginStatus : null,
          profileStatus: caught instanceof AccountAuthError ? caught.profileStatus : null,
        });
        if (caught instanceof AccountAuthError) throw caught;
        throw error(REGISTRATION_UNKNOWN_MESSAGE, 'REGISTRATION_UNKNOWN');
      } finally {
        username = password = null;
      }
    },
  };
  return client;
}
