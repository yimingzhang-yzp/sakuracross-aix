/**
 * AI上司アプリの環境変数(ルート .env は next.config.ts の dotenv で読み込み済み)
 */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export interface AiBossEnv {
  nodeEnv: string;
  isProduction: boolean;
  appUrl: string;
  /** shift: 宛て postback / follow を転送する先(shift-payroll の内部 API)。未設定なら転送せずログのみ */
  shiftPayrollInternalUrl: string | undefined;
  internalApiSecret: string | undefined;
  cronSecret: string | undefined;
  /** 管理画面にログインできるメールアドレス(Staff.authUserId 紐付けが無い初期管理者向け) */
  adminEmails: string[];
  knowledgeBucket: string;
}

export function getAiBossEnv(env: Record<string, string | undefined> = process.env): AiBossEnv {
  const nodeEnv = env.NODE_ENV ?? 'development';
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    appUrl: nonEmpty(env.NEXT_PUBLIC_APP_URL_AI_BOSS) ?? 'http://localhost:3002',
    shiftPayrollInternalUrl: nonEmpty(env.SHIFT_PAYROLL_INTERNAL_URL),
    internalApiSecret: nonEmpty(env.INTERNAL_API_SECRET),
    cronSecret: nonEmpty(env.CRON_SECRET),
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    knowledgeBucket: nonEmpty(env.SUPABASE_STORAGE_BUCKET_KNOWLEDGE) ?? 'knowledge-uploads',
  };
}
