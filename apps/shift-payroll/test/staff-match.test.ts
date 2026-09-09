import { describe, expect, it } from 'vitest';

import { nameKey, suggestStaffMatch } from '../lib/staff/match';

const candidates = [
  { id: 'yabuki', name: '矢吹 成叶', nameKana: 'ヤブキ ナルト' },
  { id: 'kusano', name: '草野 諒', nameKana: 'クサノ リョウ' },
  { id: 'nitta', name: '新田 義矩', nameKana: 'ニッタヨシノリ' },
];

describe('nameKey(表記ゆれの吸収)', () => {
  it('空白(半角・全角)を無視する', () => {
    expect(nameKey('草野 諒')).toBe(nameKey('草野諒'));
    expect(nameKey('草野　諒')).toBe(nameKey('草野諒'));
  });

  it('全角英数は半角に揃える', () => {
    expect(nameKey('ＡＢＣ')).toBe('abc');
  });

  it('null / 空文字は空キー', () => {
    expect(nameKey(null)).toBe('');
    expect(nameKey('   ')).toBe('');
  });
});

describe('suggestStaffMatch', () => {
  it('入力氏名が空白違いで一致すれば提案する', () => {
    expect(suggestStaffMatch({ nameInput: '草野諒', nameKanaInput: 'くさの' }, candidates)).toBe('kusano');
  });

  it('入力氏名が下の名前だけでも、LINE 表示名で一致すれば提案する', () => {
    expect(suggestStaffMatch({ nameInput: 'なると', displayName: '矢吹 成叶' }, candidates)).toBe('yabuki');
  });

  it('フリガナでも一致する', () => {
    expect(suggestStaffMatch({ nameInput: '不明', nameKanaInput: 'ニッタ ヨシノリ' }, candidates)).toBe('nitta');
  });

  it('一致しなければ提案しない(新規作成を既定にする)', () => {
    expect(suggestStaffMatch({ nameInput: '山田 太郎', displayName: 'Taro' }, candidates)).toBeNull();
  });

  it('同姓同名が複数いる場合は提案しない(店長が選ぶ)', () => {
    const dup = [
      { id: 'a', name: '田中 玲奈', nameKana: 'タナカ レナ' },
      { id: 'b', name: '田中玲奈', nameKana: null },
    ];
    expect(suggestStaffMatch({ nameInput: '田中 玲奈' }, dup)).toBeNull();
  });

  it('候補が空なら提案しない', () => {
    expect(suggestStaffMatch({ nameInput: '草野諒' }, [])).toBeNull();
  });

  it('フリガナ未登録の候補を空キー同士で誤一致させない', () => {
    const noKana = [{ id: 'x', name: '佐藤 花', nameKana: null }];
    expect(suggestStaffMatch({ nameInput: '', nameKanaInput: '' }, noKana)).toBeNull();
  });
});
