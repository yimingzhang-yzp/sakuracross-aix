'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError('メールアドレスまたはパスワードが正しくありません');
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
      <label style={labelStyle}>
        メールアドレス
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" />
      </label>
      <label style={labelStyle}>
        パスワード
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
      </label>
      {error ? <p style={{ color: '#dc2626', margin: 0, fontSize: 14 }}>{error}</p> : null}
      <button type="submit" disabled={busy} style={buttonStyle}>
        {busy ? 'ログイン中…' : 'ログイン'}
      </button>
      <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
        アカウントは Supabase Dashboard → Authentication → Users で発行します(SETUP.md 参照)。
      </p>
    </form>
  );
}

const labelStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15 };
const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  background: '#0f172a',
  color: '#fff',
  fontSize: 15,
  cursor: 'pointer',
};
