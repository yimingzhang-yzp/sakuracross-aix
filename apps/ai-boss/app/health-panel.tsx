'use client';

import { useCallback, useEffect, useState } from 'react';

interface HealthResponse {
  status: 'ok' | 'degraded';
  app: string;
  timestamp: string;
  businessDate: string;
  timezone: string;
  db: { status: 'ok' | 'skipped' | 'error'; latencyMs?: number; error?: string };
  uptimeSeconds: number;
}

const DB_LABEL: Record<HealthResponse['db']['status'], string> = {
  ok: '接続 OK',
  skipped: '未設定(DATABASE_URL なし。ローカルでは正常)',
  error: '接続エラー',
};

export function HealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      setHttpStatus(res.status);
      setHealth((await res.json()) as HealthResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const healthy = httpStatus === 200;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: health ? (healthy ? '#16a34a' : '#dc2626') : '#94a3b8',
          }}
        />
        <strong>
          {health ? (healthy ? '正常' : '要確認') : loading ? '確認中…' : '未取得'}
          {httpStatus ? <span style={{ color: '#64748b', fontWeight: 400 }}> (HTTP {httpStatus})</span> : null}
        </strong>
        <button type="button" onClick={() => void load()} disabled={loading} style={buttonStyle}>
          再取得
        </button>
        <a href="/api/health" target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
          JSON を開く
        </a>
      </div>

      {error ? <p style={{ color: '#dc2626' }}>取得に失敗しました: {error}</p> : null}

      {health ? (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
          <tbody>
            <Row label="アプリ" value={health.app} />
            <Row label="現在時刻(UTC)" value={health.timestamp} />
            <Row
              label="営業日"
              value={`${health.businessDate}(${health.timezone}、10:00 で日付が切り替わります)`}
            />
            <Row
              label="DB"
              value={
                DB_LABEL[health.db.status] +
                (health.db.latencyMs !== undefined ? ` / ${health.db.latencyMs}ms` : '') +
                (health.db.error ? ` / ${health.db.error}` : '')
              }
            />
            <Row label="稼働時間" value={`${health.uptimeSeconds} 秒`} />
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th
        scope="row"
        style={{
          textAlign: 'left',
          padding: '6px 12px 6px 0',
          color: '#64748b',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          verticalAlign: 'top',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        {label}
      </th>
      <td style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', wordBreak: 'break-all' }}>{value}</td>
    </tr>
  );
}

const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#fff',
  cursor: 'pointer',
};
