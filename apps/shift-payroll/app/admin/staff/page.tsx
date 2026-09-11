import Link from 'next/link';

import { db, loadSettings } from '@/lib/db';
import { EMPLOYMENT_LABELS, yen } from '@/lib/format';
import { TAX_TABLE_LABELS, TAX_TABLE_TYPES } from '@/lib/payroll/deductions';
import { isNewcomer } from '@/lib/scheduling/generate';
import { STAFF_ROLE_LABELS, STAFF_ROLES, type StaffRole } from '@/lib/scheduling/types';
import { suggestStaffMatch } from '@/lib/staff/match';
import { ageOf, isMinorNow, todayInTokyo } from '@/lib/staff/minor';

import { createStaffAction, rejectRegistrationAction } from './actions';
import { RegistrationApprovalForm, type RegistrationCandidate } from './registration-form';

export default async function StaffListPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const prisma = db();
  const [staffList, registrations, settings, params] = await Promise.all([
    prisma.staff.findMany({ orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }] }),
    prisma.lineRegistrationRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
    loadSettings(),
    searchParams,
  ]);
  const now = new Date();

  // 紐付け先の候補は「在籍中かつ LINE 未連携」のスタッフ。氏名が一意に一致すれば既定で選択しておく
  const candidates: RegistrationCandidate[] = staffList
    .filter((s) => s.isActive && !s.lineUserId)
    .map((s) => ({ id: s.id, name: s.name, role: s.role as StaffRole, roleLabel: STAFF_ROLE_LABELS[s.role as StaffRole] }));
  const candidateSource = staffList.filter((s) => s.isActive && !s.lineUserId).map((s) => ({ id: s.id, name: s.name, nameKana: s.nameKana }));

  return (
    <>
      <h1>スタッフ</h1>
      {params.error ? <div className="alert error">{params.error}</div> : null}
      {params.ok ? <div className="alert success">{params.ok}</div> : null}

      <div className="card" id="registrations">
        <h2>LINE 登録の承認待ち({registrations.length})</h2>
        {registrations.length === 0 ? (
          <p className="muted">承認待ちはありません。スタッフが LINE の LIFF から氏名を登録するとここに表示されます。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>申請内容</th>
                <th>承認する</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => {
                const suggested = suggestStaffMatch(r, candidateSource);
                return (
                  <tr key={r.id}>
                    <td style={{ verticalAlign: 'top' }}>
                      <strong>{r.nameInput}</strong>
                      {r.nameKanaInput ? <span className="muted small"> ({r.nameKanaInput})</span> : null}
                      <div className="muted small">LINE 表示名: {r.displayName ?? '—'}</div>
                      <div className="muted small">{r.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</div>
                      {suggested ? <span className="badge info">氏名一致で自動選択</span> : null}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <RegistrationApprovalForm requestId={r.id} nameInput={r.nameInput} candidates={candidates} suggestedStaffId={suggested} />
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <form action={rejectRegistrationAction}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <button type="submit" className="btn danger sm">
                          却下
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>スタッフ一覧({staffList.filter((s) => s.isActive).length} 名在籍)</h2>
        <table className="data">
          <thead>
            <tr>
              <th>氏名</th>
              <th>職種</th>
              <th>雇用</th>
              <th className="num">時給 / 月給</th>
              <th>属性</th>
              <th>LINE</th>
              <th>入店</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staffList.map((s) => (
              <tr key={s.id} style={s.isActive ? undefined : { opacity: 0.5 }}>
                <td>
                  <Link href={`/admin/staff/${s.id}`}>{s.name}</Link>
                  {s.nameKana ? <div className="muted small">{s.nameKana}</div> : null}
                </td>
                <td>
                  {STAFF_ROLE_LABELS[s.role]}
                  {skillsOf(s.skills).length > 0 ? (
                    <div className="muted small">兼務: {skillsOf(s.skills).map((k) => STAFF_ROLE_LABELS[k as keyof typeof STAFF_ROLE_LABELS] ?? k).join('・')}</div>
                  ) : null}
                </td>
                <td>{EMPLOYMENT_LABELS[s.employmentType]}</td>
                <td className="num">{s.monthlySalary ? `${yen(s.monthlySalary)}/月` : yen(s.hourlyWage)}</td>
                <td>
                  {isMinorNow(s, now) ? <span className="badge danger">未成年{ageOf(s.birthDate, now) !== null ? ` ${ageOf(s.birthDate, now)}歳` : ''}</span> : null}{' '}
                  {isNewcomer(s, now, settings.newcomerMonths) ? <span className="badge warn">新人</span> : null}{' '}
                  {s.accessRole === 'ADMIN' ? <span className="badge info">管理者</span> : null}{' '}
                  {!s.isActive ? <span className="badge">退職/停止</span> : null}
                </td>
                <td>{s.lineUserId ? <span className="badge ok">連携済</span> : <span className="badge">未連携</span>}</td>
                <td>{s.hiredAt ? s.hiredAt.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'}</td>
                <td>
                  <Link href={`/admin/staff/${s.id}`} className="btn sm">
                    編集
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>スタッフを追加</h2>
        <form action={createStaffAction} className="stack">
          <div className="grid-3">
            <label className="field">
              氏名 *
              <input name="name" required />
            </label>
            <label className="field">
              フリガナ
              <input name="nameKana" />
            </label>
            <label className="field">
              採用職種 *
              <select name="role" defaultValue="" required>
                <option value="" disabled>
                  選択してください
                </option>
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {STAFF_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              雇用形態 *
              <select name="employmentType" defaultValue="PART_TIME">
                <option value="PART_TIME">アルバイト</option>
                <option value="FULL_TIME">社員</option>
                <option value="CONTRACT">契約</option>
              </select>
            </label>
            <label className="field">
              時給(円)
              <input name="hourlyWage" type="number" min={0} defaultValue={settings.defaultHourlyWage} />
            </label>
            <label className="field">
              月給(円、社員のみ)
              <input name="monthlySalary" type="number" min={0} />
            </label>
            <label className="field">
              生年月日 *
              <input name="birthDate" type="date" required max={todayInTokyo()} />
              <span className="muted small">18 歳未満かどうかは、この生年月日から自動で判定します(22 時以降のシフト不可)</span>
            </label>
            <label className="field">
              入店日
              <input name="hiredAt" type="date" />
            </label>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            法定控除(給与計算)— 加入状況は追加後にスタッフ詳細で変更できます
          </div>
          <div className="grid-3">
            <label className="field">
              源泉所得税の区分
              <select name="taxTableType" defaultValue="KOU">
                {TAX_TABLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TAX_TABLE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              扶養親族等の数(甲欄)
              <input name="dependentsCount" type="number" min={0} defaultValue={0} />
            </label>
            <label className="field">
              <span>
                <input type="checkbox" name="socialInsuranceEnrolled" value="1" /> 健康保険・厚生年金に加入
              </span>
              <span>
                <input type="checkbox" name="employmentInsuranceEnrolled" value="1" /> 雇用保険に加入
              </span>
            </label>
          </div>
          <div>
            <button type="submit" className="btn primary">
              追加
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function skillsOf(skills: unknown): string[] {
  if (!skills || typeof skills !== 'object') return [];
  return Object.entries(skills as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k.toUpperCase());
}
