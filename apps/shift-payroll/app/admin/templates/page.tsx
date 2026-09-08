import { db } from '@/lib/db';
import { EVENT_TYPE_LABELS } from '@/lib/format';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@/lib/scheduling/types';

import { addTemplateRowAction, deleteTemplateRowAction } from './actions';

const EVENT_TYPES = ['NORMAL', 'WEEKEND', 'BIG_EVENT', 'RENTAL'] as const;

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [rows, params] = await Promise.all([
    db().staffingTemplate.findMany({ orderBy: [{ eventType: 'asc' }, { sortOrder: 'asc' }] }),
    searchParams,
  ]);

  return (
    <>
      <h1>必要人員テンプレート</h1>
      <p className="muted">
        イベント種別ごとの「職種 × 時間帯 × 人数」です。カレンダーの営業日で「テンプレートから展開」すると、この内容が必要人員として登録されます。時刻は営業日基準(20:00〜05:00 は翌朝 5 時)。
      </p>
      {params.error ? <div className="alert error">{params.error}</div> : null}

      {EVENT_TYPES.map((eventType) => {
        const list = rows.filter((r) => r.eventType === eventType);
        return (
          <div className="card" key={eventType}>
            <h2>{EVENT_TYPE_LABELS[eventType]}</h2>
            <table className="data" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>職種</th>
                  <th>開始</th>
                  <th>終了</th>
                  <th className="num">人数</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      未登録
                    </td>
                  </tr>
                ) : (
                  list.map((r) => (
                    <tr key={r.id}>
                      <td>{STAFF_ROLE_LABELS[r.roleNeeded]}</td>
                      <td>{r.startTime}</td>
                      <td>{r.endTime}</td>
                      <td className="num">{r.headcount}</td>
                      <td>
                        <form action={deleteTemplateRowAction}>
                          <input type="hidden" name="id" value={r.id} />
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
            <form action={addTemplateRowAction} className="inline">
              <input type="hidden" name="eventType" value={eventType} />
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
                <input name="headcount" type="number" min={1} defaultValue={1} required style={{ width: 80 }} />
              </label>
              <button type="submit" className="btn primary">
                追加
              </button>
            </form>
          </div>
        );
      })}
    </>
  );
}
