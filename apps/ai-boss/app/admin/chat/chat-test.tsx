'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

interface ChatResponse {
  reply: string;
  kind: 'emergency' | 'answered' | 'escalated' | 'hr_redirect';
  confidence: string;
  citedDocTitles: string[];
  ticketId: string | null;
  conversationId: string;
  isNewConversation: boolean;
  latencyMs: number;
  retrieved: { docTitle: string; heading: string | null; score: number }[];
  mode: 'live' | 'mock';
  error?: string;
}

interface Bubble {
  id: number;
  role: 'staff' | 'ai';
  text: string;
  meta?: ChatResponse;
}

const KIND_LABEL: Record<ChatResponse['kind'], { label: string; cls: string }> = {
  answered: { label: 'ナレッジから回答', cls: 'badge-green' },
  escalated: { label: 'エスカレーション(未回答キューへ)', cls: 'badge-red' },
  hr_redirect: { label: '人事質問 → 店長へ誘導', cls: 'badge-gray' },
  emergency: { label: '緊急固定応答', cls: 'badge-red' },
};

const SAMPLES = [
  'ドリンクチケットは翌日も使えますか?',
  'VIPのお客様でも同じですか?',
  '免許証の期限が切れていたら?',
  'Wi-Fiのパスワードを教えてください',
  '私の時給はいくらですか?',
  'お客様が倒れて意識がありません',
];

export function ChatTest({ aiMode }: { aiMode: 'live' | 'mock' }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const nextReset = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setError(null);
    setPending(true);
    setInput('');
    setBubbles((prev) => [...prev, { id: Date.now(), role: 'staff', text: question }]);
    try {
      const res = await fetch('/api/admin/chat-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: question, reset: nextReset.current }),
      });
      nextReset.current = false;
      const data = (await res.json()) as ChatResponse;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConversationId(data.conversationId);
      setBubbles((prev) => [...prev, { id: Date.now() + 1, role: 'ai', text: data.reply, meta: data }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function resetConversation() {
    nextReset.current = true;
    setBubbles([]);
    setConversationId(null);
    setError(null);
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16 }}>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 560 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <div className="small muted">
            スタッフの LINE 画面の再現{aiMode === 'mock' ? '(AI はモック。回答本文はマニュアル該当箇所の抜粋)' : ''}
            {conversationId ? (
              <>
                {' · '}
                <Link href={`/admin/conversations/${conversationId}`}>この会話のログを開く →</Link>
              </>
            ) : null}
          </div>
          <div className="actions">
            <label className="small">
              <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> 判定の詳細を表示
            </label>
            <button type="button" className="btn btn-sm" onClick={resetConversation}>
              新しい会話にする
            </button>
          </div>
        </div>

        <div
          className="chat"
          style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#8cabd9', borderRadius: 12, minHeight: 380 }}
        >
          {bubbles.length === 0 ? (
            <p className="small" style={{ color: '#fff', textAlign: 'center', marginTop: 40 }}>
              下の入力欄から質問を送ってください。右のサンプルをクリックしても送れます。
            </p>
          ) : null}
          {bubbles.map((b) => (
            <div key={b.id} className={`bubble ${b.role}`} style={{ background: b.role === 'staff' ? '#8de55a' : '#fff' }}>
              {b.text}
              {b.meta ? (
                <div className="meta">
                  <span className={`badge ${KIND_LABEL[b.meta.kind].cls}`}>{KIND_LABEL[b.meta.kind].label}</span>{' '}
                  {b.meta.confidence} · {b.meta.latencyMs}ms
                  {b.meta.ticketId ? (
                    <>
                      {' · '}
                      <Link href="/admin/escalations">未回答キューに登録 →</Link>
                    </>
                  ) : null}
                  {showDebug && b.meta.retrieved.length > 0 ? (
                    <div style={{ marginTop: 4 }}>
                      検索上位:{' '}
                      {b.meta.retrieved.map((r, i) => (
                        <span key={i}>
                          {i > 0 ? ' / ' : ''}
                          {r.docTitle}
                          {r.heading ? `(${r.heading.split(' > ').slice(-1)[0]})` : ''} {r.score}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {pending ? (
            <div className="bubble ai" style={{ background: '#fff' }}>
              <span className="muted">応答中…</span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? <div className="notice notice-error" style={{ marginTop: 8 }}>{error}</div> : null}

        <form onSubmit={onSubmit} className="inline-form" style={{ marginTop: 12 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="スタッフとして質問を入力(Enter で送信)"
            disabled={pending}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={pending || !input.trim()}>
            送信
          </button>
        </form>
      </section>

      <aside>
        <section className="card">
          <h2>サンプル質問</h2>
          <div className="grid" style={{ gap: 6 }}>
            {SAMPLES.map((s) => (
              <button key={s} type="button" className="btn btn-sm" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => void send(s)} disabled={pending}>
                {s}
              </button>
            ))}
          </div>
        </section>
        <section className="card small muted">
          <p>本番の LINE と同じ処理経路(緊急キーワード → 30 分セッション → 検索 → 生成 → 分岐)を通ります。会話は「チャットテスト(管理者名)」というスタッフ名で会話ログに記録され、エスカレーションも未回答キューに入ります。</p>
          <p>「VIPのお客様でも同じですか?」のような追い質問は、直前の質問の文脈を使って答えます(30 分以内)。「新しい会話にする」で文脈を切れます。</p>
        </section>
      </aside>
    </div>
  );
}
