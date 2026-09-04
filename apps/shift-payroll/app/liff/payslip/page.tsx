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
  advanceDeduction: number;
  netPay: number;
  monthlySalary: number | null;
  breakdown: { days?: Array<{ businessDate: string; totalMinutes: number; nightMinutes: number; breakMinutes: number; autoBreakApplied: boolean; basePay: number; nightPremiumPay: number }> } | null;
}

const yen = (v: number) => `¥${v.toLocaleString('ja-JP')}`;
const hours = (m: number) => `${Math.floor(m / 60)}時間${m % 60}分`;
const fmt = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function PayslipPage() {
  const { apiFetch, me } = useLiff();
  const [items, setItems] = useState<PayslipDto[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.registered) return;
    void apiFetch('/api/liff/payslips').then(async (res) => {
      if (res.ok) setItems(((await res.json()) as { payslips: PayslipDto[] }).payslips);
    });
  }, [apiFetch, me?.registered]);

  return (
    <>
      <h1>給与明細</h1>
      <LiffGate>
        {!items ? (
          <p className="muted">読み込み中…</p>
        ) : items.length === 0 ? (
          <div className="alert warn">確定済みの明細はまだありません。</div>
        ) : (
          items.map((p) => (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>
                  {fmt(p.periodStart)}〜{fmt(p.periodEnd)}
                </strong>
                <span style={{ fontSize: 18 }}>
                  差引 <strong>{yen(p.netPay)}</strong>
                </span>
              </div>
              <table className="data" style={{ marginTop: 8 }}>
                <tbody>
                  <Row label="労働時間" value={`${hours(p.totalMinutes)}(深夜 ${hours(p.nightMinutes)})`} />
                  <Row label={p.monthlySalary ? '基本給(月給)' : '基本給'} value={yen(p.basePay)} />
                  <Row label="深夜割増(25%)" value={yen(p.nightPremiumPay)} />
                  <Row label="インセンティブ" value={yen(p.incentivePay)} />
                  <Row label="総支給" value={yen(p.grossPay)} strong />
                  <Row label="日払い控除" value={`-${yen(p.advanceDeduction)}`} />
                  <Row label="差引支給" value={yen(p.netPay)} strong />
                </tbody>
              </table>
              <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? '日別内訳を閉じる' : '日別内訳を見る'}
              </button>
              {open === p.id && p.breakdown?.days ? (
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
                    {p.breakdown.days.map((d) => (
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
                所得税・社会保険・雇用保険は含まれていません。{p.finalizedAt ? `確定: ${new Date(p.finalizedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : ''}
              </p>
            </div>
          ))
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
