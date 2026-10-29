import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createAccountAuthClient } from '../services/accountAuth.js';
import { createAccountSession } from '../services/accountSession.js';
import AccountPanel from './AccountPanel.jsx';
import { createPublicApiClient } from '../services/publicApi.js';
import { createAccountData } from '../services/accountData.js';
import { listBooks } from '../services/catalog.js';

const AccountContext = createContext(null);

function configuredSession() {
  try {
    const apiOrigin = import.meta.env.VITE_API_ORIGIN || '';
    const authOrigin = import.meta.env.VITE_AUTH_ORIGIN || '';
    const authClient = createAccountAuthClient({ authOrigin, registrationOrigin: apiOrigin,
      registrationRequestOrigin: import.meta.env.DEV ? '' : apiOrigin, includeSessionExpiry: true });
    let storage = null;
    try { storage = window.localStorage; } catch { /* 浏览器禁止存储时由会话服务给出提示。 */ }
    return createAccountSession({ authClient, authOrigin, storage, eventTarget: window });
  } catch {
    // 配置不完整时仍可浏览公开页面，不发送任何占位认证请求。
    const snapshot = Object.freeze({ status: 'error', mode: null, token: '', version: 0,
      message: '账户服务暂未正确配置，请联系站点维护者。', configurationError: true });
    return { getSnapshot: () => snapshot, subscribe: () => () => {},
      restore: async () => {}, dispose() {}, cancel() {}, signOut() {}, invalidate() {}, getToken: () => '',
      signIn: async () => {}, signUp: async () => {} };
  }
}

export function AccountSessionProvider({ children, session: suppliedSession }) {
  const [session] = useState(() => suppliedSession || configuredSession());
  const [data] = useState(() => {
    try {
      const apiOrigin = import.meta.env.VITE_API_ORIGIN || '';
      const apiClient = createPublicApiClient({ apiOrigin, requestOrigin: import.meta.env.DEV ? '' : apiOrigin });
      return createAccountData({ apiClient, session, bookIds: listBooks().map(book => book.id) });
    } catch { return null; }
  });
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    session.restore().catch(() => {});
    return () => { data?.dispose(); session.dispose(); };
  }, [session, data]);
  const value = useMemo(() => ({ session, snapshot, data,
    signedIn: snapshot.status === 'signedIn',
    busy: snapshot.status === 'authenticating' || snapshot.status === 'restoring',
  }), [session, snapshot, data]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountSession() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('账户界面需要放在全站账户容器内。');
  return value;
}

export function AccountAccess({ disabled = false, onBeforeSubmit, onCancel }) {
  const { session, snapshot, signedIn, busy } = useAccountSession();
  const message = snapshot.message || (signedIn ? '欢迎回来，接着记录与阅读。' : snapshot.status === 'restoring'
    ? '正在核验已保存的登录状态…' : snapshot.status === 'authenticating'
      ? snapshot.mode === 'register' ? '正在创建账号并登录…' : '正在登录并验证身份…' : '');
  const hasError = snapshot.status === 'error' || (!signedIn && !busy && message
    && !message.startsWith('已退出') && !message.startsWith('已取消'));
  const state = { status: busy ? 'loading' : hasError ? 'error' : signedIn ? 'success' : 'idle',
    message, registered: snapshot.registered, suggestLogin: snapshot.suggestLogin };
  return <div className="account-access">
    <AccountPanel state={state} signedIn={signedIn}
      disabled={disabled || snapshot.configurationError === true}
      onSubmit={async ({ mode, ...input }) => {
        onBeforeSubmit?.();
        try { await (mode === 'register' ? session.signUp(input) : session.signIn(input)); } catch { /* 安全文案由共享会话提供。 */ }
      }}
      onCancel={() => { session.cancel(); onCancel?.(); }} onLogout={() => session.signOut()} />
    {snapshot.canRestore && <button className="account-restore" type="button" disabled={disabled || busy}
      onClick={() => session.restore().catch(() => {})}>重新核验已保存的登录</button>}
  </div>;
}