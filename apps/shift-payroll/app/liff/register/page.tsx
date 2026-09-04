'use client';

import { type FormEvent, useState } from 'react';

import { LiffGate, useLiff } from '../liff-client';

export default function RegisterPage() {
  const { apiFetch, me, refreshMe, displayName } = useLiff();
  const [name, setName] = useState('');
  const [nameKana, setNameKana] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/liff/register', { method: 'POST', body: JSON.stringify({ name, nameKana }) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error ?? '登録に失敗しました' });
        return;
      }
      setMessage({ type: 'success', text: '申請を送信しました。店長が承認すると各機能が使えるようになります。' });
      await refreshMe();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>スタッフ登録</h1>
      <LiffGate allowUnregistered>
        {me?.registered ? (
          <div className="alert success">
            {me.staff?.name} さんとして登録済みです。リッチメニューから各機能をご利用ください。
          </div>
        ) : (
          <>
            {me?.pendingRegistration?.status === 'PENDING' ? (
              <div className="alert warn">「{me.pendingRegistration.nameInput}」で申請中です。店長の承認をお待ちください(内容を修正して再送信もできます)。</div>
            ) : null}
            {me?.pendingRegistration?.status === 'REJECTED' ? <div className="alert error">前回の申請は承認されませんでした。店長に確認のうえ再送信してください。</div> : null}
            <form onSubmit={onSubmit} className="stack card">
              <p className="muted small" style={{ margin: 0 }}>
                LINE 表示名: {displayName ?? '—'}。給与明細に使う正式な氏名を入力してください。
              </p>
              <label className="field">
                氏名 *
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例: 山田 花子" />
              </label>
              <label className="field">
                フリガナ
                <input value={nameKana} onChange={(e) => setNameKana(e.target.value)} placeholder="例: ヤマダ ハナコ" />
              </label>
              {message ? <div className={`alert ${message.type}`}>{message.text}</div> : null}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? '送信中…' : '登録を申請する'}
              </button>
            </form>
          </>
        )}
      </LiffGate>
    </>
  );
}
