import { describe, expect, it } from 'vitest';

import {
  POSTBACK_DATA_MAX_LENGTH,
  POSTBACK_PREFIX,
  buildPostbackData,
  expandRouteTarget,
  parsePostbackData,
  routeEvent,
} from './routing.js';
import { imageEvent, postbackEvent, simpleEvent, textEvent } from './test-utils.js';

describe('routeEvent: Postback のプレフィックス振分け', () => {
  it('shift: → シフト給与', () => {
    const decision = routeEvent(postbackEvent('shift:apply_open_shift?id=os-1'));
    expect(decision.target).toBe('shift');
    expect(decision.postback).toMatchObject({
      namespace: 'shift',
      action: 'apply_open_shift',
      params: { id: 'os-1' },
    });
  });

  it('ai: → AI上司', () => {
    const decision = routeEvent(postbackEvent('ai:quiz_answer?quizId=q-1&idx=2'));
    expect(decision.target).toBe('ai');
    expect(decision.postback).toMatchObject({
      namespace: 'ai',
      action: 'quiz_answer',
      params: { quizId: 'q-1', idx: '2' },
    });
  });

  it('未知のプレフィックス / プレフィックス無しは ignore', () => {
    expect(routeEvent(postbackEvent('invoice:mark_paid?id=1')).target).toBe('ignore');
    expect(routeEvent(postbackEvent('apply')).target).toBe('ignore');
    expect(routeEvent(postbackEvent('')).target).toBe('ignore');
  });

  it('プレフィックスは前方一致のみ(途中に含まれても対象外)', () => {
    expect(routeEvent(postbackEvent('x-shift:apply')).target).toBe('ignore');
    expect(routeEvent(postbackEvent('SHIFT:apply')).target).toBe('ignore');
  });
});

describe('routeEvent: メッセージ・その他イベント', () => {
  it('フリーテキストは AI上司へ', () => {
    expect(routeEvent(textEvent('ドリンクチケットの扱いは?')).target).toBe('ai');
  });

  it('画像も AI上司へ', () => {
    expect(routeEvent(imageEvent()).target).toBe('ai');
  });

  it('スタンプ・位置情報などその他メッセージも AI上司へ', () => {
    const sticker = textEvent('');
    sticker.message = { id: 'm', type: 'sticker', packageId: '1', stickerId: '2' };
    expect(routeEvent(sticker).target).toBe('ai');
  });

  it('follow / unfollow は両システムへ', () => {
    expect(routeEvent(simpleEvent('follow')).target).toBe('both');
    expect(routeEvent(simpleEvent('unfollow')).target).toBe('both');
  });

  it('accountLink はシフト側へ', () => {
    expect(routeEvent(simpleEvent('accountLink')).target).toBe('shift');
  });

  it('join / leave / beacon / memberJoined などは ignore', () => {
    for (const type of ['join', 'leave', 'beacon', 'memberJoined', 'memberLeft', 'unsend', 'things']) {
      expect(routeEvent(simpleEvent(type)).target).toBe('ignore');
    }
  });

  it('判定理由が付く', () => {
    expect(routeEvent(textEvent('a')).reason).toContain('AI上司');
    expect(routeEvent(postbackEvent('shift:x')).reason).toContain('shift:');
  });
});

describe('parsePostbackData', () => {
  it('クエリ無し', () => {
    expect(parsePostbackData('shift:confirm')).toEqual({
      namespace: 'shift',
      action: 'confirm',
      params: {},
      raw: 'shift:confirm',
    });
  });

  it('URL エンコードされた日本語を復元する', () => {
    const parsed = parsePostbackData('ai:feedback?comment=%E5%88%86%E3%81%8B%E3%82%8A%E3%82%84%E3%81%99%E3%81%84');
    expect(parsed.params.comment).toBe('分かりやすい');
  });

  it('? だけでパラメータが無い', () => {
    expect(parsePostbackData('shift:x?').params).toEqual({});
  });

  it('プレフィックス無しは namespace null で action に全体', () => {
    expect(parsePostbackData('legacy_action?x=1')).toMatchObject({ namespace: null, action: 'legacy_action' });
  });
});

describe('buildPostbackData', () => {
  it('parsePostbackData と往復できる', () => {
    const data = buildPostbackData('shift', 'apply_open_shift', { id: 'os-1', slot: 2, confirm: true });
    expect(data.startsWith(POSTBACK_PREFIX.shift)).toBe(true);
    expect(parsePostbackData(data)).toMatchObject({
      namespace: 'shift',
      action: 'apply_open_shift',
      params: { id: 'os-1', slot: '2', confirm: 'true' },
    });
  });

  it('日本語パラメータもエンコードして往復できる', () => {
    const data = buildPostbackData('ai', 'feedback', { comment: '分かりやすい' });
    expect(parsePostbackData(data).params.comment).toBe('分かりやすい');
  });

  it('action に : や ? は使えない', () => {
    expect(() => buildPostbackData('shift', 'a:b')).toThrow(TypeError);
    expect(() => buildPostbackData('shift', 'a?b')).toThrow(TypeError);
    expect(() => buildPostbackData('shift', '')).toThrow(TypeError);
  });

  it('300 文字を超えると RangeError', () => {
    expect(() => buildPostbackData('shift', 'x', { long: 'a'.repeat(POSTBACK_DATA_MAX_LENGTH) })).toThrow(
      RangeError,
    );
  });
});

describe('expandRouteTarget', () => {
  it('both は shift と ai、ignore は空', () => {
    expect(expandRouteTarget('both')).toEqual(['shift', 'ai']);
    expect(expandRouteTarget('ignore')).toEqual([]);
    expect(expandRouteTarget('shift')).toEqual(['shift']);
    expect(expandRouteTarget('ai')).toEqual(['ai']);
  });
});
