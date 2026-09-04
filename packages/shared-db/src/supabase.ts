/**
 * Supabase クライアント(Auth / Storage 用)
 *
 * - サーバー側(Service Role): 管理画面の API・cron から使う。ブラウザに絶対に渡さない
 * - ブラウザ側(Anon Key):    管理画面のログイン UI から使う
 *
 * 環境変数が未設定のときは null を返し、呼び出し側でモック/スキップに分岐できるようにする。
 */
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

export interface SupabaseEnv {
  url: string | undefined;
  anonKey: string | undefined;
  serviceRoleKey: string | undefined;
}

export function getSupabaseEnv(env: Record<string, string | undefined> = process.env): SupabaseEnv {
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  };
}

export function isSupabaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const { url, anonKey } = getSupabaseEnv(env);
  return Boolean(url && anonKey);
}

let adminClient: SupabaseClient | null = null;

/**
 * Service Role キーで動くサーバー専用クライアント。未設定なら null。
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return null;
  }
  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

/**
 * Anon キーのクライアント(ブラウザ/サーバー両用)。未設定なら null。
 * セッション永続化はアプリ側(@supabase/ssr 等)で扱うため、ここでは無効にしている。
 */
export function createSupabaseAnonClient(): SupabaseClient | null {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return null;
  }
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
