import Link from 'next/link';
import { notFound } from 'next/navigation';

import { deleteKnowledgeDoc, restoreKnowledgeVersion, setKnowledgeDocActive, updateKnowledgeDoc } from '../../actions';
import { MarkdownView } from '../../markdown-view';
import { DocForm } from '../doc-form';
import { formatTokyoFull } from '@/lib/format';
import { CATEGORY_NAMES } from '@/lib/knowledge/categories';
import { getStore } from '@/lib/store';

export default async function KnowledgeDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; imported?: string; warn?: string }>;
}) {
  const { id } = await params;
  const flags = await searchParams;
  const store = await getStore();
  const doc = await store.getDoc(id);
  if (!doc) notFound();
  const [chunks, versions] = await Promise.all([store.listChunks(id), store.listDocVersions(id)]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{doc.title}</h1>
          <div className="small muted">
            {doc.category} · v{doc.version} · 更新 {formatTokyoFull(doc.updatedAt)}({doc.updatedBy})· チャンク {chunks.length} 個
          </div>
        </div>
        <div className="actions">
          {doc.isActive ? (
            <form action={setKnowledgeDocActive.bind(null, id, false)}>
              <button type="submit" className="btn">
                無効化(検索対象から外す)
              </button>
            </form>
          ) : (
            <form action={setKnowledgeDocActive.bind(null, id, true)}>
              <button type="submit" className="btn btn-primary">
                有効化(検索対象にする)
              </button>
            </form>
          )}
          <form action={deleteKnowledgeDoc.bind(null, id)}>
            <button type="submit" className="btn btn-danger">
              削除
            </button>
          </form>
          <Link href="/admin/knowledge">← 一覧へ</Link>
        </div>
      </div>

      {flags.saved ? <div className="notice notice-success">作成しました。</div> : null}
      {flags.imported ? (
        <div className="notice notice-info">
          取込が完了し、ドラフトとして保存しました。内容を確認・修正してから「有効化」してください。
          {flags.warn ? <div style={{ marginTop: 4 }}>注意: {flags.warn}</div> : null}
        </div>
      ) : null}
      {!doc.isActive ? <div className="notice notice-warn">このドキュメントはドラフトです。有効化するまで AI の回答には使われません。</div> : null}

      <div className="grid grid-2">
        <section className="card">
          <h2>編集</h2>
          <DocForm
            action={updateKnowledgeDoc.bind(null, id)}
            categories={CATEGORY_NAMES}
            initial={{ category: doc.category, title: doc.title, content: doc.content }}
            submitLabel="保存する"
          />
        </section>
        <section className="card" style={{ maxHeight: 720, overflow: 'auto' }}>
          <h2>プレビュー(保存済みの内容)</h2>
          <MarkdownView content={doc.content} />
        </section>
      </div>

      <section className="card">
        <details>
          <summary>チャンク分割の結果({chunks.length} 個)— 検索はこの単位で行われます</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>見出し</th>
                <th>本文</th>
                <th>文字数</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((c) => (
                <tr key={c.id}>
                  <td>{c.chunkIndex + 1}</td>
                  <td className="small">{c.heading ?? '—'}</td>
                  <td className="small prewrap">{c.content}</td>
                  <td>{c.content.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="card">
        <h2>バージョン履歴</h2>
        {versions.length === 0 ? (
          <p className="muted">まだ変更履歴はありません(保存すると保存前の内容がここに残ります)。</p>
        ) : (
          versions.map((v) => (
            <details key={v.id} style={{ marginBottom: 8 }}>
              <summary>
                v{v.version} — {formatTokyoFull(v.createdAt)}({v.updatedBy})· {v.title}
              </summary>
              <div style={{ margin: '8px 0' }}>
                <form action={restoreKnowledgeVersion.bind(null, id, v.version)}>
                  <button type="submit" className="btn btn-sm">
                    この版の内容に戻す(新しい版として保存)
                  </button>
                </form>
              </div>
              <pre className="prewrap">{v.content}</pre>
            </details>
          ))
        )}
      </section>
    </>
  );
}
