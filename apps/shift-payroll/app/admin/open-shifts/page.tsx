import Link from 'next/link';

import { db } from '@/lib/db';
import { bd, businessDateLabel, timeRange } from '@/lib/format';
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/scheduling/types';

import { approveApplicationAction, closeOpenShiftAction } from './actions';

export default async function OpenShiftsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; all?: string }> }) {
  const params = await searchParams;
  const list = await db().openShiftRequest.findMany({
    where: params.all ? undefined : { status: 'OPEN' },
    include: { businessDay: true, filledBy: true, applications: { include: { staff: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: [{ status: 'asc' }, { start: 'asc' }],
    take: 100,
  });

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>欠員募集</h1>
        <Link href={params.all ? '/admin/open-shifts' : '/admin/open-shifts?all=1'} className="btn sm">
          {params.all ? '募集中のみ表示' : '過去分も表示'}
        </Link>
      </div>
      <p className="muted small">
        募集の発行はシフト期間画面の不足セル「募集をかける」、または確定チップの「欠勤」から行います。先着方式では最初に応募した 1 名が自動確定し、店長承認方式ではここで応募者を選びます。
      </p>
      {params.error ? <div className="alert error">{params.error}</div> : null}
      {params.ok ? <div className="alert success">{params.ok}</div> : null}

      {list.length === 0 ? (
        <div className="card muted">募集はありません。</div>
      ) : (
        list.map((os) => {
          const date = bd(os.businessDay.businessDate);
          return (
            <div className="card" key={os.id}>
              <div className="toolbar">
                <strong>
                  {businessDateLabel(date, true)} {timeRange(os.start, os.end)} {STAFF_ROLE_LABELS[os.roleNeeded as StaffRole]}
                </strong>
                <span className={`badge ${os.status === 'OPEN' ? 'warn' : os.status === 'FILLED' ? 'ok' : ''}`}>
                  {os.status === 'OPEN' ? '募集中' : os.status === 'FILLED' ? '確定' : '終了'}
                </span>
                <span className="badge">{os.mode === 'FIRST_COME' ? '先着' : '店長承認'}</span>
                <span className="muted small">
                  理由: {os.reason} / 配信 {os.notifiedStaffIds.length} 名 / {os.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                </span>
                <span className="spacer" />
                {os.status === 'OPEN' ? (
                  <form action={closeOpenShiftAction}>
                    <input type="hidden" name="id" value={os.id} />
                    <button type="submit" className="btn danger sm">
                      募集を締める
                    </button>
                  </form>
                ) : null}
              </div>
              {os.filledBy ? (
                <p>
                  確定: <strong>{os.filledBy.name}</strong>
                </p>
              ) : null}
              <table className="data">
                <thead>
                  <tr>
                    <th>応募者</th>
                    <th>応募日時</th>
                    <th>状態</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {os.applications.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        応募はまだありません
                      </td>
                    </tr>
                  ) : (
                    os.applications.map((a) => (
                      <tr key={a.id}>
                        <td>{a.staff.name}</td>
                        <td className="small">{a.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                        <td>
                          <span className={`badge ${a.status === 'WON' ? 'ok' : a.status === 'LOST' ? '' : 'info'}`}>
                            {a.status === 'WON' ? '確定' : a.status === 'LOST' ? '落選' : '応募中'}
                          </span>
                        </td>
                        <td>
                          {os.status === 'OPEN' && os.mode === 'MANAGER_APPROVAL' ? (
                            <form action={approveApplicationAction}>
                              <input type="hidden" name="id" value={os.id} />
                              <input type="hidden" name="staffId" value={a.staffId} />
                              <button type="submit" className="btn primary sm">
                                この人で確定
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </>
  );
}
