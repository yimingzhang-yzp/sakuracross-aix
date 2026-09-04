import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LINE_SIGNATURE_HEADER, computeLineSignature, verifyLineSignature } from './signature.js';

const secret = 'test-channel-secret';
const body = JSON.stringify({ destination: 'Ubot', events: [] });

describe('computeLineSignature', () => {
  it('LINE 仕様(HMAC-SHA256 → Base64)と一致する', () => {
    const expected = createHmac('sha256', secret).update(body).digest('base64');
    expect(computeLineSignature(body, secret)).toBe(expected);
  });

  it('空のシークレットは例外', () => {
    expect(() => computeLineSignature(body, '')).toThrow();
  });
});

describe('verifyLineSignature', () => {
  it('正しい署名を受理する', () => {
    const signature = computeLineSignature(body, secret);
    expect(verifyLineSignature(body, signature, secret)).toBe(true);
  });

  it('署名ヘッダが無ければ拒否', () => {
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, undefined, secret)).toBe(false);
    expect(verifyLineSignature(body, '', secret)).toBe(false);
  });

  it('本文が 1 文字でも改変されていれば拒否', () => {
    const signature = computeLineSignature(body, secret);
    expect(verifyLineSignature(`${body} `, signature, secret)).toBe(false);
  });

  it('別のシークレットで作った署名は拒否', () => {
    const signature = computeLineSignature(body, 'another-secret');
    expect(verifyLineSignature(body, signature, secret)).toBe(false);
  });

  it('長さの違う署名・Base64 として壊れた署名でも例外を投げず拒否', () => {
    expect(verifyLineSignature(body, 'abc', secret)).toBe(false);
    expect(verifyLineSignature(body, '!!!!', secret)).toBe(false);
  });

  it('シークレットが空なら拒否', () => {
    const signature = computeLineSignature(body, secret);
    expect(verifyLineSignature(body, signature, '')).toBe(false);
  });

  it('Uint8Array の生ボディでも検証できる', () => {
    const bytes = Buffer.from(body, 'utf8');
    const signature = computeLineSignature(bytes, secret);
    expect(verifyLineSignature(bytes, signature, secret)).toBe(true);
    expect(verifyLineSignature(body, signature, secret)).toBe(true);
  });

  it('日本語(マルチバイト)を含む本文', () => {
    const jp = JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text: '救急です' } }] });
    const signature = computeLineSignature(jp, secret);
    expect(verifyLineSignature(jp, signature, secret)).toBe(true);
  });

  it('ヘッダ名定数', () => {
    expect(LINE_SIGNATURE_HEADER).toBe('x-line-signature');
  });
});
