/**
 * イベント振分け
 *
 * 「CROSS スタッフ」公式アカウントは 1 つの Webhook でシステム1(シフト)とシステム2(AI上司)を受ける。
 *   - Postback: data のプレフィックス `shift:` → シフト給与、`ai:` → AI上司
 *   - message(フリーテキスト・画像・その他): → AI上司
 *   - follow / unfollow: → 両方(シフト側はスタッフ紐付け、AI側はあいさつ+記録告知)
 *   - LIFF 起点の操作は Webhook を通らず各アプリの API を直接叩くため、ここでは扱わない
 */
import type { LineWebhookEvent } from './types.js';

export type RouteNamespace = 'shift' | 'ai';
export type RouteTarget = RouteNamespace | 'both' | 'ignore';

export const POSTBACK_PREFIX: Readonly<Record<RouteNamespace, string>> = {
  shift: 'shift:',
  ai: 'ai:',
};

/** LINE の postback.data 上限(文字数) */
export const POSTBACK_DATA_MAX_LENGTH = 300;

export interface RouteDecision {
  target: RouteTarget;
  /** 判定理由(ログ用) */
  reason: string;
  /** Postback の場合の解析結果 */
  postback?: ParsedPostbackData;
}

export interface ParsedPostbackData {
  namespace: RouteNamespace | null;
  /** プレフィックスと `?` 以降を除いたアクション名。例: "apply_open_shift" */
  action: string;
  /** `?` 以降のクエリ部分を URLSearchParams で解釈したもの */
  params: Record<string, string>;
  raw: string;
}

/**
 * postback.data を解析する。形式: `<namespace>:<action>?key=value&key2=value2`
 */
export function parsePostbackData(data: string): ParsedPostbackData {
  const questionIndex = data.indexOf('?');
  const head = questionIndex === -1 ? data : data.slice(0, questionIndex);
  const query = questionIndex === -1 ? '' : data.slice(questionIndex + 1);

  let namespace: RouteNamespace | null = null;
  let action = head;
  for (const ns of Object.keys(POSTBACK_PREFIX) as RouteNamespace[]) {
    const prefix = POSTBACK_PREFIX[ns];
    if (head.startsWith(prefix)) {
      namespace = ns;
      action = head.slice(prefix.length);
      break;
    }
  }

  const params: Record<string, string> = {};
  if (query) {
    for (const [key, value] of new URLSearchParams(query)) {
      params[key] = value;
    }
  }

  return { namespace, action, params, raw: data };
}

/**
 * postback.data を組み立てる。300 文字を超える場合は例外(LINE 側で拒否されるため事前に検知)。
 */
export function buildPostbackData(
  namespace: RouteNamespace,
  action: string,
  params: Record<string, string | number | boolean> = {},
): string {
  if (!action || action.includes('?') || action.includes(':')) {
    throw new TypeError(`action に使用できない文字が含まれています: ${action}`);
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  const query = search.toString();
  const data = `${POSTBACK_PREFIX[namespace]}${action}${query ? `?${query}` : ''}`;
  if (data.length > POSTBACK_DATA_MAX_LENGTH) {
    throw new RangeError(
      `postback.data が ${POSTBACK_DATA_MAX_LENGTH} 文字を超えています(${data.length} 文字)`,
    );
  }
  return data;
}

/**
 * イベントを振り分ける。副作用なし。
 */
export function routeEvent(event: LineWebhookEvent): RouteDecision {
  switch (event.type) {
    case 'postback': {
      const postback = parsePostbackData((event as { postback: { data: string } }).postback.data);
      if (postback.namespace) {
        return {
          target: postback.namespace,
          reason: `postback prefix "${POSTBACK_PREFIX[postback.namespace]}"`,
          postback,
        };
      }
      return { target: 'ignore', reason: 'postback に既知のプレフィックスがありません', postback };
    }
    case 'message': {
      const messageType = (event as { message: { type: string } }).message.type;
      return { target: 'ai', reason: `message(${messageType}) はAI上司へ` };
    }
    case 'follow':
    case 'unfollow': {
      return { target: 'both', reason: `${event.type} は両システムへ通知` };
    }
    case 'accountLink': {
      return { target: 'shift', reason: 'accountLink はスタッフ紐付け(シフト側)へ' };
    }
    default: {
      return { target: 'ignore', reason: `未対応のイベント種別: ${event.type}` };
    }
  }
}

/**
 * RouteTarget を実際に呼び出す名前空間の配列へ展開する。
 */
export function expandRouteTarget(target: RouteTarget): RouteNamespace[] {
  switch (target) {
    case 'both':
      return ['shift', 'ai'];
    case 'ignore':
      return [];
    default:
      return [target];
  }
}
