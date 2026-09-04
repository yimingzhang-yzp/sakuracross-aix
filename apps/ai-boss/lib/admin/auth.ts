/**
 * 管理画面の認証・認可(Supabase Auth、メール + パスワード)。
 *
 * 認可ルール(いずれかを満たせば管理者):
 *   1. Staff.authUserId がログインユーザーの ID と一致し、accessRole = ADMIN
 *   2. メールアドレスが ADMIN_EMAILS(カンマ区切り)に含まれる(初期管理者のブートストラップ用)
 *
 * Supabase 未設定(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 無し)のときは、
 * 開発環境に限り「認証スキップ」で入れる(本番では拒否)。
 */
import { getSupabaseEnv, isSupabaseConfigured } from '@sakura-cross/shared-db';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAiBossEnv } from '../env';
import { getStore } from '../store';

export interface AdminIdentity {
  /** Supabase Auth のユーザー ID(dev-bypass のときは "dev") */
  id: string;
  email: string;
  /** 表示名(Staff.name があればそれ、無ければメール) */
  name: string;
  mode: 'supabase' | 'dev-bypass';
}

export type AdminSession =
  | { status: 'ok'; admin: AdminIdentity }
  | { status: 'anonymous' }
  | { status: 'forbidden'; email: string }
  | { status: 'unconfigured' };

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) return null;
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からの呼び出しでは cookie を書けない(middleware がセッション更新を担う)
        }
      },
    },
  });
}

export async function getAdminSession(): Promise<AdminSession> {
  const env = getAiBossEnv();
  if (!isSupabaseConfigured()) {
    if (env.isProduction) return { status: 'unconfigured' };
    return {
      status: 'ok',
      admin: { id: 'dev', email: 'dev@localhost', name: '開発者(認証スキップ)', mode: 'dev-bypass' },
    };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: 'unconfigured' };
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { status: 'anonymous' };
  const email = (user.email ?? '').toLowerCase();

  const store = await getStore();
  const staff = await store.findStaffByAuthUserId(user.id);
  if (staff && staff.accessRole === 'ADMIN' && staff.isActive) {
    return { status: 'ok', admin: { id: user.id, email, name: staff.name, mode: 'supabase' } };
  }
  if (email && env.adminEmails.includes(email)) {
    return { status: 'ok', admin: { id: user.id, email, name: staff?.name ?? email, mode: 'supabase' } };
  }
  return { status: 'forbidden', email };
}

/**
 * 管理者でなければ /login にリダイレクトする(Server Component / Server Action 用)。
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const session = await getAdminSession();
  switch (session.status) {
    case 'ok':
      return session.admin;
    case 'anonymous':
      redirect('/login');
    case 'forbidden':
      redirect('/login?error=forbidden');
    case 'unconfigured':
      redirect('/login?error=unconfigured');
  }
}
