'use server';

import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/admin/auth';
import type { ActionState } from '@/app/admin/action-state';

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'メールアドレスとパスワードを入力してください' };

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: 'Supabase が未設定です(.env の NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)。' };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: 'ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。' };
  }
  redirect('/admin');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect('/login');
}
