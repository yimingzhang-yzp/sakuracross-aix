import { businessDateToDbValue, isBusinessDateString } from '@sakura-cross/business-date';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db, loadSettings } from '@/lib/db';
import { businessDateLabel, EVENT_TYPE_LABELS, hhmm, SHIFT_STATUS_LABELS, timeRange } from '@/lib/format';
import { EVENT_TYPES, suggestEventType } from '@/lib/scheduling/day-type';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@/lib/scheduling/types';

import { addRequirementAction, deleteRequirementAction, expandTemplateAction, upsertBusinessDayAction } from '../actions';

export default async function BusinessDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { date } = await params;
  const query = await searchParams;
  if (!isBusinessDateString(date)) notFound();

  const [day, settings] = await Promise.all([
    db().businessDay.findUnique({
      where: { businessDate: businessDateToDbValue(date) },
      include: {
        staffingRequirements: { orderBy: [{ startTime: 'asc' }, { roleNeeded: 'asc' }] },
        shiftAssignments: { include: { staff: true }, orderBy: [{ plannedStart: 'asc' }] },
        openShiftRequests: { where: { status: 'OPEN' } },
      },
    }),
    loadSettings(),
  ]);
  // 未登録日は曜日ルールから種別を提案する
  const suggested = suggestEventType(date, settings);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>営業日 {businessDateLabel(date, true)}</h1>
        <Link href={`/admin/calendar?month=${date.slice(0, 7)}`} className="btn sm">
          ← カレンダーへ
        </Link>
      </div>
      {query.error ? <div className="alert error">{query.error}</div> : null}
      {query.ok ? <div className="alert success">{query.ok}</div> : null}

      <div className="card">
        <h2>イベント情報</h2>
        <form action={upsertBusinessDayAction} className="stack">
          <input type="hidden" name="date" value={date} />
          <div className="grid-3">
            <label className="field">
              種別
              <select name="eventType" defaultValue={day?.eventType ?? suggested}>
                {EVENT_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {EVENT_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
              {!day ? <span className="muted small">曜日ルールの提案: {EVENT_TYPE_LABELS[suggested]}</span> : null}
            </label>
            <label className="field">
              イベント名
              <input name="eventName" defaultValue={day?.eventName ?? ''} placeholder="例: TOKYO TRANCE COLLECTIVE" />
            </label>
            <label className="field">
              動員予測(人)
              <input name="expectedCrowd" type="number" min={0} defaultValue={day?.expectedCrowd ?? ''} />
            </label>
          </div>
          <label className="field">
            メモ
            <input name="note" defaultValue={day?.note ?? ''} />
          </label>
          <div>
            <button type="submit" className="btn primary">
              {day ? '保存' : '営業日を登録'}
            </button>
          </div>
        </form>
      </div>

      {day ? (
        <>
          <div className="card">
            <div className="toolbar">
              <h2 style={{ margin: 0 }}>必要人員</h2>
              <span className="spacer" />
              <form action={expandTemplateAction} className="inline">
                <input type="hidden" name="date" value={date} />
                <button type="submit" className="btn" disabled={day.eventType === 'CLOSED'}>
                  テンプレートから展開({EVENT_TYPE_LABELS[day.eventType]})
                </button>
              </form>
            </div>
            <p className="muted small">「テンプレートから展開」は現在の必要人員を置き換えます。</p>
            <table className="data" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>職種</th>
                  <th>時間帯</th>
                  <th className="num">人数</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {day.staffingRequirements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      必要人員が未登録です
                    </td>
                  </tr>
                ) : (
                  day.staffingRequirements.map((r) => (
                    <tr key={r.id}>
                      <td>{STAFF_ROLE_LABELS[r.roleNeeded]}</td>
                      <td>{timeRange(r.startTime, r.endTime)}</td>
                      <td className="num">{r.headcount}</td>
                      <td>
                        <form action={deleteRequirementAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="date" value={date} />
                          <button type="submit" className="btn danger sm">
                            削除
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <form action={addRequirementAction} className="inline">
              <input type="hidden" name="date" value={date} />
              <label className="field">
                職種
                <select name="roleNeeded" defaultValue="BARTENDER">
                  {STAFF_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {STAFF_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                開始(HH:mm)
                <input name="startTime" defaultValue="20:00" pattern="\d{2}:\d{2}" required />
              </label>
              <label className="field">
                終了(HH:mm)
                <input name="endTime" defaultValue="05:00" pattern="\d{2}:\d{2}" required />
              </label>
              <label className="field">
                人数
                <input name="headcount" type="number" min={1} defaultValue={1} style={{ width: 80 }} />
              </label>
              <button type="submit" className="btn primary">
                追加
              </button>
            </form>
          </div>

          <div className="card">
            <h2>この日のシフト</h2>
            {day.shiftAssignments.length === 0 ? (
              <p className="muted">
                割当はありません。<Link href="/admin/periods">シフト期間</Link>から生成してください。
              </p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>スタッフ</th>
                    <th>職種</th>
                    <th>時間</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {day.shiftAssignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.staff.name}</td>
                      <td>{STAFF_ROLE_LABELS[a.roleAssigned]}</td>
                      <td>
                        {hhmm(a.plannedStart)}〜{hhmm(a.plannedEnd)}
                      </td>
                      <td>
                        <span className={`badge ${a.status === 'CONFIRMED' ? 'ok' : a.status === 'ABSENT' ? 'danger' : ''}`}>{SHIFT_STATUS_LABELS[a.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {day.openShiftRequests.length > 0 ? (
              <p style={{ marginTop: 8 }}>
                <Link href="/admin/open-shifts">募集中の欠員 {day.openShiftRequests.length} 件</Link>
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
