import { ChatTest } from './chat-test';
import { getAiClient } from '@/lib/ai/client';

export default function ChatTestPage() {
  const aiMode = getAiClient().mode;
  return (
    <>
      <div className="page-header">
        <h1>チャットテスト</h1>
        <span className="muted small">LINE を繋ぐ前に Bot の応答を確認する画面(店長・管理者用)</span>
      </div>
      {aiMode === 'mock' ? (
        <div className="notice notice-warn">
          ANTHROPIC_API_KEY が未設定のため AI はモックです。回答本文はマニュアルの該当箇所の抜粋になり、文脈を踏まえた自然な回答にはなりません。「答える / 店長に回す / 誘導する / 緊急」の分岐と、ナレッジの当たり方を確認する用途で使ってください。
        </div>
      ) : null}
      <ChatTest aiMode={aiMode} />
    </>
  );
}
