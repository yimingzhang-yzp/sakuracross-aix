import { describe, expect, it } from 'vitest';

import { LINE_ENV_KEYS, getLineChannelEnv } from './env.js';

describe('getLineChannelEnv', () => {
  it('スタッフ/管理それぞれの環境変数名を参照する', () => {
    expect(LINE_ENV_KEYS.staff.secret).toBe('LINE_STAFF_CHANNEL_SECRET');
    expect(LINE_ENV_KEYS.admin.accessToken).toBe('LINE_ADMIN_CHANNEL_ACCESS_TOKEN');
  });

  it('両方揃えば configured=true', () => {
    const env = getLineChannelEnv('staff', {
      LINE_STAFF_CHANNEL_SECRET: 'sec',
      LINE_STAFF_CHANNEL_ACCESS_TOKEN: 'tok',
    });
    expect(env).toEqual({ kind: 'staff', channelSecret: 'sec', channelAccessToken: 'tok', configured: true });
  });

  it('片方だけ、または空白のみなら configured=false', () => {
    expect(getLineChannelEnv('admin', { LINE_ADMIN_CHANNEL_SECRET: 'sec' }).configured).toBe(false);
    expect(
      getLineChannelEnv('admin', { LINE_ADMIN_CHANNEL_SECRET: ' ', LINE_ADMIN_CHANNEL_ACCESS_TOKEN: 'tok' })
        .configured,
    ).toBe(false);
  });

  it('スタッフと管理の変数は混ざらない', () => {
    const env = getLineChannelEnv('admin', {
      LINE_STAFF_CHANNEL_SECRET: 'sec',
      LINE_STAFF_CHANNEL_ACCESS_TOKEN: 'tok',
    });
    expect(env.configured).toBe(false);
    expect(env.channelSecret).toBeUndefined();
  });

  it('前後の空白は除去される', () => {
    const env = getLineChannelEnv('staff', {
      LINE_STAFF_CHANNEL_SECRET: ' sec ',
      LINE_STAFF_CHANNEL_ACCESS_TOKEN: 'tok\n',
    });
    expect(env.channelSecret).toBe('sec');
    expect(env.channelAccessToken).toBe('tok');
  });
});
