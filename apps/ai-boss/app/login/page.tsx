import { isSupabaseConfigured } from '@sakura-cross/shared-db';
import Link from 'next/link';

import { signIn } from './actions';
import { ActionForm } from '@/app/admin/action-form';
import { getAiBossEnv } from '@/lib/env';

const ERROR_MESSAGES: Record<string, string> = {
  forbidden:
    'このアカウントには管理者権限がありません。Staff.accessRole = ADMIN として紐付けるか、ADMIN_EMAILS にメールアドレスを追加してください。',
  unconfigured: '本番環境で Supabase が未設定のため管理画面を開けません。環境変数を設定してください。',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const configured = isSupabaseConfigured();
  const env = getAiBossEnv();

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <p className="small muted" style={{ letterSpacing: '0.08em' }}>
          CROSS ROPPONGI
        </p>
        <h1>AI上司 管理画面</h1>
        {error && ERROR_MESSAGES[error] ? <div className="notice notice-error">{ERROR_MESSAGES[error]}</div> : null}

        {!configured && !env.isProduction ? (
          <>
            <div className="notice notice-warn">
              Supabase が未設定のため、開発環境では認証をスキップしています。そのまま管理画面に入れます。
            </div>
            <Link className="btn btn-primary" href="/admin">
              管理画面へ
            </Link>
          </>
        ) : (
          <ActionForm action={signIn} submitLabel="ログイン">
            <div className="field">
              <label htmlFor="email">メールアドレス</label>
              <input id="email" className="input" type="email" name="email" autoComplete="username" required />
            </div>
            <div className="field">
              <label htmlFor="password">パスワード</label>
              <input id="password" className="input" type="password" name="password" autoComplete="current-password" required />
            </div>
          </ActionForm>
        )}
        <p className="small muted" style={{ marginTop: 16 }}>
          管理者アカウントは Supabase Dashboard → Authentication → Users で作成します(SETUP.md 参照)。
        </p>
      </div>
    </div>
  );
}
