'use client';

import { useCallback, useEffect, useState } from 'react';

import { LiffGate, useLiff } from '../liff-client';

type Availability = 'OK' | 'NG' | 'EARLY_ONLY' | 'LATE_ONLY';
interface PeriodDto {
  id: string;
  start: string;
  end: string;
  deadline: string;
  status: string;
  editable: boolean;
  submittedCount: number;
  dates: Array<{ date: string; closed: boolean; eventName: string | null; availability: Availability | null }>;
}

const OPTIONS: Array<{ value: Availability; label: string }> = [
  { value: 'OK', label: '○' },
  { value: 'NG', label: '×' },
  { value: 'EARLY_ONLY', label: '早' },
  { value: 'LATE_ONLY', label: '遅' },
];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function label(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}

export default function PreferencePage() {
  const { apiFetch, me } = useLiff();
  const [periods, setPeriods] = useState<PeriodDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Availability>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/liff/preferences');
    if (!res.ok) return;
    const json = (await res.json()) as { periods: PeriodDto[] };
    setPeriods(json.periods);
    const first = json.periods.find((p) => p.editable) ?? json.periods[0];
    if (first) {
      setSelected((cur) => cur ?? first.id);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (me?.registered) void load();
  }, [me?.registered, load]);

  const period = periods?.find((p) => p.id === selected) ?? null;
  useEffect(() => {
    if (!period) return;
    const initial: Record<string, Availability> = {};
    for (const d of period.dates) if (d.availability) initial[d.date] = d.availability;
    setDraft(initial);
  }, [period?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!period) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/liff/preferences', { method: 'PUT', body: JSON.stringify({ periodId: period.id, preferences: draft }) });
      const json = (await res.json()) as { error?: string; saved?: number; late?: boolean };
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error ?? '保存に失敗しました' });
        return;
      }
      setMessage(json.late ? { type: 'warn', text: `${json.saved} 日分を保存しました(締切を過ぎているため反映は店長の判断になります)` } : { type: 'success', text: `${json.saved} 日分を保存しました` });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function setAll(value: Availability) {
    if (!period) return;
    const next = { ...draft };
    for (const d of period.dates) if (!d.closed) next[d.date] = value;
    setDraft(next);
  }

  return (
    <>
      <h1>希望シフト提出</h1>
      <LiffGate>
        {!periods ? (
          <p className="muted">読み込み中…</p>
        ) : periods.length === 0 ? (
          <div className="alert warn">現在、希望を受け付けている期間はありません。</div>
        ) : (
          <>
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.start)}〜{label(p.end)} {p.status === 'CONFIRMED' ? '(確定済み)' : `締切 ${new Date(p.deadline).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                </option>
              ))}
            </select>
            {period ? (
              <>
                {!period.editable ? <div className="alert warn">この期間は確定済みのため変更できません。変更が必要な場合は店長に連絡してください。</div> : null}
                <div className="toolbar" style={{ fontSize: 12 }}>
                  <span className="muted">一括:</span>
                  {OPTIONS.map((o) => (
                    <button key={o.value} type="button" className="btn sm" onClick={() => setAll(o.value)} disabled={!period.editable}>
                      全部{o.label}
                    </button>
                  ))}
                </div>
                <div className="pref-grid">
                  <div className="muted small">日付</div>
                  {OPTIONS.map((o) => (
                    <div key={o.value} className="muted small" style={{ textAlign: 'center' }}>
                      {o.label}
                    </div>
                  ))}
                  {period.dates.map((d) => (
                    <DateRow key={d.date} date={d} value={draft[d.date] ?? null} disabled={!period.editable} onChange={(v) => setDraft((cur) => ({ ...cur, [d.date]: v }))} />
                  ))}
                </div>
                <p className="muted small">○ = 入れる / × = 入れない / 早 = 早番(〜翌1時)のみ / 遅 = 遅番(0時〜)のみ</p>
                {message ? <div className={`alert ${message.type}`}>{message.text}</div> : null}
                <button type="button" className="big-btn in" onClick={save} disabled={busy || !period.editable}>
                  {busy ? '保存中…' : '希望を送信する'}
                </button>
              </>
            ) : null}
          </>
        )}
      </LiffGate>
    </>
  );
}

function DateRow({
  date,
  value,
  disabled,
  onChange,
}: {
  date: PeriodDto['dates'][number];
  value: Availability | null;
  disabled: boolean;
  onChange: (v: Availability) => void;
}) {
  if (date.closed) {
    return (
      <>
        <div className="muted">
          {label(date.date)} <span className="small">休業</span>
        </div>
        <div style={{ gridColumn: 'span 4' }} className="muted small">
          —
        </div>
      </>
    );
  }
  return (
    <>
      <div>
        {label(date.date)}
        {date.eventName ? <div className="muted small">{date.eventName}</div> : null}
      </div>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" className={`opt ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </>
  );
}
