import { afterEach, describe, expect, it } from 'vitest';

import { isDatabaseConfigured } from './client.js';
import { pingDatabase } from './health.js';
import { getSupabaseAdmin, getSupabaseEnv, isSupabaseConfigured } from './supabase.js';

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe('DB 未設定時のフォールバック', () => {
  it('DATABASE_URL 未設定なら isDatabaseConfigured は false', () => {
    expect(isDatabaseConfigured({})).toBe(false);
    expect(isDatabaseConfigured({ DATABASE_URL: '   ' })).toBe(false);
    expect(isDatabaseConfigured({ DATABASE_URL: 'postgresql://x' })).toBe(true);
  });

  it('DATABASE_URL 未設定なら pingDatabase は skipped を返し例外を投げない', async () => {
    delete process.env.DATABASE_URL;
    await expect(pingDatabase()).resolves.toEqual({ status: 'skipped' });
  });
});

describe('Supabase 未設定時のフォールバック', () => {
  it('環境変数が無ければ未設定扱い', () => {
    expect(isSupabaseConfigured({})).toBe(false);
    expect(getSupabaseEnv({})).toEqual({ url: undefined, anonKey: undefined, serviceRoleKey: undefined });
  });

  it('URL と anon key が揃えば設定済み', () => {
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      }),
    ).toBe(true);
  });

  it('Service Role 未設定なら getSupabaseAdmin は null', () => {
    const saved = { ...process.env };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(getSupabaseAdmin()).toBeNull();
    } finally {
      process.env = saved;
    }
  });
});
