'use client';

/**
 * LIFF クライアント共通処理
 * - liffId があれば LINE の LIFF SDK(CDN)を読み込み、ログイン → ID トークンを API に付ける
 * - liffId が無い(開発モード)なら `?dev_user=<lineUserId>` を localStorage に保存し、ヘッダで送る
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface LiffSdk {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(options?: { redirectUri?: string }): void;
  getIDToken(): string | null;
  getProfile(): Promise<{ userId: string; displayName: string }>;
  isInClient(): boolean;
  closeWindow(): void;
}

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

export interface LiffContextValue {
  ready: boolean;
  error: string | null;
  devMode: boolean;
  devUserId: string | null;
  setDevUserId: (id: string) => void;
  displayName: string | null;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  me: MeResponse | null;
  refreshMe: () => Promise<void>;
}

export interface MeResponse {
  registered: boolean;
  lineUserId: string;
  staff?: { id: string; name: string; role: string; roleLabel: string; isActive: boolean };
  pendingRegistration?: { status: string; nameInput: string } | null;
}

const LiffContext = createContext<LiffContextValue | null>(null);
const DEV_KEY = 'sakura-cross.devLineUserId';

export function LiffProvider({ liffId, children }: { liffId: string | null; children: ReactNode }) {
  const devMode = !liffId;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [devUserId, setDevUserIdState] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    if (devMode) {
      const fromQuery = new URLSearchParams(window.location.search).get('dev_user');
      const stored = window.localStorage.getItem(DEV_KEY);
      const id = fromQuery ?? stored;
      if (fromQuery) window.localStorage.setItem(DEV_KEY, fromQuery);
      setDevUserIdState(id);
      setDisplayName(id ? `開発ユーザー ${id}` : null);
      setReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    script.async = true;
    script.onload = async () => {
      try {
        const liff = window.liff!;
        await liff.init({ liffId: liffId! });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }
        setIdToken(liff.getIDToken());
        const profile = await liff.getProfile().catch(() => null);
        setDisplayName(profile?.displayName ?? null);
        setReady(true);
      } catch (e) {
        setError(`LIFF の初期化に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    script.onerror = () => setError('LIFF SDK を読み込めませんでした');
    document.head.appendChild(script);
  }, [devMode, liffId]);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
      if (idToken) headers.set('authorization', `Bearer ${idToken}`);
      if (devMode && devUserId) {
        headers.set('x-dev-line-user-id', devUserId);
        headers.set('x-dev-display-name', encodeURIComponent(`開発ユーザー ${devUserId}`));
      }
      return fetch(path, { ...init, headers, cache: 'no-store' });
    },
    [idToken, devMode, devUserId],
  );

  const refreshMe = useCallback(async () => {
    if (devMode && !devUserId) {
      setMe(null);
      return;
    }
    const res = await apiFetch('/api/liff/me');
    if (res.ok) setMe((await res.json()) as MeResponse);
    else setMe(null);
  }, [apiFetch, devMode, devUserId]);

  useEffect(() => {
    if (ready) void refreshMe();
  }, [ready, refreshMe]);

  const setDevUserId = useCallback((id: string) => {
    window.localStorage.setItem(DEV_KEY, id);
    setDevUserIdState(id);
    setDisplayName(`開発ユーザー ${id}`);
  }, []);

  const value = useMemo<LiffContextValue>(
    () => ({ ready, error, devMode, devUserId, setDevUserId, displayName, apiFetch, me, refreshMe }),
    [ready, error, devMode, devUserId, setDevUserId, displayName, apiFetch, me, refreshMe],
  );
  return <LiffContext.Provider value={value}>{children}</LiffContext.Provider>;
}

export function useLiff(): LiffContextValue {
  const ctx = useContext(LiffContext);
  if (!ctx) throw new Error('LiffProvider の内側で使ってください');
  return ctx;
}

/** 開発モードのユーザー切替 UI + 未登録時の案内。子要素は登録済みスタッフのときだけ表示 */
export function LiffGate({ children, allowUnregistered = false }: { children: ReactNode; allowUnregistered?: boolean }) {
  const { ready, error, devMode, devUserId, setDevUserId, me } = useLiff();
  const [input, setInput] = useState('');

  if (error) return <div className="alert error">{error}</div>;
  if (!ready) return <p className="muted">LINE に接続しています…</p>;

  const devPanel = devMode ? (
    <div className="alert warn" style={{ fontSize: 12 }}>
      <strong>開発モード</strong>(LIFF 未設定)。LINE ユーザー ID を指定して動作確認できます。シードデータ: <code>Udev-staff</code>(渡辺 花)/ <code>Udev-manager</code>(高橋 健)
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) setDevUserId(input.trim());
        }}
        className="inline"
        style={{ marginTop: 6 }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={devUserId ?? 'Udev-staff'} style={{ fontSize: 12 }} />
        <button type="submit" className="btn sm">
          切替
        </button>
        {devUserId ? <span className="muted">現在: {devUserId}</span> : null}
      </form>
    </div>
  ) : null;

  if (devMode && !devUserId) return devPanel;
  if (!me) return <>{devPanel}<p className="muted">ユーザー情報を取得しています…</p></>;
  if (!me.registered && !allowUnregistered) {
    return (
      <>
        {devPanel}
        <div className="alert warn">
          スタッフ登録が完了していません。
          {me.pendingRegistration ? `「${me.pendingRegistration.nameInput}」で申請中です。店長の承認をお待ちください。` : ''}
        </div>
        <a href="/liff/register" className="btn primary">
          登録画面へ
        </a>
      </>
    );
  }
  return (
    <>
      {devPanel}
      {children}
    </>
  );
}
