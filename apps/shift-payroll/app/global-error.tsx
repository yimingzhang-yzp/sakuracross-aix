'use client';

/**
 * 最上位のエラー境界(レイアウト自体の描画に失敗した場合の最後の受け皿)
 * global-error では自前で html / body を出す必要がある。
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 32, background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ maxWidth: 640, margin: '10vh auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24 }}>
          <h1 style={{ marginTop: 0, fontSize: 20 }}>画面の表示に失敗しました</h1>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>
            直前の操作(保存・承認など)は完了している場合があります。まずページを再読み込みして結果を確認してください。
            デプロイ直後は、開いていた画面が古いままだと表示だけ失敗することがあります。
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', cursor: 'pointer' }}
            >
              ページを再読み込み
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
            >
              再試行
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 16 }}>
            {error.message ? <code>{error.message}</code> : null}
            {error.digest ? <code> / digest: {error.digest}</code> : null}
          </p>
        </div>
      </body>
    </html>
  );
}
