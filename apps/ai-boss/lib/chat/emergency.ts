/**
 * 緊急キーワードの固定応答(指示書 02 §4.1-5)。
 * RAG・API を介さず即時に返す。ルールは設定値(管理画面で編集可)。
 */
import type { EmergencyRule } from '../settings';
import { normalizeText } from '../knowledge/tokenize';

export function detectEmergency(text: string, rules: readonly EmergencyRule[]): EmergencyRule | null {
  const normalized = normalizeText(text);
  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      const k = normalizeText(keyword);
      if (k && normalized.includes(k)) return rule;
    }
  }
  return null;
}

export function formatEmergencyReply(rule: EmergencyRule, managerContact: string): string {
  return `${rule.response}\n\n${managerContact}\n\n※これは固定の緊急手順です。状況が落ち着いたら必ず責任者に報告してください。`;
}
