'use server';

import { getSupabaseAdmin, isDatabaseConfigured } from '@sakura-cross/shared-db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from './action-state';
import { requireAdmin } from '@/lib/admin/auth';
import { getAiClient } from '@/lib/ai/client';
import { getAiBossEnv } from '@/lib/env';
import { deliverManagerAnswer } from '@/lib/escalation/deliver';
import { convertToMarkdown } from '@/lib/import/convert';
import { CATEGORY_NAMES } from '@/lib/knowledge/categories';
import { chunkMarkdown } from '@/lib/knowledge/chunker';
import { getStaffLineClient } from '@/lib/line/client';
import { type AiBossSettings, aiBossSettingsSchema, DEFAULT_SETTINGS } from '@/lib/settings';
import { getStore, loadSettings, saveSettings } from '@/lib/store';

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateCategory(category: string): string | null {
  if (!category) return 'カテゴリを選択してください';
  return null;
}

// --- ナレッジ ---------------------------------------------------------------------

export async function createKnowledgeDoc(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const category = str(formData, 'category');
  const title = str(formData, 'title');
  const content = str(formData, 'content');
  const isActive = formData.get('isActive') === 'on';
  const categoryError = validateCategory(category);
  if (categoryError) return { error: categoryError };
  if (!title) return { error: 'タイトルを入力してください' };
  if (!content) return { error: '本文を入力してください' };

  const store = await getStore();
  const doc = await store.createDoc(
    { category, title, content, isActive, source: 'manual', updatedBy: admin.name },
    chunkMarkdown(content),
  );
  await store.audit({ actorId: admin.id, actorName: admin.name, action: 'knowledge.create', targetType: 'KnowledgeDoc', targetId: doc.id });
  revalidatePath('/admin/knowledge');
  redirect(`/admin/knowledge/${doc.id}?saved=1`);
}

export async function updateKnowledgeDoc(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const category = str(formData, 'category');
  const title = str(formData, 'title');
  const content = str(formData, 'content');
  const categoryError = validateCategory(category);
  if (categoryError) return { error: categoryError };
  if (!title) return { error: 'タイトルを入力してください' };
  if (!content) return { error: '本文を入力してください' };

  const store = await getStore();
  const current = await store.getDoc(id);
  if (!current) return { error: 'ドキュメントが見つかりません' };
  const contentChanged = current.content !== content;
  await store.updateDoc(
    id,
    { category, title, content, updatedBy: admin.name },
    contentChanged ? chunkMarkdown(content) : undefined,
  );
  await store.audit({
    actorId: admin.id,
    actorName: admin.name,
    action: 'knowledge.update',
    targetType: 'KnowledgeDoc',
    targetId: id,
    detail: { contentChanged },
  });
  revalidatePath('/admin/knowledge');
  revalidatePath(`/admin/knowledge/${id}`);
  return { success: contentChanged ? '保存しました。検索インデックスを更新しました。' : '保存しました。' };
}

export async function setKnowledgeDocActive(id: string, isActive: boolean): Promise<void> {
  const admin = await requireAdmin();
  const store = await getStore();
  await store.updateDoc(id, { isActive, updatedBy: admin.name });
  await store.audit({
    actorId: admin.id,
    actorName: admin.name,
    action: isActive ? 'knowledge.activate' : 'knowledge.deactivate',
    targetType: 'KnowledgeDoc',
    targetId: id,
  });
  revalidatePath('/admin/knowledge');
  revalidatePath(`/admin/knowledge/${id}`);
}

export async function deleteKnowledgeDoc(id: string): Promise<void> {
  const admin = await requireAdmin();
  const store = await getStore();
  await store.deleteDoc(id);
  await store.audit({ actorId: admin.id, actorName: admin.name, action: 'knowledge.delete', targetType: 'KnowledgeDoc', targetId: id });
  revalidatePath('/admin/knowledge');
  redirect('/admin/knowledge?deleted=1');
}

export async function restoreKnowledgeVersion(id: string, version: number): Promise<void> {
  const admin = await requireAdmin();
  const store = await getStore();
  const versions = await store.listDocVersions(id);
  const target = versions.find((v) => v.version === version);
  if (!target) return;
  await store.updateDoc(
    id,
    { category: target.category, title: target.title, content: target.content, updatedBy: admin.name },
    chunkMarkdown(target.content),
  );
  await store.audit({
    actorId: admin.id,
    actorName: admin.name,
    action: 'knowledge.restore',
    targetType: 'KnowledgeDoc',
    targetId: id,
    detail: { restoredVersion: version },
  });
  revalidatePath(`/admin/knowledge/${id}`);
}

// --- 取込 -------------------------------------------------------------------------

export async function importKnowledgeFile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const category = str(formData, 'category');
  const categoryError = validateCategory(category);
  if (categoryError) return { error: categoryError };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'ファイルを選択してください' };

  const store = await getStore();
  const bytes = Buffer.from(await file.arrayBuffer());
  const record = await store.createImport({
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: bytes.length,
    storagePath: null,
    category,
    createdBy: admin.name,
  });

  // 原本を Supabase Storage に保存(設定時のみ。失敗しても変換は続ける)
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const path = `imports/${record.id}/${file.name}`;
    const { error } = await supabase.storage
      .from(getAiBossEnv().knowledgeBucket)
      .upload(path, bytes, { contentType: file.type || undefined, upsert: false });
    if (!error) await store.updateImport(record.id, { storagePath: path });
  }

  try {
    await store.updateImport(record.id, { status: 'CONVERTING' });
    const result = await convertToMarkdown(getAiClient(), { fileName: file.name, mimeType: file.type, bytes, category });
    const draft = await store.createDoc(
      {
        category,
        title: result.title,
        content: result.markdown,
        isActive: false,
        source: 'import',
        updatedBy: admin.name,
      },
      chunkMarkdown(result.markdown),
    );
    await store.updateImport(record.id, { status: 'DRAFTED', draftDocId: draft.id });
    await store.audit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'knowledge.import',
      targetType: 'KnowledgeDoc',
      targetId: draft.id,
      detail: { importId: record.id, fileName: file.name, kind: result.kind, warnings: result.warnings },
    });
    revalidatePath('/admin/knowledge');
    revalidatePath('/admin/knowledge/import');
    const warn = result.warnings.length > 0 ? `&warn=${encodeURIComponent(result.warnings.join(' / '))}` : '';
    redirect(`/admin/knowledge/${draft.id}?imported=1${warn}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = errorMessage(error);
    await store.updateImport(record.id, { status: 'FAILED', lastError: message });
    revalidatePath('/admin/knowledge/import');
    return { error: `変換に失敗しました: ${message}` };
  }
}

function isRedirectError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error && String((error as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
}

// --- エスカレーション --------------------------------------------------------------------

export async function answerEscalation(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const answer = str(formData, 'answer');
  if (!answer) return { error: '回答を入力してください' };

  const store = await getStore();
  const ticket = await store.getEscalation(id);
  if (!ticket) return { error: 'チケットが見つかりません' };

  const now = new Date();
  await store.updateEscalation(id, {
    status: ticket.status === 'ADDED_TO_KB' ? 'ADDED_TO_KB' : 'ANSWERED',
    managerAnswer: answer,
    answeredBy: admin.name,
    answeredAt: now,
    deliveredAt: null,
  });
  // 会話ログにも店長回答を残す(次の追い質問の文脈になる)
  if (ticket.conversationId) {
    await store.appendMessage({ conversationId: ticket.conversationId, sender: 'manager', content: answer }).catch(() => undefined);
  }
  const settings = await loadSettings(store);
  const delivery = await deliverManagerAnswer({ store, messaging: getStaffLineClient(), settings, logger: console }, id);
  await store.audit({
    actorId: admin.id,
    actorName: admin.name,
    action: 'escalation.answer',
    targetType: 'EscalationTicket',
    targetId: id,
    detail: { delivered: delivery.delivered, queuedJobId: delivery.queuedJobId },
  });
  revalidatePath('/admin/escalations');
  revalidatePath('/admin');
  if (delivery.delivered) return { success: '回答を保存し、LINE で質問者に届けました。' };
  if (delivery.queuedJobId) return { success: `回答を保存しました。LINE 配信に失敗したため再試行キューに登録しました(${delivery.reason})。` };
  return { success: `回答を保存しました。LINE には配信できませんでした: ${delivery.reason}` };
}

export async function redeliverEscalation(id: string): Promise<void> {
  await requireAdmin();
  const store = await getStore();
  const settings = await loadSettings(store);
  await deliverManagerAnswer({ store, messaging: getStaffLineClient(), settings, logger: console }, id);
  revalidatePath('/admin/escalations');
}

export async function addEscalationToKnowledge(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const targetDocId = str(formData, 'targetDocId');
  const category = str(formData, 'category');
  const newTitle = str(formData, 'newTitle');

  const store = await getStore();
  const ticket = await store.getEscalation(id);
  if (!ticket) return { error: 'チケットが見つかりません' };
  if (!ticket.managerAnswer) return { error: '先に店長回答を保存してください' };

  const qa = `\n\n## Q: ${ticket.question.replace(/\s+/g, ' ').trim()}\n\n${ticket.managerAnswer.trim()}\n\n(${new Date().toLocaleDateString('ja-JP')} 未回答キューから追記)`;

  let docId: string;
  if (targetDocId && targetDocId !== '__new__') {
    const doc = await store.getDoc(targetDocId);
    if (!doc) return { error: '追記先のドキュメントが見つかりません' };
    const content = `${doc.content.trimEnd()}${qa}`;
    await store.updateDoc(targetDocId, { content, updatedBy: admin.name }, chunkMarkdown(content));
    docId = targetDocId;
  } else {
    const categoryError = validateCategory(category);
    if (categoryError) return { error: categoryError };
    const title = newTitle || `よくある質問(${category})`;
    const content = `# ${title}\n\n未回答キューから店長が回答した内容をまとめたドキュメントです。${qa}`;
    const doc = await store.createDoc(
      { category, title, content, isActive: true, source: 'escalation', updatedBy: admin.name },
      chunkMarkdown(content),
    );
    docId = doc.id;
  }
  await store.updateEscalation(id, { status: 'ADDED_TO_KB', addedDocId: docId });
  await store.audit({
    actorId: admin.id,
    actorName: admin.name,
    action: 'escalation.add_to_kb',
    targetType: 'EscalationTicket',
    targetId: id,
    detail: { docId },
  });
  revalidatePath('/admin/escalations');
  revalidatePath('/admin/knowledge');
  revalidatePath(`/admin/knowledge/${docId}`);
  return { success: 'ナレッジに追記しました。次の質問から検索対象になります。' };
}

// --- 設定 -------------------------------------------------------------------------

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const store = await getStore();
  const current = await loadSettings(store);

  const rules: AiBossSettings['emergencyRules'] = [];
  const ruleCount = Number(str(formData, 'ruleCount') || '0');
  for (let i = 0; i < ruleCount; i += 1) {
    const title = str(formData, `rule_${i}_title`);
    const keywords = str(formData, `rule_${i}_keywords`)
      .split(/[,、\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
    const response = str(formData, `rule_${i}_response`);
    const remove = formData.get(`rule_${i}_remove`) === 'on';
    if (remove) continue;
    if (!title && keywords.length === 0 && !response) continue; // 空の追加行
    if (!title || keywords.length === 0 || !response) {
      return { error: `緊急ルール ${i + 1}: タイトル・キーワード・応答文をすべて入力してください` };
    }
    const existingId = str(formData, `rule_${i}_id`);
    rules.push({ id: existingId || `rule-${Date.now()}-${i}`, title, keywords, response });
  }

  const candidate = {
    ...current,
    greeting: str(formData, 'greeting') || current.greeting,
    loggingNotice: str(formData, 'loggingNotice') || current.loggingNotice,
    escalationReply: str(formData, 'escalationReply') || current.escalationReply,
    lowConfidenceSuffix: str(formData, 'lowConfidenceSuffix') || current.lowConfidenceSuffix,
    hrRedirectReply: str(formData, 'hrRedirectReply') || current.hrRedirectReply,
    managerAnswerTemplate: str(formData, 'managerAnswerTemplate') || current.managerAnswerTemplate,
    nonTextReply: str(formData, 'nonTextReply') || current.nonTextReply,
    managerContact: str(formData, 'managerContact') || current.managerContact,
    answerMaxChars: Number(str(formData, 'answerMaxChars') || current.answerMaxChars),
    sessionMinutes: Number(str(formData, 'sessionMinutes') || current.sessionMinutes),
    maxTurns: Number(str(formData, 'maxTurns') || current.maxTurns),
    retrieveLimit: Number(str(formData, 'retrieveLimit') || current.retrieveLimit),
    emergencyRules: rules,
  };
  const parsed = aiBossSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: `入力内容に誤りがあります: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ')}` };
  }
  if (!parsed.data.greeting.includes('記録')) {
    return { error: 'あいさつ文には「この会話は記録され、店長が閲覧できます」の趣旨の文を必ず含めてください(指示書の必須要件)' };
  }
  await saveSettings(store, parsed.data, admin.name);
  await store.audit({ actorId: admin.id, actorName: admin.name, action: 'settings.update', targetType: 'AppSetting', targetId: 'ai-boss.settings' });
  revalidatePath('/admin/settings');
  return { success: '設定を保存しました。' };
}

export async function resetSettings(): Promise<void> {
  const admin = await requireAdmin();
  const store = await getStore();
  await saveSettings(store, DEFAULT_SETTINGS, admin.name);
  revalidatePath('/admin/settings');
}

// --- ユーティリティ -----------------------------------------------------------------------

export async function getEnvironmentSummary(): Promise<{ db: boolean; ai: boolean; line: boolean; supabaseAuth: boolean; categories: readonly string[] }> {
  return {
    db: isDatabaseConfigured(),
    ai: getAiClient().mode === 'live',
    line: getStaffLineClient().mode === 'live',
    supabaseAuth: Boolean(getSupabaseAdmin()),
    categories: CATEGORY_NAMES,
  };
}
