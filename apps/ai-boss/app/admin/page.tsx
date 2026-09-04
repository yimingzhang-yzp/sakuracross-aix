import Link from 'next/link';

import { formatTokyo } from '@/lib/format';
import { getStore } from '@/lib/store';

export default async function DashboardPage() {
  const store = await getStore();
  const now = new Date();
  const [stats, openTickets, recent] = await Promise.all([
    store.getDashboardStats(now),
    store.listEscalations({ status: 'OPEN', limit: 5 }),
    store.listConversations({ limit: 8 }),
  ]);

  return (
    <>
      <div className="page-header">
        <h1>ダッシュボード</h1>
        <span className="muted small">{formatTokyo(now)} 時点</span>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">未回答キュー(OPEN)</div>
          <div className={`value${stats.openTickets > 0 ? ' warn' : ''}`}>{stats.openTickets}</div>
        </div>
        <div className="stat">
          <div className="label">直近 24 時間の質問</div>
          <div className="value">{stats.questionsLast24h}</div>
          <div className="small muted">{stats.conversationsLast24h} 会話</div>
        </div>
        <div className="stat">
          <div className="label">有効ナレッジ</div>
          <div className="value">{stats.activeDocs}</div>
          <div className="small muted">ドラフト {stats.draftDocs} 件</div>
        </div>
        <div className="stat">
          <div className="label">直近 7 日のエスカレーション</div>
          <div className="value">{stats.escalationsLast7d}</div>
          <div className="small muted">仮登録スタッフ {stats.provisionalStaff} 名</div>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="page-header">
            <h2>未回答の質問</h2>
            <Link href="/admin/escalations">すべて見る →</Link>
          </div>
          {openTickets.length === 0 ? (
            <p className="muted">未回答の質問はありません。</p>
          ) : (
            <table className="table">
              <tbody>
                {openTickets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="prewrap">{t.question}</div>
                      <div className="small muted">
                        {t.staffName} · {formatTokyo(t.createdAt)}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link className="btn btn-sm" href={`/admin/escalations#${t.id}`}>
                        回答する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="page-header">
            <h2>最近の会話</h2>
            <Link href="/admin/conversations">すべて見る →</Link>
          </div>
          {recent.length === 0 ? (
            <p className="muted">まだ会話がありません。LINE から質問すると表示されます。</p>
          ) : (
            <table className="table">
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/conversations/${c.id}`}>
                        <div className="truncate">{c.firstQuestion ?? '(質問なし)'}</div>
                      </Link>
                      <div className="small muted">
                        {c.staffName} · {c.messageCount} 件 · {formatTokyo(c.lastMessageAt)}
                        {c.hasEscalation ? (
                          <>
                            {' '}
                            <span className="badge badge-amber">要確認</span>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>運用の流れ</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>ナレッジ管理</strong>で雛形の【店舗確認】を実際の値に置き換える(または<strong>マニュアル取込</strong>で既存 PDF / Word を変換)
          </li>
          <li>スタッフが LINE「CROSS スタッフ」で質問 → AI がナレッジに基づいて回答</li>
          <li>
            答えられなかった質問は<strong>未回答キュー</strong>に入る → 店長が回答 → 質問者に LINE で届く → ワンクリックでナレッジに追記
          </li>
          <li>
            <strong>会話ログ</strong>で「誰が何を聞いているか」を確認し、マニュアルを改善する
          </li>
        </ol>
      </section>
    </>
  );
}
