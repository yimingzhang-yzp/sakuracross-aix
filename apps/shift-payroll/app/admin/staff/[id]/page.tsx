import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { bd, businessDateLabel, EMPLOYMENT_LABELS, yen } from '@/lib/format';
import { TAX_TABLE_LABELS, TAX_TABLE_TYPES } from '@/lib/payroll/deductions';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@/lib/scheduling/types';

import { addWageHistoryAction, unlinkLineAction, updateStaffAction } from '../actions';

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const staff = await db().staff.findUnique({
    where: { id },
    include: { wageHistories: { orderBy: { effectiveFrom: 'desc' } } },
  });
  if (!staff) notFound();
  const skills = (staff.skills as Record<string, unknown> | null) ?? {};

  return (
    <>
      <h1>
        {staff.name} <span className="muted small">{EMPLOYMENT_LABELS[staff.employmentType]} / {STAFF_ROLE_LABELS[staff.role]}</span>
      </h1>
      {query.error ? <div className="alert error">{query.error}</div> : null}
      {query.ok ? <div className="alert success">{query.ok}</div> : null}

      <div className="card">
        <h2>基本情報</h2>
        <form action={updateStaffAction} className="stack">
          <input type="hidden" name="id" value={staff.id} />
          <div className="grid-3">
            <label className="field">
              氏名 *
              <input name="name" required defaultValue={staff.name} />
            </label>
            <label className="field">
              フリガナ
              <input name="nameKana" defaultValue={staff.nameKana ?? ''} />
            </label>
            <label className="field">
              職種 *
              <select name="role" defaultValue={staff.role}>
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {STAFF_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              雇用形態 *
              <select name="employmentType" defaultValue={staff.employmentType}>
                <option value="PART_TIME">アルバイト</option>
                <option value="FULL_TIME">社員</option>
                <option value="CONTRACT">契約</option>
              </select>
            </label>
            <label className="field">
              月給(円、社員のみ。空欄なら時給計算)
              <input name="monthlySalary" type="number" min={0} defaultValue={staff.monthlySalary ?? ''} />
            </label>
            <label className="field">
              入店日
              <input name="hiredAt" type="date" defaultValue={staff.hiredAt ? staff.hiredAt.toISOString().slice(0, 10) : ''} />
            </label>
            <label className="field">
              管理画面の権限
              <select name="accessRole" defaultValue={staff.accessRole}>
                <option value="STAFF">スタッフ(管理画面なし)</option>
                <option value="ADMIN">管理者(店長・経理)</option>
              </select>
            </label>
            <label className="field">
              Supabase Auth ユーザー ID(管理者ログイン用)
              <input name="authUserId" defaultValue={staff.authUserId ?? ''} placeholder="Authentication > Users の UUID" />
            </label>
            <label className="field">
              <span>
                <input type="checkbox" name="isMinor" value="1" defaultChecked={staff.isMinor} /> 18 歳未満
              </span>
              <span>
                <input type="checkbox" name="isActive" value="1" defaultChecked={staff.isActive} /> 在籍中
              </span>
            </label>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>
              法定控除(給与計算)— 社会保険料は標準報酬月額 × 料率 ÷ 2、所得税は甲欄の計算式で自動控除します
            </div>
            <div className="grid-3">
              <label className="field">
                源泉所得税の区分
                <select name="taxTableType" defaultValue={staff.taxTableType}>
                  {TAX_TABLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TAX_TABLE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                扶養親族等の数(甲欄の計算に使用)
                <input name="dependentsCount" type="number" min={0} defaultValue={staff.dependentsCount} />
              </label>
              <label className="field">
                源泉所得税の固定額(円。乙欄 88,000 円以上など税額表を手で見る場合。空欄 = 自動計算)
                <input name="fixedIncomeTax" type="number" min={0} defaultValue={staff.fixedIncomeTax ?? ''} />
              </label>
              <label className="field">
                標準報酬月額(円。空欄 = 当月総支給から等級表で推定し警告)
                <input name="standardMonthlyRemuneration" type="number" min={0} step={1000} defaultValue={staff.standardMonthlyRemuneration ?? ''} />
              </label>
              <label className="field">
                <span>
                  <input type="checkbox" name="socialInsuranceEnrolled" value="1" defaultChecked={staff.socialInsuranceEnrolled} /> 健康保険・厚生年金に加入
                </span>
                <span>
                  <input type="checkbox" name="careInsuranceApplicable" value="1" defaultChecked={staff.careInsuranceApplicable} /> 介護保険の対象(40〜64 歳)
                </span>
              </label>
              <label className="field">
                <span>
                  <input type="checkbox" name="employmentInsuranceEnrolled" value="1" defaultChecked={staff.employmentInsuranceEnrolled} /> 雇用保険に加入
                </span>
              </label>
            </div>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>
              兼務できる職種(シフト生成の候補に含める)
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {STAFF_ROLES.filter((r) => r !== staff.role).map((role) => (
                <label key={role} style={{ fontSize: 13 }}>
                  <input type="checkbox" name="skills" value={role.toLowerCase()} defaultChecked={skills[role.toLowerCase()] === true} />{' '}
                  {STAFF_ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <button type="submit" className="btn primary">
              保存
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>時給履歴</h2>
        <p className="muted small">
          給与計算は勤務日時点で有効な行を参照します。現在値: <strong>{yen(staff.hourlyWage)}</strong>(キャッシュ)。改定は履歴を追加してください。
        </p>
        <form action={addWageHistoryAction} className="inline" style={{ marginBottom: 12 }}>
          <input type="hidden" name="staffId" value={staff.id} />
          <label className="field">
            新しい時給(円)
            <input name="hourlyWage" type="number" min={0} required />
          </label>
          <label className="field">
            適用開始日(この日の勤務から)
            <input name="effectiveFrom" type="date" required />
          </label>
          <button type="submit" className="btn primary">
            改定を追加
          </button>
        </form>
        {staff.wageHistories.length === 0 ? (
          <p className="alert warn">時給履歴がありません。給与計算では Staff.hourlyWage を使い警告が出ます。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>適用開始</th>
                <th className="num">時給</th>
                <th>登録日時</th>
              </tr>
            </thead>
            <tbody>
              {staff.wageHistories.map((h) => (
                <tr key={h.id}>
                  <td>{businessDateLabel(bd(h.effectiveFrom), true)}</td>
                  <td className="num">{yen(h.hourlyWage)}</td>
                  <td>{h.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>LINE 連携</h2>
        {staff.lineUserId ? (
          <form action={unlinkLineAction} className="inline">
            <input type="hidden" name="staffId" value={staff.id} />
            <span>
              連携済み: <code>{staff.lineUserId}</code>
            </span>
            <button type="submit" className="btn danger sm">
              連携を解除
            </button>
          </form>
        ) : (
          <p className="muted">未連携。本人が LINE で友だち追加し LIFF から登録すると承認待ちに表示されます。</p>
        )}
      </div>
    </>
  );
}
