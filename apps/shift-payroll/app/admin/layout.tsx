import type { ReactNode } from 'react';

import { requireAdmin } from '@/lib/auth/session';

import { AdminNav } from './nav';
import { signOutAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="admin-shell">
      <aside className="admin-nav">
        <p className="brand">CROSS ROPPONGI</p>
        <p className="title">シフト・給与</p>
        <AdminNav />
        <div className="user">
          <div>{session.name}</div>
          <div>{session.devBypass ? '開発モード(認証バイパス)' : session.email}</div>
          {!session.devBypass ? (
            <form action={signOutAction} style={{ marginTop: 8 }}>
              <button type="submit" className="btn sm">
                ログアウト
              </button>
            </form>
          ) : null}
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
