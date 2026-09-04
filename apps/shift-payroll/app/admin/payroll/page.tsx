import { toBusinessDate } from '@sakura-cross/business-date';
import Link from 'next/link';

import { db, loadSettings } from '@/lib/db';
import { bd, businessDateLabel, yen } from '@/lib/format';
import { getPayrollPeriod } from '@/lib/payroll/compute';

import { createDraftAction } from './actions';

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [runs, settings, params] = await Promise.all([
    db().payrollRun.findMany({ include: { items: true }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }] }),
    loadSettings(),
    searchParams,
  ]);
  const today = toBusinessDate(new Date());
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const suggested = getPayrollPeriod(settings.payrollClosingDay, prev.y, prev.m);

  return (
    <>
      <h1>給与計算</h1>
      {params.error ? <div className="alert error">{params.error}</div> : null}
      {params.ok ? <div className="alert success">{params.ok}</div> : null}

      <div className="card">
        <h2>期間を指定して計算(ドラフト作成)</h2>
        <form action={createDraftAction} className="inline">
          <label className="field">
            開始(営業日)
            <input name="start" type="date" defaultValue={suggested.start} required />
          </label>
          <label className="field">
            終了(営業日)
            <input name="end" type="date" defaultValue={suggested.end} required />
          </label>
          <button type="submit" className="btn primary">
            計算する
          </button>
        </form>
        <p className="muted small" style={{ marginTop: 8 }}>
          締め日設定: {settings.payrollClosingDay === 'EOM' ? '月末締め' : `${settings.payrollClosingDay} 日締め`}。承認済みの打刻のみが対象です。同じ期間の既存ドラフトは置き換えられます。
        </p>
      </div>

      <div className="card">
        <h2>計算履歴</h2>
        <table className="data">
          <thead>
            <tr>
              <th>期間</th>
              <th>状態</th>
              <th className="num">人数</th>
              <th className="num">総支給合計</th>
              <th className="num">差引支給合計</th>
              <th>作成</th>
              <th>確定</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  計算履歴はありません
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {businessDateLabel(bd(r.periodStart), true)} 〜 {businessDateLabel(bd(r.periodEnd))}
                  </td>
                  <td>{r.status === 'FINALIZED' ? <span className="badge ok">確定</span> : <span className="badge warn">ドラフト</span>}</td>
                  <td className="num">{r.items.length}</td>
                  <td className="num">{yen(r.items.reduce((s, i) => s + i.grossPay, 0))}</td>
                  <td className="num">{yen(r.items.reduce((s, i) => s + i.netPay, 0))}</td>
                  <td className="small">{r.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                  <td className="small">{r.finalizedAt ? `${r.finalizedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (${r.finalizedBy ?? ''})` : '—'}</td>
                  <td>
                    <Link href={`/admin/payroll/${r.id}`} className="btn sm primary">
                      開く
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
