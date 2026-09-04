import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// モノレポルートの .env を読み込む。
// アプリ直下の .env / .env.local は Next.js が先に読み込んでいるため、そちらが優先される(dotenv は既存値を上書きしない)。
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // モノレポのルートを明示(lockfile 複数検出の警告回避と、standalone 出力時のトレース範囲指定)
  outputFileTracingRoot: path.resolve(process.cwd(), '../../'),
  // Prisma のエンジンバイナリ・mammoth(Word 抽出)はバンドルせず Node.js 側で解決させる
  serverExternalPackages: ['@prisma/client', 'mammoth'],
  experimental: {
    serverActions: {
      // マニュアル取込(PDF / Word / 画像)のアップロード上限。lib/import/convert.ts の MAX_IMPORT_BYTES と揃える
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
