import { businessDateToDbValue, toBusinessDate } from '@sakura-cross/business-date';
import Link from 'next/link';

import { db } from '@/lib/db';
import { bd, businessDateLabel, EVENT_TYPE_LABELS } from '@/lib/format';

import { PeriodStatus } from './period-status';

export default async function DashboardPage() {
  const prisma = db();
  const today = toBusinessDate(new Date());
  const [pendingRegistrations, pendingCorrections, openShifts, periods, todayDay, failedJobs, pendingJobs] = await Promise.all([
    prisma.lineRegistrationRequest.count({ where: { status: 'PENDING' } }),
    prisma.timeRecordCorrectionRequest.count({ where: { status: 'PENDING' } }),
    prisma.openShiftRequest.count({ where: { status: 'OPEN' } }),
    prisma.shiftPeriod.findMany({ orderBy: { periodStart: 'desc' }, take: 3 }),
    prisma.businessDay.findUnique({
      where: { businessDate: businessDateToDbValue(today) },
      include: { shiftAssignments: { where: { status: { in: ['CONFIRMED', 'ABSENT'] } }, include: { staff: true } } },
    }),
    prisma.job.count({ where: { status: 'FAILED' } }),
    prisma.job.count({ where: { status: 'PENDING' } }),
  ]);

  return (
    <>
      <h1>ダッシュボード</h1>
      <div className="card-row">
        <Stat label="LINE 登録の承認待ち" value={pendingRegistrations} href="/admin/staff#registrations" />
        <Stat label="打刻修正の承認待ち" value={pendingCorrections} href="/admin/attendance?tab=corrections" />
        <Stat label="募集中の欠員" value={openShifts} href="/admin/open-shifts" />
        <Stat label="LINE 送信キュー(待機 / 失敗)" value={`${pendingJobs} / ${failedJobs}`} href="/admin/notifications" danger={failedJobs > 0} />
      </div>

      <div className="card">
        <h2>本日の営業日: {businessDateLabel(today, true)}</h2>
        {todayDay ? (
          <>
            <p className="muted small" style={{ margin: '0 0 8px' }}>
              {EVENT_TYPE_LABELS[todayDay.eventType]} {todayDay.eventName ? `/ ${todayDay.eventName}` : ''}{' '}
              {todayDay.expectedCrowd ? `/ 動員予測 ${todayDay.expectedCrowd} 人` : ''}
            </p>
            {todayDay.shiftAssignments.length === 0 ? (
              <p className="muted">確定シフトはありません。</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>スタッフ</th>
                    <th>職種</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {todayDay.shiftAssignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.staff.name}</td>
                      <td>{a.roleAssigned}</td>
                      <td>{a.status === 'ABSENT' ? <span className="badge danger">欠勤</span> : <span className="badge ok">確定</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ marginTop: 10 }}>
              <Link href={`/admin/attendance?date=${today}`} className="btn sm">
                本日の勤怠を見る
              </Link>
            </p>
          </>
        ) : (
          <p className="muted">
            本日の営業日が未登録です。<Link href="/admin/calendar">カレンダー</Link>から登録してください。
          </p>
        )}
      </div>

      <div className="card">
        <h2>シフト期間</h2>
        {periods.length === 0 ? (
          <p className="muted">
            期間がありません。<Link href="/admin/periods">シフト期間</Link>から作成してください。
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>期間</th>
                <th>希望締切</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td>
                    {businessDateLabel(bd(p.periodStart), true)} 〜 {businessDateLabel(bd(p.periodEnd))}
                  </td>
                  <td>{p.preferenceDeadline.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                  <td>
                    <PeriodStatus status={p.status} />
                  </td>
                  <td>
                    <Link href={`/admin/periods/${p.id}`} className="btn sm">
                      開く
                    </Link>
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

function Stat({ label, value, href, danger }: { label: string; value: number | string; href: string; danger?: boolean }) {
  return (
    <Link href={href} className="card" style={{ textDecoration: 'none', color: 'inherit', marginBottom: 0 }}>
      <div className="muted small">{label}</div>
      <div className="stat" style={danger ? { color: 'var(--danger)' } : undefined}>
        {value}
      </div>
    </Link>
  );
}
