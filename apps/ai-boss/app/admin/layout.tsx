import { isDatabaseConfigured } from '@sakura-cross/shared-db';
import type { ReactNode } from 'react';

import { NavLinks } from './nav-links';
import { signOut } from '@/app/login/actions';
import { requireAdmin } from '@/lib/admin/auth';
import { getAiClient } from '@/lib/ai/client';
import { getStaffLineClient } from '@/lib/line/client';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const mocks: string[] = [];
  if (!isDatabaseConfigured()) mocks.push('DB: メモリ(再起動で消えます)');
  if (getAiClient().mode === 'mock') mocks.push('AI: モック(ANTHROPIC_API_KEY 未設定)');
  if (getStaffLineClient().mode === 'mock') mocks.push('LINE: モック(送信はログのみ)');

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          CROSS ROPPONGI
          <strong>AI上司 管理</strong>
        </div>
        <NavLinks />
        <div className="spacer" />
        <div className="user">
          {admin.name}
          <br />
          {admin.mode === 'dev-bypass' ? '(認証スキップ中)' : admin.email}
          {admin.mode === 'supabase' ? (
            <form action={signOut} style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-sm">
                ログアウト
              </button>
            </form>
          ) : null}
        </div>
      </aside>
      <main className="main">
        {mocks.length > 0 ? (
          <div className="notice notice-warn">
            <strong>ローカル開発モード:</strong> {mocks.join(' / ')}。接続情報を <code>.env</code> に設定すると実環境に切り替わります。
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
