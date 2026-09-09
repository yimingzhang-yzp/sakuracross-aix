'use client';

/**
 * 管理画面のエラー境界
 *
 * 画面が真っ白になって原因が分からない状態を避けるため、何が起きたかと復帰手段を出す。
 * デプロイ直後は「開いていた画面の JS が古い」ために描画だけ失敗することがあり、
 * この場合は再読み込み(古い JS を捨てて取り直す)で復帰する。
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>画面の表示に失敗しました</h1>
      <div className="alert warn">
        操作そのものは完了している場合があります(保存・承認など)。まず<strong>ページを再読み込み</strong>して結果を確認してください。
        デプロイの直後は、開いていた画面が古いままだと表示だけ失敗することがあります。
      </div>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          ページを再読み込み
        </button>
        <button type="button" className="btn" onClick={() => reset()}>
          この画面だけ再試行
        </button>
        <a href="/admin" className="btn">
          ダッシュボードへ
        </a>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        再読み込みしても直らない場合は、この内容を開発者に伝えてください。
        <br />
        {error.message ? <code>{error.message}</code> : null}
        {error.digest ? (
          <>
            <br />
            <code>digest: {error.digest}</code>
          </>
        ) : null}
      </p>
    </div>
  );
}
