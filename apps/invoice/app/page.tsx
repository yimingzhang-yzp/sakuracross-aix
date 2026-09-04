import { HealthPanel } from './health-panel';

const APPS = [
  { key: 'shift-payroll', title: 'シフト・給与', port: 3001, summary: 'シフト調整・勤怠・給与計算(指示書 01)' },
  { key: 'ai-boss', title: 'AI上司', port: 3002, summary: '新人教育・現場 Q&A ボット(指示書 02)' },
  { key: 'invoice', title: '請求書管理', port: 3003, summary: '請求書 AI 読取・支払指示(指示書 03)' },
] as const;

const CURRENT = 'invoice';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto' }}>
      <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.08em', color: '#64748b' }}>CROSS ROPPONGI</p>
      <h1 style={{ marginTop: 4, marginBottom: 8 }}>請求書管理</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        モノレポ基盤(フェーズ0)の土台アプリです。個別機能は指示書のフェーズ1で実装します。
      </p>

      <section style={cardStyle}>
        <h2 style={h2Style}>ヘルスチェック</h2>
        <HealthPanel />
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>3 システム</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {APPS.map((app) => {
            const isCurrent = app.key === CURRENT;
            return (
              <li
                key={app.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: isCurrent ? '#e0f2fe' : '#f1f5f9',
                }}
              >
                <div>
                  <strong>{app.title}</strong>
                  {isCurrent ? <span style={badgeStyle}>このアプリ</span> : null}
                  <div style={{ fontSize: 13, color: '#475569' }}>{app.summary}</div>
                </div>
                {isCurrent ? (
                  <code style={{ fontSize: 12 }}>:{app.port}</code>
                ) : (
                  <a href={`http://localhost:${app.port}/`} style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    localhost:{app.port} →
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>共通パッケージ</h2>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.7 }}>
          <li>
            <code>@sakura-cross/shared-db</code> — 統合 Prisma スキーマ・Supabase クライアント
          </li>
          <li>
            <code>@sakura-cross/line-router</code> — LINE 署名検証・冪等性・<code>shift:</code>/<code>ai:</code> 振分け
          </li>
          <li>
            <code>@sakura-cross/business-date</code> — 営業日(20:00〜翌10:00、Asia/Tokyo 固定)
          </li>
        </ul>
      </section>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: '16px 20px',
  marginTop: 16,
};

const h2Style: React.CSSProperties = { fontSize: 16, margin: '0 0 12px' };

const badgeStyle: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 999,
  background: '#0284c7',
  color: '#fff',
  verticalAlign: 'middle',
};
