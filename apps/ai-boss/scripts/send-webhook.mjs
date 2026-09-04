// LINE を通さずに Webhook を疑似送信する(開発モード・署名未設定時のみ)。
//   npm run webhook:send --workspace=@sakura-cross/ai-boss -- "質問1" "質問2"
//   環境変数: LINE_USER(疑似ユーザー ID、既定 Udemo001)/ WEBHOOK_URL(既定 http://localhost:3002/api/line/webhook)
const url = process.env.WEBHOOK_URL ?? 'http://localhost:3002/api/line/webhook';
const userId = process.env.LINE_USER ?? 'Udemo001';
const prefix = process.env.EVENT_PREFIX ?? `demo-${Date.now()}`;

function textEvent(i, text) {
  return {
    type: 'message',
    webhookEventId: `${prefix}-${i}`,
    timestamp: Date.now(),
    mode: 'active',
    source: { type: 'user', userId },
    replyToken: `reply-${prefix}-${i}`,
    message: { id: `m-${prefix}-${i}`, type: 'text', text },
  };
}

const questions = process.argv.slice(2);
const events = [
  { type: 'follow', webhookEventId: `${prefix}-follow`, timestamp: Date.now(), mode: 'active', source: { type: 'user', userId }, replyToken: `reply-${prefix}-f` },
  ...questions.map((q, i) => textEvent(i, q)),
];

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ destination: 'Ubot', events }),
});
console.log(res.status, await res.text());
