import Link from 'next/link';

import { formatTokyo, truncate } from '@/lib/format';
import { KNOWLEDGE_CATEGORIES } from '@/lib/knowledge/categories';
import { getStore } from '@/lib/store';

const SOURCE_LABEL: Record<string, string> = {
  manual: '手入力',
  import: '取込',
  seed: '雛形',
  escalation: 'Q&A追記',
};

export default async function KnowledgeListPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; drafts?: string; deleted?: string }>;
}) {
  const params = await searchParams;
  const store = await getStore();
  const docs = await store.listDocs({ category: params.category || undefined, query: params.q || undefined, includeInactive: true });
  const filtered = params.drafts === '1' ? docs.filter((d) => !d.isActive) : docs;
  const draftCount = docs.filter((d) => !d.isActive).length;

  return (
    <>
      <div className="page-header">
        <h1>ナレッジ管理</h1>
        <div className="actions">
          <Link className="btn" href="/admin/knowledge/import">
            PDF / Word から取込
          </Link>
          <Link className="btn btn-primary" href="/admin/knowledge/new">
            新規ドキュメント
          </Link>
        </div>
      </div>

      {params.deleted ? <div className="notice notice-success">ドキュメントを削除しました。</div> : null}
      {draftCount > 0 && params.drafts !== '1' ? (
        <div className="notice notice-warn">
          確認待ちのドラフトが {draftCount} 件あります。ドラフトは検索対象になりません。{' '}
          <Link href="/admin/knowledge?drafts=1">ドラフトだけ表示</Link>
        </div>
      ) : null}

      <div className="card">
        <form method="get" className="inline-form">
          <select name="category" defaultValue={params.category ?? ''}>
            <option value="">すべてのカテゴリ</option>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <input className="input" type="search" name="q" placeholder="タイトル・本文を検索" defaultValue={params.q ?? ''} />
          <label className="small">
            <input type="checkbox" name="drafts" value="1" defaultChecked={params.drafts === '1'} /> ドラフトのみ
          </label>
          <button type="submit" className="btn">
            絞り込む
          </button>
          {params.category || params.q || params.drafts ? (
            <Link href="/admin/knowledge" className="small">
              解除
            </Link>
          ) : null}
        </form>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <p className="muted">該当するドキュメントがありません。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th>タイトル</th>
                <th>状態</th>
                <th>版</th>
                <th>由来</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.category}</td>
                  <td>
                    <Link href={`/admin/knowledge/${d.id}`}>{d.title}</Link>
                    <div className="small muted truncate">{truncate(d.content.replace(/^#.*$/m, ''), 90)}</div>
                  </td>
                  <td>
                    {d.isActive ? <span className="badge badge-green">有効</span> : <span className="badge badge-amber">ドラフト</span>}
                    {d.content.includes('【店舗確認】') ? (
                      <>
                        {' '}
                        <span className="badge badge-gray" title="店舗固有の値に置き換えが必要な箇所があります">
                          店舗確認あり
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>v{d.version}</td>
                  <td>{SOURCE_LABEL[d.source] ?? d.source}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatTokyo(d.updatedAt)}
                    <div className="small muted">{d.updatedBy}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
