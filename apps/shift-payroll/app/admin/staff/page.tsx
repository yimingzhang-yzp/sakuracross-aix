import Link from 'next/link';

import { db, loadSettings } from '@/lib/db';
import { EMPLOYMENT_LABELS, yen } from '@/lib/format';
import { isNewcomer } from '@/lib/scheduling/generate';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@/lib/scheduling/types';

import { approveRegistrationAction, createStaffAction, rejectRegistrationAction } from './actions';

export default async function StaffListPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const prisma = db();
  const [staffList, registrations, settings, params] = await Promise.all([
    prisma.staff.findMany({ orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }] }),
    prisma.lineRegistrationRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
    loadSettings(),
    searchParams,
  ]);
  const now = new Date();

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
                <th>申請日時</th>
                <th>入力された氏名</th>
                <th>LINE 表示名</th>
                <th>紐付け先</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => (
                <tr key={r.id}>
                  <td>{r.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                  <td>
                    {r.nameInput}
                    {r.nameKanaInput ? <span className="muted small"> ({r.nameKanaInput})</span> : null}
                  </td>
                  <td>{r.displayName ?? '—'}</td>
                  <td>
                    <form action={approveRegistrationAction} className="inline">
                      <input type="hidden" name="requestId" value={r.id} />
                      <select name="staffId" defaultValue="">
                        <option value="">新規スタッフとして作成</option>
                        {staffList
                          .filter((s) => !s.lineUserId)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              既存: {s.name}({STAFF_ROLE_LABELS[s.role]})
                            </option>
                          ))}
                      </select>
                      <select name="role" defaultValue="RECEPTION" title="新規作成時の職種">
                        {STAFF_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {STAFF_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn primary sm">
                        承認
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={rejectRegistrationAction}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <button type="submit" className="btn danger sm">
                        却下
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
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
                  {s.isMinor ? <span className="badge danger">未成年</span> : null}{' '}
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
              職種 *
              <select name="role" defaultValue="RECEPTION">
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
              入店日
              <input name="hiredAt" type="date" />
            </label>
            <label className="field">
              <span>
                <input type="checkbox" name="isMinor" value="1" /> 18 歳未満(22 時以降のシフト不可)
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
