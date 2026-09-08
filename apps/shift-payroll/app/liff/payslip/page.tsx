'use client';

import { useEffect, useState } from 'react';

import { LiffGate, useLiff } from '../liff-client';

interface PayslipDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  finalizedAt: string | null;
  totalMinutes: number;
  nightMinutes: number;
  basePay: number;
  nightPremiumPay: number;
  incentivePay: number;
  grossPay: number;
  healthInsurance: number;
  careInsurance: number;
  pensionInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  totalDeductions: number;
  standardMonthlyRemuneration: number | null;
  taxableIncome: number;
  advanceDeduction: number;
  netPay: number;
  monthlySalary: number | null;
  breakdown: { days?: Array<{ businessDate: string; totalMinutes: number; nightMinutes: number; breakMinutes: number; autoBreakApplied: boolean; basePay: number; nightPremiumPay: number }> } | null;
}

const yen = (v: number) => `¥${v.toLocaleString('ja-JP')}`;
const hours = (m: number) => `${Math.floor(m / 60)}時間${m % 60}分`;
const fmt = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 期間の見出し。月末締めなら「2026年8月分」、それ以外は「8/16〜9/15」 */
function periodTitle(p: PayslipDto): string {
  const y = Number(p.periodStart.slice(0, 4));
  const m = Number(p.periodStart.slice(5, 7));
  const wholeMonth = p.periodStart.endsWith('-01') && p.periodEnd.slice(0, 7) === p.periodStart.slice(0, 7);
  return wholeMonth ? `${y}年${m}月分` : `${fmt(p.periodStart)}〜${fmt(p.periodEnd)}`;
}

export default function PayslipPage() {
  const { apiFetch, me } = useLiff();
  const [items, setItems] = useState<PayslipDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showDays, setShowDays] = useState(false);

  useEffect(() => {
    if (!me?.registered) return;
    void apiFetch('/api/liff/payslips').then(async (res) => {
      if (res.ok) {
        const list = ((await res.json()) as { payslips: PayslipDto[] }).payslips;
        setItems(list);
        // 最新の明細を初期表示
        setSelected(list[0]?.id ?? null);
      }
    });
  }, [apiFetch, me?.registered]);

  const current = items?.find((p) => p.id === selected) ?? null;

  return (
    <>
      <h1>給与明細</h1>
      <LiffGate>
        {!items ? (
          <p className="muted">読み込み中…</p>
        ) : items.length === 0 ? (
          <div className="alert warn">確定済みの明細はまだありません。</div>
        ) : (
          <>
            {/* 過去分を含む一覧。行をタップすると下に明細を表示 */}
            <div className="card">
              <table className="data" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>期間</th>
                    <th className="num">総支給</th>
                    <th className="num">控除</th>
                    <th className="num">差引支給</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => {
                        setSelected(p.id);
                        setShowDays(false);
                      }}
                      style={{ cursor: 'pointer', background: p.id === selected ? 'var(--accent-bg, #eef2ff)' : undefined }}
                      aria-selected={p.id === selected}
                    >
                      <td>{periodTitle(p)}</td>
                      <td className="num">{yen(p.grossPay)}</td>
                      <td className="num">-{yen(p.totalDeductions + p.advanceDeduction)}</td>
                      <td className="num">
                        <strong>{yen(p.netPay)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ marginTop: 6 }}>
                {items.length} か月分。行をタップすると明細を表示します。
              </p>
            </div>

            {current ? (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong>{periodTitle(current)}</strong>
                  <span style={{ fontSize: 18 }}>
                    差引 <strong>{yen(current.netPay)}</strong>
                  </span>
                </div>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  対象期間 {fmt(current.periodStart)}〜{fmt(current.periodEnd)}
                  {current.finalizedAt ? ` / 確定 ${new Date(current.finalizedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : ''}
                </p>

                <h3 style={{ margin: '12px 0 4px', fontSize: 14 }}>支給</h3>
                <table className="data">
                  <tbody>
                    <Row label="労働時間" value={`${hours(current.totalMinutes)}(深夜 ${hours(current.nightMinutes)})`} />
                    <Row label={current.monthlySalary ? '基本給(月給)' : '基本給'} value={yen(current.basePay)} />
                    <Row label="深夜割増" value={yen(current.nightPremiumPay)} />
                    <Row label="インセンティブ" value={yen(current.incentivePay)} />
                    <Row label="総支給" value={yen(current.grossPay)} strong />
                  </tbody>
                </table>

                <h3 style={{ margin: '12px 0 4px', fontSize: 14 }}>控除</h3>
                <table className="data">
                  <tbody>
                    <Row label="健康保険料" value={current.healthInsurance ? `-${yen(current.healthInsurance)}` : '—'} />
                    {current.careInsurance > 0 ? <Row label="介護保険料" value={`-${yen(current.careInsurance)}`} /> : null}
                    <Row label="厚生年金保険料" value={current.pensionInsurance ? `-${yen(current.pensionInsurance)}` : '—'} />
                    <Row label="雇用保険料" value={current.employmentInsurance ? `-${yen(current.employmentInsurance)}` : '—'} />
                    <Row label="所得税" value={current.incomeTax ? `-${yen(current.incomeTax)}` : '—'} />
                    <Row label="控除合計" value={`-${yen(current.totalDeductions)}`} strong />
                    {current.advanceDeduction > 0 ? <Row label="日払い(受取済み)" value={`-${yen(current.advanceDeduction)}`} /> : null}
                    <Row label="差引支給" value={yen(current.netPay)} strong />
                  </tbody>
                </table>
                {current.standardMonthlyRemuneration ? (
                  <p className="muted small" style={{ marginTop: 6 }}>
                    標準報酬月額 {yen(current.standardMonthlyRemuneration)} / 課税対象額 {yen(current.taxableIncome)}
                  </p>
                ) : null}

                <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setShowDays(!showDays)}>
                  {showDays ? '日別内訳を閉じる' : '日別内訳を見る'}
                </button>
                {showDays && current.breakdown?.days ? (
                  <table className="data" style={{ marginTop: 8, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>日</th>
                        <th className="num">労働</th>
                        <th className="num">深夜</th>
                        <th className="num">休憩</th>
                        <th className="num">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.breakdown.days.map((d) => (
                        <tr key={d.businessDate}>
                          <td>{fmt(d.businessDate)}</td>
                          <td className="num">{hours(d.totalMinutes)}</td>
                          <td className="num">{hours(d.nightMinutes)}</td>
                          <td className="num">
                            {d.breakMinutes}分{d.autoBreakApplied ? '(自動)' : ''}
                          </td>
                          <td className="num">{yen(d.basePay + d.nightPremiumPay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                <p className="muted small" style={{ marginTop: 8 }}>
                  住民税は含まれていません。内容に疑問がある場合は店長に確認してください。
                </p>
              </div>
            ) : null}
          </>
        )}
      </LiffGate>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <th style={{ width: '45%' }}>{label}</th>
      <td className="num">{strong ? <strong>{value}</strong> : value}</td>
    </tr>
  );
}
