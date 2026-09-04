'use client';

import { useActionState, useState } from 'react';

import { type ActionState, initialActionState } from '../action-state';

interface DocFormProps {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  categories: readonly string[];
  initial?: { category: string; title: string; content: string; isActive?: boolean };
  submitLabel: string;
  showActiveToggle?: boolean;
}

/**
 * ナレッジの作成・編集フォーム(Markdown エディタ + 文字数・チャンク見込み表示)
 */
export function DocForm({ action, categories, initial, submitLabel, showActiveToggle }: DocFormProps) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [content, setContent] = useState(initial?.content ?? '');
  const headingCount = (content.match(/^#{1,4}\s/gm) ?? []).length;
  const placeholders = (content.match(/【店舗確認】/g) ?? []).length;

  return (
    <form action={formAction}>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="category">カテゴリ</label>
          <select id="category" name="category" defaultValue={initial?.category ?? ''} required>
            <option value="">選択してください</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="title">タイトル</label>
          <input id="title" className="input" name="title" defaultValue={initial?.title ?? ''} required maxLength={120} />
          <span className="hint">回答の「根拠: 『〇〇』」として表示されます。「VIPマニュアル」のように短く</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="content">本文(Markdown)</label>
        <textarea
          id="content"
          name="content"
          className="code"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'# タイトル\n\n## 手順\n\n1. …\n2. …'}
          required
        />
        <span className="hint">
          {content.length.toLocaleString()} 文字 · 見出し {headingCount} 個(見出し単位・最大 800 字でチャンク分割されます)
          {placeholders > 0 ? ` · 【店舗確認】が ${placeholders} 箇所残っています` : ''}
        </span>
      </div>
      {showActiveToggle ? (
        <div className="field">
          <label>
            <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} /> 保存後すぐに検索対象にする(オフならドラフト)
          </label>
        </div>
      ) : null}
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.success ? <div className="notice notice-success">{state.success}</div> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? '保存中…' : submitLabel}
      </button>
    </form>
  );
}
