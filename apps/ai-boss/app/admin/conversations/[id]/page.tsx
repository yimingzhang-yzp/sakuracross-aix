import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatTokyoFull } from '@/lib/format';
import { getStore } from '@/lib/store';

const CONFIDENCE_LABEL: Record<string, { label: string; cls: string }> = {
  high: { label: '回答(確信度 高)', cls: 'badge-green' },
  low: { label: '回答(確信度 低・店長確認)', cls: 'badge-amber' },
  no_answer: { label: 'エスカレーション', cls: 'badge-red' },
  emergency: { label: '緊急固定応答', cls: 'badge-red' },
  hr_redirect: { label: '人事質問 → 店長へ誘導', cls: 'badge-gray' },
};

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const conversation = await store.getConversation(id);
  if (!conversation) notFound();
  const docs = await store.listDocs({ includeInactive: true });
  const titleOf = (docId: string) => docs.find((d) => d.id === docId)?.title ?? '(削除済み)';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>会話ログ: {conversation.staff.name}</h1>
          <div className="small muted">
            開始 {formatTokyoFull(conversation.createdAt)} · 最終 {formatTokyoFull(conversation.lastMessageAt)} ·{' '}
            {conversation.closedAt ? '終了(30 分無応答)' : '進行中'} · {conversation.messages.length} 件
            {!conversation.staff.isActive ? ' · 仮登録スタッフ' : ''}
          </div>
        </div>
        <Link href="/admin/conversations">← 一覧へ</Link>
      </div>

      <div className="card">
        <div className="chat">
          {conversation.messages.map((m) => {
            const conf = m.confidence ? CONFIDENCE_LABEL[m.confidence] : null;
            return (
              <div key={m.id} className={`bubble ${m.sender}`}>
                {m.content}
                <div className="meta">
                  {m.sender === 'staff' ? 'スタッフ' : m.sender === 'ai' ? 'AI' : '店長'} · {formatTokyoFull(m.createdAt)}
                  {conf ? (
                    <>
                      {' '}
                      <span className={`badge ${conf.cls}`}>{conf.label}</span>
                    </>
                  ) : null}
                  {m.citedDocIds.length > 0 ? (
                    <div>
                      根拠:{' '}
                      {m.citedDocIds.map((docId, i) => (
                        <span key={docId}>
                          {i > 0 ? '、' : ''}
                          <Link href={`/admin/knowledge/${docId}`}>{titleOf(docId)}</Link>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
