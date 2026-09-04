import type { LineMessageEvent, LinePostbackEvent, LineWebhookEvent } from './types.js';

let counter = 0;

export function nextEventId(prefix = 'evt'): string {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(4, '0')}`;
}

export function textEvent(text: string, overrides: Partial<LineMessageEvent> = {}): LineMessageEvent {
  return {
    type: 'message',
    webhookEventId: nextEventId(),
    timestamp: Date.now(),
    mode: 'active',
    replyToken: 'reply-token',
    source: { type: 'user', userId: 'U-test' },
    deliveryContext: { isRedelivery: false },
    message: { id: 'msg-1', type: 'text', text },
    ...overrides,
  };
}

export function imageEvent(): LineMessageEvent {
  return {
    ...textEvent(''),
    message: { id: 'msg-img', type: 'image', contentProvider: { type: 'line' } },
  };
}

export function postbackEvent(data: string, overrides: Partial<LinePostbackEvent> = {}): LinePostbackEvent {
  return {
    type: 'postback',
    webhookEventId: nextEventId(),
    timestamp: Date.now(),
    mode: 'active',
    replyToken: 'reply-token',
    source: { type: 'user', userId: 'U-test' },
    deliveryContext: { isRedelivery: false },
    postback: { data },
    ...overrides,
  };
}

export function simpleEvent(type: string): LineWebhookEvent {
  return {
    type,
    webhookEventId: nextEventId(),
    timestamp: Date.now(),
    mode: 'active',
    replyToken: 'reply-token',
    source: { type: 'user', userId: 'U-test' },
  } as LineWebhookEvent;
}

export function webhookBody(events: LineWebhookEvent[], destination = 'Ubot'): string {
  return JSON.stringify({ destination, events });
}
