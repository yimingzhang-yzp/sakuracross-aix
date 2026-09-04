import { addBusinessDays, toBusinessDate } from '@sakura-cross/business-date';
import { businessDateToDbValue } from '@sakura-cross/business-date';
import Link from 'next/link';

import { db } from '@/lib/db';
import { bd, EVENT_TYPE_LABELS } from '@/lib/format';

import { bulkCreateDaysAction } from './actions';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function monthOf(param: string | undefined): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(param ?? '');
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  const today = toBusinessDate(new Date());
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const { year, month } = monthOf(params.month);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${pad(month)}-${pad(lastDay)}`;

  const days = await db().businessDay.findMany({
    where: { businessDate: { gte: businessDateToDbValue(first), lte: businessDateToDbValue(last) } },
    include: { staffingRequirements: true, _count: { select: { shiftAssignments: { where: { status: 'CONFIRMED' } } } } },
  });
  const byDate = new Map(days.map((d) => [bd(d.businessDate), d]));

  const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  const leading = new Date(`${first}T00:00:00Z`).getUTCDay();
  const cells: Array<string | null> = [...Array<null>(leading).fill(null)];
  for (let d = first; d <= last; d = addBusinessDays(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const today = toBusinessDate(new Date());

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          カレンダー {year}年{month}月
        </h1>
        <Link href={`/admin/calendar?month=${prevMonth}`} className="btn sm">
          ← 前月
        </Link>
        <Link href={`/admin/calendar?month=${nextMonth}`} className="btn sm">
          翌月 →
        </Link>
        <span className="spacer" />
        <form action={bulkCreateDaysAction} className="inline">
          <input type="hidden" name="month" value={`${year}-${pad(month)}`} />
          <select name="eventType" defaultValue="NORMAL">
            {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="small muted">
            <input type="checkbox" name="expand" value="1" defaultChecked /> テンプレート展開
          </label>
          <button type="submit" className="btn">
            未登録日を一括作成
          </button>
        </form>
      </div>
      <p className="muted small">日付をクリックすると、イベント種別・動員予測・必要人員を編集できます。数字は「必要人員の合計 / 確定シフト数」。</p>
      {params.error ? <div className="alert error">{params.error}</div> : null}
      {params.ok ? <div className="alert success">{params.ok}</div> : null}

      <div className="calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="head">
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const day = byDate.get(date);
          const cls = ['day'];
          if (day?.eventType === 'CLOSED') cls.push('closed');
          if (day?.eventType === 'BIG_EVENT') cls.push('big');
          if (day?.eventType === 'RENTAL') cls.push('rental');
          const needed = day?.staffingRequirements.reduce((s, r) => s + r.headcount, 0) ?? 0;
          return (
            <Link key={date} href={`/admin/calendar/${date}`} className={cls.join(' ')} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="num" style={date === today ? { color: 'var(--accent)' } : undefined}>
                {Number(date.slice(8, 10))}
              </div>
              {day ? (
                <>
                  <div>{EVENT_TYPE_LABELS[day.eventType]}</div>
                  {day.eventName ? <div className="muted">{day.eventName}</div> : null}
                  {day.eventType !== 'CLOSED' ? (
                    <div className="muted">
                      {needed} / {day._count.shiftAssignments}
                      {day.expectedCrowd ? ` ・ ${day.expectedCrowd}人` : ''}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="muted">未登録</div>
              )}
            </Link>
          );
        })}
      </div>
    </>
  );
}
