'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { LiffGate, useLiff } from '../liff-client';

interface StateDto {
  businessDate: string;
  record: { clockIn: string | null; clockOut: string | null; approved: boolean } | null;
  assignment: { start: string; end: string; role: string } | null;
  canClockIn: boolean;
  canClockOut: boolean;
}

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '—');

async function getLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { timeout: 4000, maximumAge: 60_000 },
    );
  });
}

export default function TimeclockPage() {
  const { apiFetch, me } = useLiff();
  const [state, setState] = useState<StateDto | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/liff/timeclock');
    if (res.ok) setState((await res.json()) as StateDto);
  }, [apiFetch]);

  useEffect(() => {
    if (me?.registered) void load();
  }, [me?.registered, load]);

  async function punch(action: 'in' | 'out') {
    setBusy(true);
    setMessage(null);
    try {
      const location = await getLocation();
      const res = await apiFetch('/api/liff/timeclock', { method: 'POST', body: JSON.stringify({ action, location }) });
      const json = (await res.json()) as { error?: string; at?: string };
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error ?? '打刻に失敗しました' });
      } else {
        setMessage({ type: 'success', text: `${action === 'in' ? '出勤' : '退勤'}を打刻しました(${fmtTime(json.at ?? null)})${location ? '' : ' ※位置情報なし'}` });
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>打刻</h1>
      <LiffGate>
        {!state ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <>
            <div className="card">
              <div className="muted small">営業日 {state.businessDate}(朝 10 時で切り替わります)</div>
              <div style={{ marginTop: 6 }}>
                予定: {state.assignment ? `${fmtTime(state.assignment.start)} 〜 ${fmtTime(state.assignment.end)}` : <span className="muted">本日の確定シフトはありません</span>}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 16 }}>
                <span>
                  出勤 <strong>{fmtTime(state.record?.clockIn ?? null)}</strong>
                </span>
                <span>
                  退勤 <strong>{fmtTime(state.record?.clockOut ?? null)}</strong>
                </span>
              </div>
            </div>
            {message ? <div className={`alert ${message.type}`}>{message.text}</div> : null}
            <div style={{ display: 'grid', gap: 10 }}>
              <button type="button" className="big-btn in" disabled={busy || !state.canClockIn} onClick={() => punch('in')}>
                出勤
              </button>
              <button type="button" className="big-btn out" disabled={busy || !state.canClockOut} onClick={() => punch('out')}>
                退勤
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              位置情報が取れる場合は記録します(取れなくても打刻できます)。打刻を忘れた・間違えた場合は下の修正申請から。
            </p>
            <button type="button" className="btn" onClick={() => setShowCorrection((v) => !v)}>
              {showCorrection ? '修正申請を閉じる' : '打刻の修正を申請する'}
            </button>
            {showCorrection ? <CorrectionForm defaultDate={state.businessDate} onDone={() => setShowCorrection(false)} /> : null}
          </>
        )}
      </LiffGate>
    </>
  );
}

function CorrectionForm({ defaultDate, onDone }: { defaultDate: string; onDone: () => void }) {
  const { apiFetch } = useLiff();
  const [businessDate, setBusinessDate] = useState(defaultDate);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/liff/corrections', {
        method: 'POST',
        body: JSON.stringify({
          businessDate,
          clockIn: clockIn || null,
          clockOut: clockOut || null,
          breakMinutes: breakMinutes === '' ? null : Number(breakMinutes),
          reason,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error ?? '申請に失敗しました' });
        return;
      }
      setMessage({ type: 'success', text: '申請しました。店長が承認すると勤怠に反映されます。' });
      setTimeout(onDone, 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ marginTop: 10 }}>
      <label className="field">
        営業日
        <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} required />
      </label>
      <div className="grid-3">
        <label className="field">
          正しい出勤
          <input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
        </label>
        <label className="field">
          正しい退勤
          <input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
        </label>
        <label className="field">
          休憩(分)
          <input type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        翌朝の時刻(例 4:00)は 10:00 より前の時刻としてそのまま入力してください。変更しない項目は空欄で構いません。
      </p>
      <label className="field">
        理由 *
        <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="例: 退勤打刻を忘れた" />
      </label>
      {message ? <div className={`alert ${message.type}`}>{message.text}</div> : null}
      <button type="submit" className="btn primary" disabled={busy}>
        申請する
      </button>
    </form>
  );
}
