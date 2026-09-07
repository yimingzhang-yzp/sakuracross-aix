import { addBusinessDays, businessDateToDbValue, isBusinessDateString, toBusinessDate } from '@sakura-cross/business-date';
import Link from 'next/link';

import { db, finalizedPeriods, loadSettings } from '@/lib/db';
import { bd, businessDateLabel, hhmm, minutesToHours, yen } from '@/lib/format';
import { findLockingRun } from '@/lib/payroll/compute';
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/scheduling/types';

import {
  addAdvancePaymentAction,
  approveAllMonthAction,
  approveTimeRecordAction,
  resolveCorrectionAction,
  upsertTimeRecordAction,
} from './actions';

// LINE 配信や一括処理を含むため、既定(15秒)より長い上限を設定する
export const maxDuration = 60;

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string; error?: string; ok?: string }>;
}) {
  const params = await searchParams;
  const date = params.date && isBusinessDateString(params.date) ? params.date : toBusinessDate(new Date());
  const prisma = db();
  const dbDate = businessDateToDbValue(date);

  const [day, records, staffList, corrections, advances, locked, settings] = await Promise.all([
    prisma.businessDay.findUnique({
      where: { businessDate: dbDate },
      include: { shiftAssignments: { where: { status: { in: ['CONFIRMED', 'ABSENT'] } }, include: { staff: true } } },
    }),
    prisma.timeRecord.findMany({ where: { businessDate: dbDate }, include: { staff: true } }),
    prisma.staff.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.timeRecordCorrectionRequest.findMany({ where: { status: 'PENDING' }, include: { staff: true }, orderBy: { createdAt: 'asc' } }),
    prisma.advancePayment.findMany({ where: { businessDate: dbDate }, include: { staff: true }, orderBy: { createdAt: 'desc' } }),
    finalizedPeriods(),
    loadSettings(),
  ]);
  const lockingRun = findLockingRun(locked, date);
  const recordByStaff = new Map(records.map((r) => [r.staffId, r]));
  const assignmentByStaff = new Map((day?.shiftAssignments ?? []).map((a) => [a.staffId, a]));
  const staffIds = new Set([...records.map((r) => r.staffId), ...(day?.shiftAssignments ?? []).map((a) => a.staffId)]);
  const rows = staffList.filter((s) => staffIds.has(s.id));
  const monthPrefix = date.slice(0, 7);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>勤怠管理 {businessDateLabel(date, true)}</h1>
        <Link href={`/admin/attendance?date=${addBusinessDays(date, -1)}`} className="btn sm">
          ← 前日
        </Link>
        <Link href={`/admin/attendance?date=${addBusinessDays(date, 1)}`} className="btn sm">
          翌日 →
        </Link>
        <form method="get" className="inline">
          <input type="date" name="date" defaultValue={date} />
          <button type="submit" className="btn sm">
            表示
          </button>
        </form>
        <span className="spacer" />
        <form action={approveAllMonthAction}>
          <input type="hidden" name="month" value={monthPrefix} />
          <button type="submit" className="btn">
            {monthPrefix} の打刻を一括承認
          </button>
        </form>
      </div>
      {params.error ? <div className="alert error">{params.error}</div> : null}
      {params.ok ? <div className="alert success">{params.ok}</div> : null}
      {lockingRun ? <div className="alert warn">この営業日は確定済みの給与期間に含まれるため、打刻・日払いの編集はブロックされます(給与計算で「再計算」してください)。</div> : null}

      <div className="card">
        <h2>打刻一覧</h2>
        <p className="muted small">予定と 15 分以上ずれている打刻は黄色で表示。承認済みの打刻だけが給与計算の対象になります。休憩 0 分は自動控除ルールが適用されます({settings.autoBreakEnabled ? '有効' : '無効'})。</p>
        <table className="data">
          <thead>
            <tr>
              <th>スタッフ</th>
              <th>予定</th>
              <th>出勤</th>
              <th>退勤</th>
              <th className="num">休憩(分)</th>
              <th className="num">労働</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  この営業日の予定・打刻はありません
                </td>
              </tr>
            ) : (
              rows.map((s) => {
                const rec = recordByStaff.get(s.id);
                const asg = assignmentByStaff.get(s.id);
                const devIn = rec?.clockIn && asg ? Math.abs(rec.clockIn.getTime() - asg.plannedStart.getTime()) / 60000 : 0;
                const devOut = rec?.clockOut && asg ? Math.abs(rec.clockOut.getTime() - asg.plannedEnd.getTime()) / 60000 : 0;
                const worked = rec?.clockIn && rec.clockOut ? Math.max(0, Math.floor((rec.clockOut.getTime() - rec.clockIn.getTime()) / 60000) - rec.breakMinutes) : null;
                const highlight = devIn >= 15 || devOut >= 15;
                return (
                  <tr key={s.id} style={highlight ? { background: 'var(--warn-bg)' } : undefined}>
                    <td>
                      {s.name}
                      <div className="muted small">{STAFF_ROLE_LABELS[s.role as StaffRole]}</div>
                    </td>
                    <td className="small">
                      {asg ? (
                        <>
                          {hhmm(asg.plannedStart)}〜{hhmm(asg.plannedEnd)}
                          {asg.status === 'ABSENT' ? <span className="badge danger">欠勤</span> : null}
                        </>
                      ) : (
                        <span className="muted">予定なし</span>
                      )}
                    </td>
                    <td colSpan={3}>
                      <form action={upsertTimeRecordAction} className="inline">
                        <input type="hidden" name="staffId" value={s.id} />
                        <input type="hidden" name="date" value={date} />
                        <input type="time" name="clockIn" defaultValue={rec?.clockIn ? hhmm(rec.clockIn) : ''} disabled={Boolean(lockingRun)} />
                        <input type="time" name="clockOut" defaultValue={rec?.clockOut ? hhmm(rec.clockOut) : ''} disabled={Boolean(lockingRun)} />
                        <input type="number" name="breakMinutes" min={0} defaultValue={rec?.breakMinutes ?? 0} style={{ width: 70 }} disabled={Boolean(lockingRun)} />
                        <button type="submit" className="btn sm" disabled={Boolean(lockingRun)}>
                          保存
                        </button>
                      </form>
                      <div className="muted small">出勤 / 退勤(翌日の時刻は 10:00 より前として入力)/ 休憩</div>
                    </td>
                    <td className="num">{worked !== null ? minutesToHours(worked) : '—'}</td>
                    <td>
                      {rec ? (
                        rec.approved ? (
                          <span className="badge ok">承認済</span>
                        ) : (
                          <span className="badge warn">未承認</span>
                        )
                      ) : (
                        <span className="badge">未打刻</span>
                      )}
                      {rec?.editedByAdmin ? <div className="muted small">管理者修正</div> : null}
                    </td>
                    <td>
                      {rec && !rec.approved ? (
                        <form action={approveTimeRecordAction}>
                          <input type="hidden" name="id" value={rec.id} />
                          <input type="hidden" name="date" value={date} />
                          <button type="submit" className="btn primary sm" disabled={Boolean(lockingRun)}>
                            承認
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>日払い・前払い({businessDateLabel(date)})</h2>
        <form action={addAdvancePaymentAction} className="inline" style={{ marginBottom: 12 }}>
          <input type="hidden" name="date" value={date} />
          <label className="field">
            スタッフ
            <select name="staffId" required>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            金額(円)
            <input name="amount" type="number" min={1} step={1} required defaultValue={5000} />
          </label>
          <label className="field">
            メモ
            <input name="memo" placeholder="任意" />
          </label>
          <button type="submit" className="btn primary" disabled={Boolean(lockingRun)}>
            登録
          </button>
        </form>
        {advances.length === 0 ? (
          <p className="muted">この営業日の日払いはありません。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>スタッフ</th>
                <th className="num">金額</th>
                <th>渡した人</th>
                <th>メモ</th>
                <th>登録日時</th>
              </tr>
            </thead>
            <tbody>
              {advances.map((a) => (
                <tr key={a.id}>
                  <td>{a.staff.name}</td>
                  <td className="num">{yen(a.amount)}</td>
                  <td>{a.paidBy}</td>
                  <td>{a.memo}</td>
                  <td className="small">{a.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" id="corrections">
        <h2>打刻修正申請(承認待ち {corrections.length})</h2>
        {corrections.length === 0 ? (
          <p className="muted">承認待ちの申請はありません。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>申請日時</th>
                <th>スタッフ</th>
                <th>営業日</th>
                <th>申請内容</th>
                <th>理由</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id}>
                  <td className="small">{c.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                  <td>{c.staff.name}</td>
                  <td>{businessDateLabel(bd(c.businessDate))}</td>
                  <td className="small">
                    出勤 {hhmm(c.requestedClockIn)} / 退勤 {hhmm(c.requestedClockOut)} / 休憩 {c.requestedBreakMinutes ?? '—'}
                  </td>
                  <td className="small">{c.reason}</td>
                  <td>
                    {/* 判定値は hidden input で渡す。送信ボタンの name/value(submitter)は
                        Server Action の FormData に含まれないことがあるため、フォームを 2 つに分ける */}
                    <div className="inline">
                      <form action={resolveCorrectionAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="date" value={date} />
                        <input type="hidden" name="decision" value="APPROVED" />
                        <button type="submit" className="btn primary sm">
                          承認して反映
                        </button>
                      </form>
                      <form action={resolveCorrectionAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="date" value={date} />
                        <input type="hidden" name="decision" value="REJECTED" />
                        <button type="submit" className="btn danger sm">
                          却下
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
