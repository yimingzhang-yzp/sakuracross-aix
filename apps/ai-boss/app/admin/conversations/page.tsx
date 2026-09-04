import Link from 'next/link';

import { formatTokyoFull, truncate } from '@/lib/format';
import { getStore } from '@/lib/store';

const PAGE_SIZE = 30;

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; days?: string }> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const days = Number(params.days ?? '0') || 0;
  const since = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
  const filter = { query: params.q || undefined, since, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const store = await getStore();
  const [conversations, total] = await Promise.all([store.listConversations(filter), store.countConversations(filter)]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = (p: number) => `/admin/conversations?q=${encodeURIComponent(params.q ?? '')}&days=${days}&page=${p}`;

  return (
    <>
      <div className="page-header">
        <h1>会話ログ</h1>
        <span className="muted small">{total} 件</span>
      </div>
      <p className="muted">誰が何を質問しているかを確認できます。スタッフには「この会話は記録され、店長が閲覧できます」と明示しています。</p>

      <div className="card">
        <form method="get" className="inline-form">
          <input className="input" type="search" name="q" placeholder="質問・回答・スタッフ名で検索" defaultValue={params.q ?? ''} style={{ minWidth: 280 }} />
          <select name="days" defaultValue={String(days)}>
            <option value="0">全期間</option>
            <option value="1">直近 24 時間</option>
            <option value="7">直近 7 日</option>
            <option value="30">直近 30 日</option>
          </select>
          <button type="submit" className="btn">
            検索
          </button>
        </form>
      </div>

      <div className="card">
        {conversations.length === 0 ? (
          <p className="muted">該当する会話はありません。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>最終更新</th>
                <th>スタッフ</th>
                <th>最初の質問</th>
                <th>件数</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatTokyoFull(c.lastMessageAt)}</td>
                  <td>{c.staffName}</td>
                  <td>
                    <Link href={`/admin/conversations/${c.id}`}>{truncate(c.firstQuestion ?? '(質問なし)', 70)}</Link>
                  </td>
                  <td>{c.messageCount}</td>
                  <td>
                    {c.hasEscalation ? <span className="badge badge-amber">要確認あり</span> : null}
                    {c.closedAt ? <span className="badge badge-gray">終了</span> : <span className="badge badge-blue">進行中</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalPages > 1 ? (
          <div className="actions" style={{ marginTop: 12 }}>
            {page > 1 ? (
              <Link className="btn btn-sm" href={query(page - 1)}>
                ← 前へ
              </Link>
            ) : null}
            <span className="small muted">
              {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link className="btn btn-sm" href={query(page + 1)}>
                次へ →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
