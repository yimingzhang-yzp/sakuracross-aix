/**
 * LINE Messaging API Webhook のイベント型(必要最小限の構造的サブセット)。
 *
 * `@line/bot-sdk` の型に依存せず、ルーター層で参照するフィールドのみを定義する。
 * アプリ側で SDK の完全な型が必要な場合は、この型から SDK 型へキャストして使う。
 * 仕様: https://developers.line.biz/ja/reference/messaging-api/#webhook-event-objects
 */

export interface LineWebhookSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineDeliveryContext {
  /** true のとき LINE 側の再送。処理済みなら必ずスキップする */
  isRedelivery: boolean;
}

export interface LineWebhookEventBase {
  type: string;
  /** イベントの一意 ID。冪等性チェックのキー */
  webhookEventId: string;
  /** イベント発生時刻(UNIX ミリ秒) */
  timestamp: number;
  source?: LineWebhookSource;
  replyToken?: string;
  mode: 'active' | 'standby';
  deliveryContext?: LineDeliveryContext;
}

export type LineMessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker';

export interface LineMessageContent {
  id: string;
  type: LineMessageType;
  /** type === 'text' のとき */
  text?: string;
  /** 画像・動画・音声など */
  contentProvider?: { type: 'line' | 'external'; originalContentUrl?: string; previewImageUrl?: string };
  /** その他のフィールドは用途に応じてアプリ側で解釈する */
  [key: string]: unknown;
}

export interface LineMessageEvent extends LineWebhookEventBase {
  type: 'message';
  replyToken: string;
  message: LineMessageContent;
}

export interface LinePostbackEvent extends LineWebhookEventBase {
  type: 'postback';
  replyToken: string;
  postback: {
    data: string;
    params?: Record<string, string>;
  };
}

export interface LineFollowEvent extends LineWebhookEventBase {
  type: 'follow';
  replyToken: string;
  follow?: { isUnblocked: boolean };
}

export interface LineUnfollowEvent extends LineWebhookEventBase {
  type: 'unfollow';
}

export interface LineJoinEvent extends LineWebhookEventBase {
  type: 'join';
  replyToken: string;
}

export interface LineLeaveEvent extends LineWebhookEventBase {
  type: 'leave';
}

export interface LineAccountLinkEvent extends LineWebhookEventBase {
  type: 'accountLink';
  replyToken: string;
  link: { result: 'ok' | 'failed'; nonce: string };
}

/** 上記以外(memberJoined / memberLeft / beacon / unsend / videoPlayComplete / things など) */
export interface LineOtherEvent extends LineWebhookEventBase {
  [key: string]: unknown;
}

export type LineWebhookEvent =
  | LineMessageEvent
  | LinePostbackEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LineJoinEvent
  | LineLeaveEvent
  | LineAccountLinkEvent
  | LineOtherEvent;

export interface LineWebhookBody {
  /** Webhook を受信したボットのユーザー ID */
  destination: string;
  events: LineWebhookEvent[];
}

/** ロガーの最小インターフェース(console 互換) */
export interface Logger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  debug: (message, meta) => console.debug(message, meta ?? ''),
  info: (message, meta) => console.info(message, meta ?? ''),
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function isMessageEvent(event: LineWebhookEvent): event is LineMessageEvent {
  return event.type === 'message';
}

export function isPostbackEvent(event: LineWebhookEvent): event is LinePostbackEvent {
  return event.type === 'postback';
}

export function isTextMessageEvent(
  event: LineWebhookEvent,
): event is LineMessageEvent & { message: { type: 'text'; text: string } } {
  return isMessageEvent(event) && event.message.type === 'text' && typeof event.message.text === 'string';
}
