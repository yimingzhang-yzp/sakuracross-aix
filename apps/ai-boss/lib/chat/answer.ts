/**
 * 質問応答のオーケストレーション(指示書 02 §2 / §4.1 / §4.2)
 *
 *   緊急キーワード → 固定応答(API を待たない)
 *   ↓
 *   セッション解決(30 分無応答で新規 Conversation)→ スタッフ発言を記録
 *   ↓
 *   検索(KnowledgeRetriever)→ Claude で JSON 生成 → confidence で分岐
 *     high        → 回答 + 根拠ドキュメント名
 *     low         → 回答 + 注意書き + EscalationTicket(店長が確認)
 *     no_answer   → 「店長に確認します」 + EscalationTicket
 *     hr_redirect → 店長へ誘導(チケットは作らない)
 *   API 失敗      → 「店長に確認します」 + EscalationTicket(質問を取りこぼさない)
 */
import { type AiClient, AiClientError } from '@sakura-cross/ai-client';

import { detectEmergency, formatEmergencyReply } from './emergency';
import { answerSchema, buildMessages, buildSystemPrompt } from './prompt';
import type { KnowledgeRetriever, RetrievedChunk } from '../knowledge/retriever';
import type { AiBossSettings } from '../settings';
import type { AiBossStore, ConversationRecord, MessageConfidence, MessageRecord, StaffRecord } from '../store/types';

export interface AnswerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface AnswerDeps {
  store: AiBossStore;
  ai: AiClient;
  retriever: KnowledgeRetriever;
  settings: AiBossSettings;
  logger?: AnswerLogger;
  now?: () => Date;
}

export type AnswerKind = 'emergency' | 'answered' | 'escalated' | 'hr_redirect';

export interface AnswerOutcome {
  kind: AnswerKind;
  confidence: MessageConfidence;
  replyText: string;
  conversationId: string;
  isNewConversation: boolean;
  citedDocIds: string[];
  citedDocTitles: string[];
  ticketId: string | null;
  retrieved: RetrievedChunk[];
  /** AI 呼び出しの失敗理由(あれば) */
  error: string | null;
  latencyMs: number;
}

const silentLogger: AnswerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * 直近の会話が sessionMinutes 以内で未クローズなら継続、そうでなければ古い会話を閉じて新規作成。
 */
export async function resolveConversation(
  store: AiBossStore,
  staffId: string,
  now: Date,
  sessionMinutes: number,
): Promise<{ conversation: ConversationRecord; isNew: boolean }> {
  const latest = await store.findLatestConversation(staffId);
  if (latest && !latest.closedAt) {
    const ageMs = now.getTime() - latest.lastMessageAt.getTime();
    if (ageMs <= sessionMinutes * 60 * 1000) {
      return { conversation: latest, isNew: false };
    }
    await store.closeConversation(latest.id, now);
  }
  return { conversation: await store.createConversation(staffId, now), isNew: true };
}

function citationLine(titles: string[]): string {
  if (titles.length === 0) return '';
  const unique = [...new Set(titles)];
  return `根拠: ${unique.map((t) => `『${t}』`).join('、')}`;
}

function withNotice(text: string, isNew: boolean, notice: string): string {
  return isNew ? `${text}\n\n※${notice}` : text;
}

export async function handleStaffQuestion(
  deps: AnswerDeps,
  input: { staff: StaffRecord; text: string },
): Promise<AnswerOutcome> {
  const { store, ai, retriever, settings } = deps;
  const logger = deps.logger ?? silentLogger;
  const now = deps.now ? deps.now() : new Date();
  const startedAt = Date.now();
  const question = input.text.trim();

  const { conversation, isNew } = await resolveConversation(store, input.staff.id, now, settings.sessionMinutes);
  const staffMessage = await store.appendMessage({
    conversationId: conversation.id,
    sender: 'staff',
    content: question,
    createdAt: now,
  });
  // AI の返信は必ず質問より後の時刻にする(同一時刻だと DB の createdAt 順が不定になり、履歴の並びが崩れる)
  const replyAt = (): Date => new Date(Math.max(Date.now(), now.getTime() + 1));

  const base = {
    conversationId: conversation.id,
    isNewConversation: isNew,
    retrieved: [] as RetrievedChunk[],
    error: null as string | null,
  };

  // 1. 緊急キーワード(RAG・API を介さず即時)
  const emergency = detectEmergency(question, settings.emergencyRules);
  if (emergency) {
    const replyText = withNotice(formatEmergencyReply(emergency, settings.managerContact), isNew, settings.loggingNotice);
    await store.appendMessage({ conversationId: conversation.id, sender: 'ai', content: replyText, createdAt: replyAt(), confidence: 'emergency' });
    logger.info('[ai-boss] 緊急固定応答', { rule: emergency.id, staffId: input.staff.id });
    return {
      ...base,
      kind: 'emergency',
      confidence: 'emergency',
      replyText,
      citedDocIds: [],
      citedDocTitles: [],
      ticketId: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 2. 会話履歴(直近 maxTurns 往復。今回のスタッフ発言は id で除外する)
  const historyAll = await store.listMessages(conversation.id, settings.maxTurns * 2 + 1);
  const history: MessageRecord[] = historyAll.filter((m) => m.id !== staffMessage.id);

  // 3. 検索 → 生成
  let retrieved: RetrievedChunk[] = [];
  try {
    retrieved = await retriever.retrieve(question, { limit: settings.retrieveLimit });
  } catch (error) {
    logger.error('[ai-boss] ナレッジ検索に失敗', { error: error instanceof Error ? error.message : String(error) });
  }

  let output: { answer: string; confidence: 'high' | 'low' | 'no_answer' | 'hr_redirect'; cited_doc_ids: string[] };
  let aiError: string | null = null;
  try {
    const result = await ai.generateJson({
      purpose: 'ai-boss.answer',
      system: buildSystemPrompt(settings.answerMaxChars),
      messages: buildMessages(history, retrieved, question),
      schema: answerSchema,
      maxTokens: 1024,
    });
    output = result.data;
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error);
    logger.error('[ai-boss] 回答生成に失敗(エスカレーションにフォールバック)', {
      error: aiError,
      retryable: error instanceof AiClientError ? error.retryable : undefined,
    });
    output = { answer: '', confidence: 'no_answer', cited_doc_ids: [] };
  }

  // 4. 分岐
  const docById = new Map<string, RetrievedChunk>();
  for (const c of retrieved) if (!docById.has(c.docId)) docById.set(c.docId, c);
  const citedDocIds = output.cited_doc_ids.filter((id) => docById.has(id));
  const citedDocTitles = citedDocIds.map((id) => docById.get(id)!.docTitle);

  if (output.confidence === 'hr_redirect') {
    const replyText = withNotice(settings.hrRedirectReply, isNew, settings.loggingNotice);
    await store.appendMessage({ conversationId: conversation.id, sender: 'ai', content: replyText, createdAt: replyAt(), confidence: 'hr_redirect' });
    return {
      ...base,
      retrieved,
      kind: 'hr_redirect',
      confidence: 'hr_redirect',
      replyText,
      citedDocIds: [],
      citedDocTitles: [],
      ticketId: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  const answerText = output.answer.trim();
  const needsEscalation = output.confidence === 'no_answer' || output.confidence === 'low' || (!answerText && output.confidence === 'high');

  if (output.confidence === 'no_answer' || !answerText) {
    const ticket = await store.createEscalation({ staffId: input.staff.id, conversationId: conversation.id, question });
    const replyText = withNotice(settings.escalationReply, isNew, settings.loggingNotice);
    await store.appendMessage({ conversationId: conversation.id, sender: 'ai', content: replyText, createdAt: replyAt(), confidence: 'no_answer' });
    logger.info('[ai-boss] エスカレーション', { ticketId: ticket.id, staffId: input.staff.id, aiError });
    return {
      ...base,
      retrieved,
      error: aiError,
      kind: 'escalated',
      confidence: 'no_answer',
      replyText,
      citedDocIds: [],
      citedDocTitles: [],
      ticketId: ticket.id,
      latencyMs: Date.now() - startedAt,
    };
  }

  let ticketId: string | null = null;
  const parts = [answerText];
  if (output.confidence === 'low') {
    parts.push(settings.lowConfidenceSuffix);
  }
  const citation = citationLine(citedDocTitles);
  if (citation) parts.push(citation);
  if (needsEscalation) {
    const ticket = await store.createEscalation({ staffId: input.staff.id, conversationId: conversation.id, question });
    ticketId = ticket.id;
  }
  const replyText = withNotice(parts.join('\n\n'), isNew, settings.loggingNotice);
  await store.appendMessage({
    conversationId: conversation.id,
    sender: 'ai',
    content: replyText,
    createdAt: replyAt(),
    citedDocIds,
    confidence: output.confidence,
  });
  return {
    ...base,
    retrieved,
    kind: 'answered',
    confidence: output.confidence,
    replyText,
    citedDocIds,
    citedDocTitles,
    ticketId,
    latencyMs: Date.now() - startedAt,
  };
}
