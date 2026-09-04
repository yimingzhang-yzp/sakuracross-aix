'use client';

import { useEffect, useState } from 'react';

import { LiffGate, useLiff } from '../liff-client';

interface AssignmentDto {
  id: string;
  businessDate: string;
  eventName: string | null;
  roleLabel: string;
  start: string;
  end: string;
  status: string;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const fmtDate = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
};
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });

export default function SchedulePage() {
  const { apiFetch, me } = useLiff();
  const [data, setData] = useState<{ today: string; assignments: AssignmentDto[] } | null>(null);

  useEffect(() => {
    if (!me?.registered) return;
    void apiFetch('/api/liff/schedule').then(async (res) => {
      if (res.ok) setData((await res.json()) as { today: string; assignments: AssignmentDto[] });
    });
  }, [apiFetch, me?.registered]);

  return (
    <>
      <h1>確定シフト</h1>
      <LiffGate>
        {!data ? (
          <p className="muted">読み込み中…</p>
        ) : data.assignments.length === 0 ? (
          <div className="alert warn">確定シフトはまだありません。</div>
        ) : (
          <div className="stack" style={{ display: 'grid', gap: 8 }}>
            {data.assignments.map((a) => {
              const past = a.businessDate < data.today;
              return (
                <div key={a.id} className="card" style={{ marginBottom: 0, opacity: past ? 0.55 : 1, borderColor: a.businessDate === data.today ? 'var(--accent)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong style={{ fontSize: 16 }}>{fmtDate(a.businessDate)}</strong>
                    {a.status === 'ABSENT' ? <span className="badge danger">欠勤</span> : a.businessDate === data.today ? <span className="badge info">本日</span> : null}
                  </div>
                  <div>
                    {fmtTime(a.start)} 〜 {fmtTime(a.end)} ・ {a.roleLabel}
                  </div>
                  {a.eventName ? <div className="muted small">{a.eventName}</div> : null}
                </div>
              );
            })}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          シフトの変更・交代の相談は店長へ直接連絡してください。
        </p>
      </LiffGate>
    </>
  );
}
