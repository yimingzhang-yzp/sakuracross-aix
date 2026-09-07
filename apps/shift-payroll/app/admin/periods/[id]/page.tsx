import { businessDateToDbValue } from '@sakura-cross/business-date';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db, loadSettings } from '@/lib/db';
import { AVAILABILITY_LABELS, bd, businessDateLabel } from '@/lib/format';
import { isNewcomer } from '@/lib/scheduling/generate';
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/scheduling/types';

import { PeriodStatus } from '../../period-status';
import { confirmPeriodAction, generateAction } from '../actions';
import { ShiftGrid, type GridData } from './shift-grid';

// LINE 配信や一括処理を含むため、既定(15秒)より長い上限を設定する
export const maxDuration = 60;

export default async function PeriodDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const prisma = db();
  const period = await prisma.shiftPeriod.findUnique({ where: { id } });
  if (!period) notFound();
  const start = bd(period.periodStart);
  const end = bd(period.periodEnd);
  const range = { gte: businessDateToDbValue(start), lte: businessDateToDbValue(end) };

  const [days, staff, preferences, settings] = await Promise.all([
    prisma.businessDay.findMany({
      where: { businessDate: range },
      include: {
        staffingRequirements: { orderBy: [{ roleNeeded: 'asc' }, { startTime: 'asc' }] },
        shiftAssignments: { where: { status: { in: ['DRAFT', 'CONFIRMED', 'ABSENT'] } }, include: { staff: { select: { name: true } } } },
      },
      orderBy: { businessDate: 'asc' },
    }),
    prisma.staff.findMany({ where: { isActive: true }, orderBy: [{ role: 'asc' }, { name: 'asc' }] }),
    prisma.shiftPreference.findMany({ where: { businessDate: range } }),
    loadSettings(),
  ]);

  const now = new Date();
  const submittedStaffIds = new Set(preferences.map((p) => p.staffId));
  const notSubmitted = staff.filter((s) => !submittedStaffIds.has(s.id));

  const roles = Array.from(new Set(days.flatMap((d) => d.staffingRequirements.map((r) => r.roleNeeded)))) as StaffRole[];
  const roleOrder = Object.keys(STAFF_ROLE_LABELS) as StaffRole[];
  roles.sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b));

  const gridData: GridData = {
    periodId: id,
    status: period.status,
    roles: roles.map((r) => ({ key: r, label: STAFF_ROLE_LABELS[r] })),
    days: days.map((d) => ({
      id: d.id,
      businessDate: bd(d.businessDate),
      label: businessDateLabel(bd(d.businessDate)),
      eventType: d.eventType,
      eventName: d.eventName,
      requirements: d.staffingRequirements.map((r) => ({
        id: r.id,
        role: r.roleNeeded,
        start: r.startTime.toISOString(),
        end: r.endTime.toISOString(),
        headcount: r.headcount,
        assignments: d.shiftAssignments
          .filter((a) => a.roleAssigned === r.roleNeeded && a.plannedStart.getTime() === r.startTime.getTime() && a.plannedEnd.getTime() === r.endTime.getTime())
          .map((a) => ({ id: a.id, staffId: a.staffId, staffName: a.staff.name, status: a.status, source: a.source })),
      })),
      // 必要人員に紐付かない割当(時間帯が違う等)
      orphanAssignments: d.shiftAssignments
        .filter(
          (a) =>
            !d.staffingRequirements.some(
              (r) => a.roleAssigned === r.roleNeeded && a.plannedStart.getTime() === r.startTime.getTime() && a.plannedEnd.getTime() === r.endTime.getTime(),
            ),
        )
        .map((a) => ({ id: a.id, staffId: a.staffId, staffName: a.staff.name, status: a.status, source: a.source, role: a.roleAssigned, start: a.plannedStart.toISOString(), end: a.plannedEnd.toISOString() })),
    })),
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      roleLabel: STAFF_ROLE_LABELS[s.role as StaffRole],
      isMinor: s.isMinor,
      isNewcomer: isNewcomer(s, now, settings.newcomerMonths),
      employmentType: s.employmentType,
    })),
    preferences: preferences.map((p) => ({ staffId: p.staffId, businessDate: bd(p.businessDate), availability: p.availability })),
  };

  const totalNeeded = days.reduce((s, d) => s + d.staffingRequirements.reduce((x, r) => x + r.headcount, 0), 0);
  const totalAssigned = days.reduce((s, d) => s + d.shiftAssignments.filter((a) => a.status !== 'ABSENT').length, 0);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {businessDateLabel(start, true)} 〜 {businessDateLabel(end)}
        </h1>
        <PeriodStatus status={period.status} />
        <Link href="/admin/periods" className="btn sm">
          ← 一覧
        </Link>
        <span className="spacer" />
        <form action={generateAction}>
          <input type="hidden" name="periodId" value={id} />
          <button type="submit" className="btn">
            自動生成{period.generatedAt ? '(再実行)' : ''}
          </button>
        </form>
        <form action={confirmPeriodAction}>
          <input type="hidden" name="periodId" value={id} />
          <button type="submit" className="btn primary" disabled={totalAssigned === 0}>
            {period.status === 'CONFIRMED' ? '変更を確定して再配信' : '確定して LINE 配信'}
          </button>
        </form>
      </div>
      {query.error ? <div className="alert error">{query.error}</div> : null}
      {query.ok ? <div className="alert success">{query.ok}</div> : null}

      <div className="card-row" style={{ marginBottom: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">希望提出</div>
          <div className="stat">
            {staff.length - notSubmitted.length} / {staff.length}
          </div>
          <div className="small muted">
            締切 {period.preferenceDeadline.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            {notSubmitted.length > 0 ? ` ・ 未提出: ${notSubmitted.map((s) => s.name).join('、')}` : ''}
          </div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">充足</div>
          <div className="stat" style={totalAssigned < totalNeeded ? { color: 'var(--danger)' } : undefined}>
            {totalAssigned} / {totalNeeded}
          </div>
          <div className="small muted">不足セルは赤で表示。スタッフをドラッグして調整できます。</div>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="alert warn">
          この期間の営業日が登録されていません。<Link href={`/admin/calendar?month=${start.slice(0, 7)}`}>カレンダー</Link>で営業日と必要人員を登録してください。
        </div>
      ) : (
        <ShiftGrid data={gridData} />
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>希望一覧</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>スタッフ</th>
                {days.map((d) => (
                  <th key={d.id} style={{ textAlign: 'center' }}>
                    {Number(bd(d.businessDate).slice(8, 10))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.name}</td>
                  {days.map((d) => {
                    const p = preferences.find((x) => x.staffId === s.id && bd(x.businessDate) === bd(d.businessDate));
                    return (
                      <td key={d.id} style={{ textAlign: 'center', color: p?.availability === 'NG' ? 'var(--danger)' : undefined }}>
                        {p ? AVAILABILITY_LABELS[p.availability] : <span className="muted">-</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          ○ = 可 / × = 不可 / 早 = 早番のみ / 遅 = 遅番のみ / - = 未提出
        </p>
      </div>
    </>
  );
}
