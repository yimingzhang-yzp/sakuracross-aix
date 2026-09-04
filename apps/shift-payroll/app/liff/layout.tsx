import type { ReactNode } from 'react';

import { LiffProvider } from './liff-client';
import { LiffNav } from './nav';

export const dynamic = 'force-dynamic';

/**
 * LIFF 用レイアウト。LIFF ID は環境変数から解決し、未設定なら開発モード(ユーザー ID 手入力)。
 * 4 つの LIFF アプリを別 ID で作る場合はページごとに異なる ID を渡せるが、
 * 1 つの LIFF アプリで全ページを配信する運用(推奨)なら PREFERENCE の ID を共通で使う。
 */
export default function LiffLayout({ children }: { children: ReactNode }) {
  const liffId =
    process.env.LINE_STAFF_LIFF_ID_PREFERENCE?.trim() ||
    process.env.LINE_STAFF_LIFF_ID_SCHEDULE?.trim() ||
    process.env.LINE_STAFF_LIFF_ID_TIMECLOCK?.trim() ||
    process.env.LINE_STAFF_LIFF_ID_PAYSLIP?.trim() ||
    null;
  return (
    <LiffProvider liffId={liffId}>
      <main className="liff-main">
        <LiffNav />
        {children}
      </main>
    </LiffProvider>
  );
}
