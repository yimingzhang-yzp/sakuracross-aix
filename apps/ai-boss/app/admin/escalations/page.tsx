import Link from 'next/link';

import { addEscalationToKnowledge, answerEscalation, redeliverEscalation } from '../actions';
import { ActionForm } from '../action-form';
import { formatTokyoFull } from '@/lib/format';
import { KNOWLEDGE_CATEGORIES } from '@/lib/knowledge/categories';
import { getStore } from '@/lib/store';
import type { EscalationStatus } from '@/lib/store/types';

const TABS: { key: EscalationStatus | 'ALL'; label: string }[] = [
  { key: 'OPEN', label: '未回答' },
  { key: 'ANSWERED', label: '回答済み(ナレッジ未追記)' },
  { key: 'ADDED_TO_KB', label: 'ナレッジ追記済み' },
  { key: 'ALL', label: 'すべて' },
];

export default async function EscalationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const status = (TABS.find((t) => t.key === params.status)?.key ?? 'OPEN') as EscalationStatus | 'ALL';
  const store = await getStore();
  const [tickets, docs] = await Promise.all([store.listEscalations({ status, limit: 200 }), store.listDocs({ includeInactive: true })]);

  return (
    <>
      <div className="page-header">
        <h1>未回答キュー(エスカレーション)</h1>
      </div>
      <p className="muted">
        AI がマニュアルに根拠を見つけられなかった質問です。回答を書くと質問者に LINE で届き、「ナレッジに追記」すると次回から AI が答えられるようになります。
      </p>

      <div className="actions" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/escalations?status=${t.key}`} className={`btn btn-sm${t.key === status ? ' btn-primary' : ''}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="card">
          <p className="muted">該当するチケットはありません。</p>
        </div>
      ) : (
        tickets.map((t) => {
          const candidates = docs.filter((d) => d.isActive);
          return (
            <section className="card" key={t.id} id={t.id}>
              <div className="page-header">
                <div>
                  <span
                    className={`badge ${t.status === 'OPEN' ? 'badge-amber' : t.status === 'ANSWERED' ? 'badge-blue' : 'badge-green'}`}
                  >
                    {t.status === 'OPEN' ? '未回答' : t.status === 'ANSWERED' ? '回答済み' : 'ナレッジ追記済み'}
                  </span>{' '}
                  <strong>{t.staffName}</strong> <span className="small muted">{formatTokyoFull(t.createdAt)}</span>
                  {t.conversationId ? (
                    <>
                      {' '}
                      <Link href={`/admin/conversations/${t.conversationId}`} className="small">
                        会話を見る →
                      </Link>
                    </>
                  ) : null}
                </div>
                <div className="small muted">
                  {t.answeredAt ? `回答 ${formatTokyoFull(t.answeredAt)}(${t.answeredBy})` : null}
                  {t.answeredAt ? (t.deliveredAt ? ' · LINE 配信済み' : ' · LINE 未配信') : null}
                </div>
              </div>

              <div className="field">
                <label>質問</label>
                <div className="prewrap" style={{ background: '#f4f6f9', padding: '10px 12px', borderRadius: 8 }}>
                  {t.question}
                </div>
              </div>

              <div className="grid grid-2">
                <div>
                  <ActionForm action={answerEscalation.bind(null, t.id)} submitLabel={t.managerAnswer ? '回答を更新して再送' : '回答して LINE で送る'}>
                    <div className="field">
                      <label htmlFor={`answer-${t.id}`}>店長の回答</label>
                      <textarea id={`answer-${t.id}`} name="answer" defaultValue={t.managerAnswer ?? ''} placeholder="スタッフにそのまま届く文章です。結論→手順の順で簡潔に" required />
                    </div>
                  </ActionForm>
                  {t.managerAnswer && !t.deliveredAt && t.staffLineUserId ? (
                    <form action={redeliverEscalation.bind(null, t.id)} style={{ marginTop: 8 }}>
                      <button type="submit" className="btn btn-sm">
                        LINE 配信を再試行
                      </button>
                    </form>
                  ) : null}
                  {!t.staffLineUserId ? <p className="small muted">このスタッフには LINE が紐付いていないため配信できません。</p> : null}
                </div>

                <div>
                  {t.status === 'ADDED_TO_KB' && t.addedDocId ? (
                    <div className="notice notice-success">
                      ナレッジに追記済み: <Link href={`/admin/knowledge/${t.addedDocId}`}>ドキュメントを開く →</Link>
                    </div>
                  ) : t.managerAnswer ? (
                    <ActionForm action={addEscalationToKnowledge.bind(null, t.id)} submitLabel="ナレッジに追記する">
                      <div className="field">
                        <label htmlFor={`target-${t.id}`}>追記先ドキュメント</label>
                        <select id={`target-${t.id}`} name="targetDocId" defaultValue="__new__">
                          <option value="__new__">新しいドキュメントを作る(下のカテゴリ)</option>
                          {candidates.map((d) => (
                            <option key={d.id} value={d.id}>
                              [{d.category}] {d.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-2">
                        <div className="field">
                          <label htmlFor={`cat-${t.id}`}>新規作成時のカテゴリ</label>
                          <select id={`cat-${t.id}`} name="category" defaultValue="">
                            <option value="">選択</option>
                            {KNOWLEDGE_CATEGORIES.map((c) => (
                              <option key={c.key} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`title-${t.id}`}>新規作成時のタイトル(任意)</label>
                          <input id={`title-${t.id}`} className="input" name="newTitle" placeholder="よくある質問(カテゴリ名)" />
                        </div>
                      </div>
                    </ActionForm>
                  ) : (
                    <p className="small muted">回答を保存すると、ここからナレッジに追記できます。</p>
                  )}
                </div>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
