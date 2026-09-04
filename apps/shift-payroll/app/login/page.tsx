import { isSupabaseConfigured } from '@sakura-cross/shared-db';
import Link from 'next/link';

import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const configured = isSupabaseConfigured();
  const devBypass = !configured && process.env.NODE_ENV !== 'production';

  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24 }}>
      <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.08em', color: '#64748b' }}>CROSS ROPPONGI</p>
      <h1 style={{ marginTop: 4, fontSize: 22 }}>シフト・給与 管理画面</h1>

      {devBypass ? (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: 12, fontSize: 14 }}>
          <strong>開発モード</strong>
          <p style={{ margin: '6px 0' }}>
            Supabase が未設定のため、ログインなしで管理者として利用できます(本番では無効になります)。
          </p>
          <Link href={next && next.startsWith('/') ? next : '/admin'} style={buttonStyle}>
            管理画面へ進む
          </Link>
        </div>
      ) : (
        <LoginForm next={next && next.startsWith('/') ? next : '/admin'} />
      )}
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 8,
  padding: '8px 14px',
  borderRadius: 8,
  background: '#0f172a',
  color: '#fff',
  textDecoration: 'none',
  fontSize: 14,
};
