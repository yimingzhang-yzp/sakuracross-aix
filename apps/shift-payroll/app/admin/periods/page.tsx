import { addBusinessDays, toBusinessDate } from '@sakura-cross/business-date';
import Link from 'next/link';

import { db } from '@/lib/db';
import { bd, businessDateLabel } from '@/lib/format';

import { PeriodStatus } from '../period-status';
import { createPeriodAction } from './actions';

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [periods, params] = await Promise.all([
    db().shiftPeriod.findMany({ orderBy: { periodStart: 'desc' } }),
    searchParams,
  ]);

  // 次の半月を既定値として提案
  const today = toBusinessDate(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let suggestStart: string;
  let suggestEnd: string;
  if (d <= 15) {
    suggestStart = `${y}-${pad(m)}-16`;
    suggestEnd = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
  } else {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    suggestStart = `${ny}-${pad(nm)}-01`;
    suggestEnd = `${ny}-${pad(nm)}-15`;
  }
  const suggestDeadline = addBusinessDays(suggestStart, -5);

  return (
    <>
      <h1>シフト期間</h1>
      {params.error ? <div className="alert error">{params.error}</div> : null}
      {params.ok ? <div className="alert success">{params.ok}</div> : null}

      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>期間</th>
              <th>希望締切</th>
              <th>状態</th>
              <th>生成</th>
              <th>確定</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  期間がありません
                </td>
              </tr>
            ) : (
              periods.map((p) => (
                <tr key={p.id}>
                  <td>
                    {businessDateLabel(bd(p.periodStart), true)} 〜 {businessDateLabel(bd(p.periodEnd))}
                  </td>
                  <td>{p.preferenceDeadline.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                  <td>
                    <PeriodStatus status={p.status} />
                  </td>
                  <td className="small">{p.generatedAt ? p.generatedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'}</td>
                  <td className="small">{p.confirmedAt ? `${p.confirmedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (${p.confirmedBy ?? ''})` : '—'}</td>
                  <td>
                    <Link href={`/admin/periods/${p.id}`} className="btn sm primary">
                      開く
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>期間を作成</h2>
        <form action={createPeriodAction} className="inline">
          <label className="field">
            開始日
            <input name="periodStart" type="date" defaultValue={suggestStart} required />
          </label>
          <label className="field">
            終了日
            <input name="periodEnd" type="date" defaultValue={suggestEnd} required />
          </label>
          <label className="field">
            希望提出締切
            <input name="deadlineDate" type="date" defaultValue={suggestDeadline} required />
          </label>
          <label className="field">
            締切時刻
            <input name="deadlineTime" type="time" defaultValue="23:59" required />
          </label>
          <button type="submit" className="btn primary">
            作成
          </button>
        </form>
        <p className="muted small" style={{ marginTop: 8 }}>
          作成すると希望提出の受付が始まります。締切の N 日前(設定)に未提出者へリマインドが自動送信されます。
        </p>
      </div>
    </>
  );
}
