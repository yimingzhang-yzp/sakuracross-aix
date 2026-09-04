import { beforeEach, describe, expect, it } from 'vitest';

import { GET } from '../app/api/health/route';

describe('GET /api/health (ai-boss)', () => {
  beforeEach(() => {
    // 実キー・実 DB なしで通ることを保証する
    delete process.env.DATABASE_URL;
  });

  it('DB 未設定でも 200 を返し、営業日と TZ を含む', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toMatchObject({
      status: 'ok',
      app: 'ai-boss',
      timezone: 'Asia/Tokyo',
      db: { status: 'skipped' },
    });
    expect(json.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof json.timestamp).toBe('string');
  });
});
