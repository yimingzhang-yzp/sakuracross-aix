'use client';

/**
 * LINE 登録申請の承認フォーム
 *
 * 「既存スタッフに紐付ける」と「新規スタッフを作成する」は結果がまったく違うため、
 * 選択に応じて入力欄とボタン文言を切り替え、実行前に何が起きるかを画面に明示する。
 * 既存に紐付ける場合は職種を変更しないので、職種の選択欄そのものを表示しない。
 */
import { useState } from 'react';

import { STAFF_ROLE_LABELS, STAFF_ROLES, type StaffRole } from '@/lib/scheduling/types';

import { approveRegistrationAction } from './actions';

export interface RegistrationCandidate {
  id: string;
  name: string;
  role: StaffRole;
  roleLabel: string;
}

export function RegistrationApprovalForm({
  requestId,
  nameInput,
  candidates,
  suggestedStaffId,
}: {
  requestId: string;
  nameInput: string;
  candidates: RegistrationCandidate[];
  suggestedStaffId: string | null;
}) {
  const [staffId, setStaffId] = useState(suggestedStaffId ?? '');
  const selected = candidates.find((c) => c.id === staffId) ?? null;

  return (
    <form action={approveRegistrationAction} className="stack" style={{ gap: 8, maxWidth: 460 }}>
      <input type="hidden" name="requestId" value={requestId} />
      <label className="field">
        この申請を誰として登録するか
        <select name="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">新規スタッフとして作成する</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              既存スタッフ「{c.name}」に紐付ける({c.roleLabel})
            </option>
          ))}
        </select>
      </label>

      {selected ? (
        <>
          <div className="alert info small" style={{ margin: 0 }}>
            <strong>{selected.name}</strong> に LINE を紐付けます。職種は<strong>{selected.roleLabel}のまま</strong>で、時給・入店日・雇用形態も変更しません。
          </div>
          <div>
            <button type="submit" className="btn primary sm">
              {selected.name} に紐付けて承認
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="field">
            新しく作成するスタッフの職種
            <select name="role" defaultValue="RECEPTION">
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {STAFF_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <div className="alert warn small" style={{ margin: 0 }}>
            「{nameInput}」という<strong>新しいスタッフを作成</strong>します。既にスタッフ一覧にいる人の場合は、上の選択肢から本人を選んでください(選ばないと同じ人が二重に登録されます)。
          </div>
          <div>
            <button type="submit" className="btn primary sm">
              新規スタッフとして作成して承認
            </button>
          </div>
        </>
      )}
    </form>
  );
}
