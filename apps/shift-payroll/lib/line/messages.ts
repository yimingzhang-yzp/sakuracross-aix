/**
 * LINE メッセージの組み立て(テキスト / Flex Message)
 * 文言はすべて日本語。LIFF の URL は環境変数から解決し、未設定なら Web 版の URL にフォールバックする。
 */
import { formatInTokyo } from '@sakura-cross/business-date';
import { type LineMessage, buildPostbackData } from '@sakura-cross/line-router';

import { businessDateLabel, timeRange, yen } from '../format';
import { STAFF_ROLE_LABELS, type StaffRole } from '../scheduling/types';

export type LiffPage = 'register' | 'preference' | 'schedule' | 'timeclock' | 'payslip';

const LIFF_ENV: Record<LiffPage, string | undefined> = {
  register: 'LINE_STAFF_LIFF_ID_PREFERENCE',
  preference: 'LINE_STAFF_LIFF_ID_PREFERENCE',
  schedule: 'LINE_STAFF_LIFF_ID_SCHEDULE',
  timeclock: 'LINE_STAFF_LIFF_ID_TIMECLOCK',
  payslip: 'LINE_STAFF_LIFF_ID_PAYSLIP',
};

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL_SHIFT_PAYROLL ?? 'http://localhost:3001').replace(/\/$/, '');
}

export function liffUrl(page: LiffPage): string {
  const envKey = LIFF_ENV[page];
  const liffId = envKey ? process.env[envKey]?.trim() : undefined;
  if (liffId) return `https://liff.line.me/${liffId}${page === 'register' ? '?page=register' : ''}`;
  return `${appBaseUrl()}/liff/${page}`;
}

export const text = (t: string): LineMessage => ({ type: 'text', text: t });

export function registrationGuideMessage(): LineMessage {
  return text(
    `CROSS ROPPONGI スタッフ用アカウントへようこそ。\nはじめに以下から氏名を登録してください。店長が承認すると、希望提出・シフト確認・打刻・給与明細が使えるようになります。\n${liffUrl('register')}`,
  );
}

export interface ConfirmedShiftLine {
  businessDate: string;
  role: StaffRole;
  start: Date;
  end: Date;
  status: 'CONFIRMED' | 'CANCELLED' | 'ABSENT';
}

export function confirmedShiftMessage(staffName: string, periodLabel: string, lines: ConfirmedShiftLine[], isUpdate: boolean): LineMessage {
  const active = lines.filter((l) => l.status === 'CONFIRMED');
  const cancelled = lines.filter((l) => l.status === 'CANCELLED');
  const body = active.length === 0 ? '(確定シフトはありません)' : active.map((l) => `・${businessDateLabel(l.businessDate)} ${timeRange(l.start, l.end)} ${STAFF_ROLE_LABELS[l.role]}`).join('\n');
  const cancelledBody = cancelled.length > 0 ? `\n\n【取消】\n${cancelled.map((l) => `・${businessDateLabel(l.businessDate)} ${timeRange(l.start, l.end)}`).join('\n')}` : '';
  return text(
    `${staffName}さん、${periodLabel}のシフトが${isUpdate ? '変更' : '確定'}しました。\n\n${body}${cancelledBody}\n\n詳細: ${liffUrl('schedule')}`,
  );
}

export function preferenceReminderMessage(periodLabel: string, deadline: Date, isDeadlineDay: boolean): LineMessage {
  return text(
    `【希望シフト提出のお願い】${periodLabel}分の希望がまだ提出されていません。\n締切: ${formatInTokyo(deadline, 'M/d HH:mm')}${isDeadlineDay ? '(本日)' : ''}\n提出はこちら: ${liffUrl('preference')}`,
  );
}

export interface OpenShiftCard {
  id: string;
  businessDate: string;
  role: StaffRole;
  start: Date;
  end: Date;
  hourlyWage: number | null;
  reason: string;
  mode: 'FIRST_COME' | 'MANAGER_APPROVAL';
  eventName?: string | null;
}

/** 欠員募集の Flex Message(日付 / 時間 / 職種 / 時給 / 応募ボタン) */
export function openShiftFlexMessage(card: OpenShiftCard): LineMessage {
  const postback = buildPostbackData('shift', 'apply_open_shift', { id: card.id });
  const row = (label: string, value: string) => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#8c8c8c', size: 'sm', flex: 2 },
      { type: 'text', text: value, wrap: true, size: 'sm', flex: 5 },
    ],
  });
  return {
    type: 'flex',
    altText: `【欠員募集】${businessDateLabel(card.businessDate)} ${STAFF_ROLE_LABELS[card.role]} ${timeRange(card.start, card.end)}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: '欠員募集', weight: 'bold', color: '#ffffff', size: 'md' }],
        backgroundColor: '#0f172a',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `${businessDateLabel(card.businessDate, true)}${card.eventName ? ` ${card.eventName}` : ''}`, weight: 'bold', size: 'lg', wrap: true },
          row('時間', timeRange(card.start, card.end)),
          row('職種', STAFF_ROLE_LABELS[card.role]),
          row('時給', card.hourlyWage ? yen(card.hourlyWage) : '通常どおり'),
          row('理由', card.reason),
          {
            type: 'text',
            text: card.mode === 'FIRST_COME' ? '先着順で確定します' : '店長の承認後に確定します',
            size: 'xs',
            color: '#8c8c8c',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#0284c7',
            action: { type: 'postback', label: '応募する', data: postback, displayText: '応募します' },
          },
        ],
      },
    },
  };
}

export function payslipMessage(
  staffName: string,
  periodLabel: string,
  item: { grossPay: number; netPay: number; basePay: number; nightPremiumPay: number; incentivePay: number; advanceDeduction: number; totalMinutes: number },
): LineMessage {
  const h = Math.floor(item.totalMinutes / 60);
  const m = item.totalMinutes % 60;
  return text(
    `${staffName}さんの給与明細(${periodLabel})が確定しました。\n\n労働時間: ${h}時間${m}分\n基本給: ${yen(item.basePay)}\n深夜割増: ${yen(item.nightPremiumPay)}\nインセンティブ: ${yen(item.incentivePay)}\n総支給: ${yen(item.grossPay)}\n日払い控除: -${yen(item.advanceDeduction)}\n差引支給: ${yen(item.netPay)}\n\n※所得税・社会保険は含みません。詳細: ${liffUrl('payslip')}`,
  );
}

export function openShiftResultMessage(won: boolean, card: Pick<OpenShiftCard, 'businessDate' | 'role' | 'start' | 'end'>): LineMessage {
  return won
    ? text(`応募ありがとうございます。${businessDateLabel(card.businessDate)} ${timeRange(card.start, card.end)} ${STAFF_ROLE_LABELS[card.role]} のシフトが確定しました。`)
    : text(`${businessDateLabel(card.businessDate)} ${timeRange(card.start, card.end)} の募集は、先に決まってしまいました。次回の募集をお待ちください。`);
}

export function openShiftClosedMessage(card: Pick<OpenShiftCard, 'businessDate' | 'role' | 'start' | 'end'>): LineMessage {
  return text(`${businessDateLabel(card.businessDate)} ${timeRange(card.start, card.end)} ${STAFF_ROLE_LABELS[card.role]} の募集は締め切りました。ご協力ありがとうございました。`);
}

export function openShiftPendingApprovalMessage(): LineMessage {
  return text('応募を受け付けました。店長の承認後に確定のご連絡をします。');
}
