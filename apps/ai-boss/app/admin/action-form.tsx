'use client';

import { type ReactNode, useActionState } from 'react';

import { type ActionState, initialActionState } from './action-state';

interface ActionFormProps {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  submitClassName?: string;
  /** 送信前に確認ダイアログを出す */
  confirmMessage?: string;
  className?: string;
  /** フォーム下部ではなく右側に並べたいとき */
  inline?: boolean;
}

/**
 * Server Action + useActionState の薄いラッパー。エラー・成功メッセージを表示し、送信中はボタンを無効化する。
 */
export function ActionForm({ action, children, submitLabel, submitClassName, confirmMessage, className, inline }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form
      action={formAction}
      className={className ?? (inline ? 'inline-form' : undefined)}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {children}
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.success ? <div className="notice notice-success">{state.success}</div> : null}
      <button type="submit" className={submitClassName ?? 'btn btn-primary'} disabled={pending}>
        {pending ? '処理中…' : submitLabel}
      </button>
    </form>
  );
}
