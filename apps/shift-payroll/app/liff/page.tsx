'use client';

import Link from 'next/link';

import { LiffGate, useLiff } from './liff-client';

/**
 * LIFF のトップ(メニュー)。
 * LIFF のエンドポイント URL はこのページ(/liff)に設定する。
 * こうすることで `https://liff.line.me/<LIFF ID>/preference` のようなパス付きリンクが
 * `/liff/preference` に正しく解決される。
 */
const ITEMS = [
  { href: '/liff/preference', label: '希望シフト提出', description: '半月分の希望を ○ / × / 早番 / 遅番 で送信' },
  { href: '/liff/schedule', label: '確定シフト確認', description: '自分の確定した勤務予定を確認' },
  { href: '/liff/timeclock', label: '打刻', description: '出勤・退勤の打刻と、打刻漏れの修正申請' },
  { href: '/liff/payslip', label: '給与明細', description: '確定済みの明細と日別の内訳' },
] as const;

export default function LiffHomePage() {
  const { me } = useLiff();

  return (
    <>
      <h1>CROSS ROPPONGI スタッフ</h1>
      <LiffGate allowUnregistered>
        {me?.registered ? (
          <>
            <p className="muted small">{me.staff?.name} さん、お疲れさまです。使いたい機能を選んでください。</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="card"
                  style={{ marginBottom: 0, textDecoration: 'none', color: 'inherit' }}
                >
                  <strong style={{ fontSize: 16 }}>{item.label}</strong>
                  <div className="muted small">{item.description}</div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="alert warn">
              まだスタッフ登録が完了していません。
              {me?.pendingRegistration?.status === 'PENDING'
                ? `「${me.pendingRegistration.nameInput}」で申請中です。店長の承認をお待ちください。`
                : '下のボタンから氏名を登録してください。'}
            </div>
            <Link href="/liff/register" className="btn primary">
              スタッフ登録へ
            </Link>
          </>
        )}
      </LiffGate>
    </>
  );
}
