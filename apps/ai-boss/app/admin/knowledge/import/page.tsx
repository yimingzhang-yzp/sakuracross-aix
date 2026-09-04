import Link from 'next/link';

import { importKnowledgeFile } from '../../actions';
import { ActionForm } from '../../action-form';
import { getAiClient } from '@/lib/ai/client';
import { formatTokyoFull } from '@/lib/format';
import { KNOWLEDGE_CATEGORIES } from '@/lib/knowledge/categories';
import { getStore } from '@/lib/store';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待機', cls: 'badge-gray' },
  CONVERTING: { label: '変換中', cls: 'badge-blue' },
  DRAFTED: { label: 'ドラフト作成済み', cls: 'badge-green' },
  FAILED: { label: '失敗', cls: 'badge-red' },
};

export default async function ImportPage() {
  const store = await getStore();
  const imports = await store.listImports(30);
  const aiMock = getAiClient().mode === 'mock';

  return (
    <>
      <div className="page-header">
        <h1>マニュアル取込(PDF / Word / 画像)</h1>
        <Link href="/admin/knowledge">← ナレッジ一覧へ</Link>
      </div>

      <div className="card">
        <p>
          既存のマニュアルをアップロードすると、Claude が内容を読み取って Markdown に変換し、<strong>ドラフト</strong>として登録します。
          変換結果はプレビュー・修正してから「有効化」してください(有効化するまで AI の回答には使われません)。
        </p>
        {aiMock ? (
          <div className="notice notice-warn">
            ANTHROPIC_API_KEY が未設定のため、PDF / 画像の内容は読み取られず、雛形だけが作られます(テキスト・Word はそのまま取り込みます)。
          </div>
        ) : null}
        <ActionForm action={importKnowledgeFile} submitLabel="アップロードして変換">
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="category">カテゴリ</label>
              <select id="category" name="category" required defaultValue="">
                <option value="">選択してください</option>
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="file">ファイル</label>
              <input id="file" className="input" type="file" name="file" accept=".pdf,.docx,.md,.txt,.png,.jpg,.jpeg,.gif,.webp" required />
              <span className="hint">PDF / Word(.docx)/ 画像(PNG・JPEG・GIF・WebP)/ テキスト。上限 20MB。変換には 10〜60 秒かかります</span>
            </div>
          </div>
        </ActionForm>
      </div>

      <div className="card">
        <h2>取込履歴</h2>
        {imports.length === 0 ? (
          <p className="muted">まだ取込はありません。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>日時</th>
                <th>ファイル</th>
                <th>カテゴリ</th>
                <th>状態</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => {
                const badge = STATUS_BADGE[i.status] ?? { label: i.status, cls: 'badge-gray' };
                return (
                  <tr key={i.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatTokyoFull(i.createdAt)}</td>
                    <td>
                      {i.fileName}
                      <div className="small muted">
                        {(i.sizeBytes / 1024).toFixed(0)} KB · {i.createdBy}
                      </div>
                    </td>
                    <td>{i.category}</td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="small">
                      {i.draftDocId ? <Link href={`/admin/knowledge/${i.draftDocId}`}>ドラフトを開く →</Link> : null}
                      {i.lastError ? <span className="muted">{i.lastError}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
