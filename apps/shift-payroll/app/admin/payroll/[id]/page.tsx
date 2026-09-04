import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { bd, businessDateLabel, EMPLOYMENT_LABELS, hhmm, minutesToHours, yen } from '@/lib/format';
import type { AdvancePaymentInput, DailyBreakdown, IncentiveInput } from '@/lib/payroll/types';

import { finalizeAction, recalcAction } from '../actions';

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const run = await db().payrollRun.findUnique({ where: { id }, include: { items: { include: { staff: true }, orderBy: { staff: { name: 'asc' } } } } });
  if (!run) notFound();
  const start = bd(run.periodStart);
  const end = bd(run.periodEnd);
  const totals = run.items.reduce(
    (acc, i) => ({ gross: acc.gross + i.grossPay, net: acc.net + i.netPay, minutes: acc.minutes + i.totalMinutes, night: acc.night + i.nightMinutes }),
    { gross: 0, net: 0, minutes: 0, night: 0 },
  );

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          給与 {businessDateLabel(start, true)} 〜 {businessDateLabel(end)}
        </h1>
        {run.status === 'FINALIZED' ? <span className="badge ok">確定</span> : <span className="badge warn">ドラフト</span>}
        <Link href="/admin/payroll" className="btn sm">
          ← 一覧
        </Link>
        <span className="spacer" />
        <a href={`/admin/payroll/${id}/csv`} className="btn">
          CSV ダウンロード
        </a>
        {run.status === 'DRAFT' ? (
          <>
            <form action={recalcAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="btn">
                再計算(最新の勤怠で作り直す)
              </button>
            </form>
            <form action={finalizeAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="btn primary">
                確定して明細を LINE 配信
              </button>
            </form>
          </>
        ) : (
          <form action={recalcAction}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="btn">
              再計算(新しいドラフトを作成)
            </button>
          </form>
        )}
      </div>
      {query.error ? <div className="alert error">{query.error}</div> : null}
      {query.ok ? <div className="alert success">{query.ok}</div> : null}
      {run.warnings.length > 0 ? (
        <div className="alert warn">
          {run.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ) : null}
      {run.status === 'FINALIZED' ? (
        <div className="alert success">
          この期間の勤怠・日払い・インセンティブは編集できません。修正が必要な場合は「再計算」で新しいドラフトを作成してください(この確定分は履歴として残ります)。
          {run.payslipsSentAt ? ` 明細配信: ${run.payslipsSentAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : ''}
        </div>
      ) : null}

      <div className="card-row" style={{ marginBottom: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">対象人数</div>
          <div className="stat">{run.items.length}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">総労働時間 / 深夜</div>
          <div className="stat" style={{ fontSize: 20 }}>
            {minutesToHours(totals.minutes)} / {minutesToHours(totals.night)}
          </div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">総支給合計</div>
          <div className="stat">{yen(totals.gross)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">差引支給合計</div>
          <div className="stat">{yen(totals.net)}</div>
        </div>
      </div>

      <div className="card">
        <h2>明細</h2>
        <table className="data">
          <thead>
            <tr>
              <th>スタッフ</th>
              <th>雇用</th>
              <th className="num">労働時間</th>
              <th className="num">深夜</th>
              <th className="num">基本給</th>
              <th className="num">深夜割増</th>
              <th className="num">インセンティブ</th>
              <th className="num">総支給</th>
              <th className="num">日払い控除</th>
              <th className="num">差引支給</th>
              <th>注記</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((i) => (
              <tr key={i.id}>
                <td>{i.staff.name}</td>
                <td>{EMPLOYMENT_LABELS[i.staff.employmentType]}</td>
                <td className="num">{minutesToHours(i.totalMinutes)}</td>
                <td className="num">{minutesToHours(i.nightMinutes)}</td>
                <td className="num">{i.monthlySalary ? `${yen(i.basePay)}(月給)` : yen(i.basePay)}</td>
                <td className="num">{yen(i.nightPremiumPay)}</td>
                <td className="num">{yen(i.incentivePay)}</td>
                <td className="num">
                  <strong>{yen(i.grossPay)}</strong>
                </td>
                <td className="num">{i.advanceDeduction ? `-${yen(i.advanceDeduction)}` : '—'}</td>
                <td className="num">
                  <strong>{yen(i.netPay)}</strong>
                </td>
                <td className="small" style={{ color: 'var(--danger)' }}>
                  {i.warnings.join(' / ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 8 }}>
          所得税・社会保険・雇用保険の控除は含みません。CSV を給与ソフト/社労士へ渡してください。
        </p>
      </div>

      {run.items.map((i) => {
        const breakdown = (i.breakdown as unknown as { days: DailyBreakdown[]; incentives: IncentiveInput[]; advances: AdvancePaymentInput[] }) ?? { days: [], incentives: [], advances: [] };
        return (
          <details key={i.id} className="card">
            <summary style={{ cursor: 'pointer' }}>
              <strong>{i.staff.name}</strong> の日別内訳({breakdown.days.length} 日)
            </summary>
            <table className="data" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>営業日</th>
                  <th>出勤</th>
                  <th>退勤</th>
                  <th className="num">在店</th>
                  <th className="num">休憩</th>
                  <th className="num">労働</th>
                  <th className="num">深夜</th>
                  <th className="num">時給</th>
                  <th className="num">基本給</th>
                  <th className="num">深夜割増</th>
                  <th>注記</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.days.map((d) => (
                  <tr key={d.businessDate}>
                    <td>{businessDateLabel(d.businessDate)}</td>
                    <td>
                      {hhmm(d.clockIn)}
                      {d.roundedClockIn && d.roundedClockIn !== d.clockIn ? <span className="muted small"> → {hhmm(d.roundedClockIn)}</span> : null}
                    </td>
                    <td>
                      {hhmm(d.clockOut)}
                      {d.roundedClockOut && d.roundedClockOut !== d.clockOut ? <span className="muted small"> → {hhmm(d.roundedClockOut)}</span> : null}
                    </td>
                    <td className="num">{minutesToHours(d.rawMinutes)}</td>
                    <td className="num">
                      {d.breakMinutes}
                      {d.autoBreakApplied ? <span className="badge warn" style={{ marginLeft: 4 }}>自動控除</span> : null}
                    </td>
                    <td className="num">{minutesToHours(d.totalMinutes)}</td>
                    <td className="num">{minutesToHours(d.nightMinutes)}</td>
                    <td className="num">{d.wageSource === 'monthly' ? '月給' : yen(d.hourlyWage)}</td>
                    <td className="num">{yen(d.basePay)}</td>
                    <td className="num">{yen(d.nightPremiumPay)}</td>
                    <td className="small" style={{ color: 'var(--danger)' }}>
                      {d.warnings.join(' / ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {breakdown.incentives.length > 0 || breakdown.advances.length > 0 ? (
              <p className="small" style={{ marginTop: 8 }}>
                {breakdown.incentives.map((x, idx) => (
                  <span key={`i${idx}`} className="badge info" style={{ marginRight: 6 }}>
                    {businessDateLabel(x.businessDate)} {x.kind} +{yen(x.amount)}
                  </span>
                ))}
                {breakdown.advances.map((x, idx) => (
                  <span key={`a${idx}`} className="badge danger" style={{ marginRight: 6 }}>
                    {businessDateLabel(x.businessDate)} 日払い -{yen(x.amount)}
                  </span>
                ))}
              </p>
            ) : null}
          </details>
        );
      })}
    </>
  );
}
