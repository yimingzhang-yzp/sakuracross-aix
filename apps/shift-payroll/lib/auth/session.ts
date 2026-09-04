/**
 * 管理画面の認証(Supabase Auth: メール + パスワード)
 *
 * - 本番: Supabase のセッション Cookie を検証し、Staff.authUserId → accessRole で権限判定
 * - ローカル: Supabase 未設定 かつ NODE_ENV !== 'production' のときだけ開発用バイパス(admin 固定)
 *
 * 初期管理者のブートストラップ: Staff に紐付いていないユーザーでも、メールが ADMIN_EMAILS
 * (カンマ区切り)に含まれていれば ADMIN 扱いにする。
 */

import { getPrisma, isDatabaseConfigured, isSupabaseConfigured } from '@sakura-cross/shared-db';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export type AccessRole = 'ADMIN' | 'STAFF';

export interface AdminSession {
  userId: string;
  email: string | null;
  name: string;
  role: AccessRole;
  staffId: string | null;
  /** 開発用バイパスで作られたセッション */
  devBypass: boolean;
}

export function isDevAuthBypass(): boolean {
  return !isSupabaseConfigured() && process.env.NODE_ENV !== 'production';
}

const DEV_SESSION: AdminSession = {
  userId: 'dev-admin',
  email: 'dev-admin@localhost',
  name: '開発用管理者',
  role: 'ADMIN',
  staffId: null,
  devBypass: true,
};

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Server Component からは Cookie を書けない(middleware が更新する)
        }
      },
    },
  });
}

export async function getSession(): Promise<AdminSession | null> {
  if (isDevAuthBypass()) return DEV_SESSION;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let staff: { id: string; name: string; accessRole: AccessRole } | null = null;
  if (isDatabaseConfigured()) {
    staff = await getPrisma().staff.findUnique({
      where: { authUserId: user.id },
      select: { id: true, name: true, accessRole: true },
    });
  }
  const email = user.email ?? null;
  const role: AccessRole = staff?.accessRole ?? (email && adminEmails().has(email.toLowerCase()) ? 'ADMIN' : 'STAFF');
  return {
    userId: user.id,
    email,
    name: staff?.name ?? email ?? user.id,
    role,
    staffId: staff?.id ?? null,
    devBypass: false,
  };
}

/** 管理画面用。未ログインは /login、権限不足は /forbidden へ */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'ADMIN') redirect('/forbidden');
  return session;
}

export async function signOut(): Promise<void> {
  if (isDevAuthBypass()) return;
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
