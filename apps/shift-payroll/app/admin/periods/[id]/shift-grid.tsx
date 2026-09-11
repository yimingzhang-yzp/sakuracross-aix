'use client';

import { useRouter } from 'next/navigation';
import { type DragEvent, useState, useTransition } from 'react';

import { addAssignmentAction, issueOpenShiftAction, markAbsentAction, moveAssignmentAction, removeAssignmentAction } from '../actions';

export interface GridAssignment {
  id: string;
  staffId: string;
  staffName: string;
  status: string;
  source: string;
}

export interface GridRequirement {
  id: string;
  role: string;
  start: string;
  end: string;
  headcount: number;
  assignments: GridAssignment[];
}

export interface GridDay {
  id: string;
  businessDate: string;
  label: string;
  eventType: string;
  eventName: string | null;
  requirements: GridRequirement[];
  orphanAssignments: Array<GridAssignment & { role: string; start: string; end: string }>;
}

export interface GridStaff {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  isMinor: boolean;
  isNewcomer: boolean;
  employmentType: string;
}

export interface GridData {
  periodId: string;
  status: string;
  roles: Array<{ key: string; label: string }>;
  days: GridDay[];
  staff: GridStaff[];
  preferences: Array<{ staffId: string; businessDate: string; availability: string }>;
}

type DragPayload = { kind: 'assignment'; assignmentId: string; staffId: string } | { kind: 'staff'; staffId: string };

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
}

export function ShiftGrid({ data }: { data: GridData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'warn'; text: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // ドラッグ中のスタッフ。dragover では dataTransfer を読めないため state で保持する
  const [draggingStaffId, setDraggingStaffId] = useState<string | null>(null);

  const prefMap = new Map(data.preferences.map((p) => [`${p.staffId}|${p.businessDate}`, p.availability]));
  const staffName = new Map(data.staff.map((s) => [s.id, s.name]));

  /** 本人が × を出した営業日は割当禁止(サーバー側でも拒否する) */
  function isRefused(staffId: string | null, businessDate: string): boolean {
    if (!staffId) return false;
    return prefMap.get(`${staffId}|${businessDate}`) === 'NG';
  }

  function run(fn: () => Promise<{ ok: boolean; message?: string; warnings?: string[] }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setMessage({ type: 'error', text: result.message ?? 'エラーが発生しました' });
      } else if (result.warnings && result.warnings.length > 0) {
        setMessage({ type: 'warn', text: `${result.message ?? '保存しました'}(注意: ${result.warnings.join(' / ')})` });
      } else {
        setMessage(result.message ? { type: 'success', text: result.message } : null);
      }
      router.refresh();
    });
  }

  function onDragStart(e: DragEvent, payload: DragPayload) {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingStaffId(payload.staffId);
  }

  function onDragEnd() {
    setDraggingStaffId(null);
    setDropTarget(null);
  }

  function onDrop(e: DragEvent, requirementId: string, businessDate: string) {
    e.preventDefault();
    setDropTarget(null);
    setDraggingStaffId(null);
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
    } catch {
      return;
    }
    if (isRefused(payload.staffId, businessDate)) {
      setMessage({ type: 'error', text: `${staffName.get(payload.staffId) ?? 'このスタッフ'} は希望が × のため、この日には入れられません` });
      return;
    }
    if (payload.kind === 'assignment') {
      run(() => moveAssignmentAction({ periodId: data.periodId, assignmentId: payload.assignmentId, requirementId }));
    } else {
      run(() => addAssignmentAction({ periodId: data.periodId, staffId: payload.staffId, requirementId }));
    }
  }

  const visibleStaff = selectedDay
    ? data.staff.filter((s) => {
        const pref = prefMap.get(`${s.id}|${selectedDay}`);
        return pref && pref !== 'NG';
      })
    : data.staff;

  return (
    <div>
      {message ? <div className={`alert ${message.type}`}>{message.text}</div> : null}
      {pending ? <div className="muted small">保存中…</div> : null}

      <div className="card">
        <div className="toolbar">
          <strong>スタッフ(ドラッグしてセルに追加)</strong>
          <select value={selectedDay ?? ''} onChange={(e) => setSelectedDay(e.target.value || null)} style={{ fontSize: 12 }}>
            <option value="">全員を表示</option>
            {data.days.map((d) => (
              <option key={d.id} value={d.businessDate}>
                {d.label} に希望○のスタッフだけ
              </option>
            ))}
          </select>
        </div>
        <div className="staff-pool">
          {visibleStaff.map((s) => (
            <div
              key={s.id}
              className="chip"
              draggable
              onDragStart={(e) => onDragStart(e, { kind: 'staff', staffId: s.id })}
              onDragEnd={onDragEnd}
              title={s.roleLabel}
            >
              <span className="name">{s.name}</span>
              <span className="muted small">{s.roleLabel}</span>
              {s.isMinor ? <span className="badge danger">未成年</span> : null}
              {s.isNewcomer ? <span className="badge warn">新人</span> : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="shift-grid">
          <thead>
            <tr>
              <th className="day">営業日</th>
              {data.roles.map((r) => (
                <th key={r.key}>{r.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.id}>
                <th className="day" style={{ textAlign: 'left', position: 'static' }}>
                  <div>{day.label}</div>
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {day.eventType === 'CLOSED' ? '休業' : day.eventName ?? ''}
                  </div>
                  {day.orphanAssignments.length > 0 ? (
                    <div style={{ marginTop: 4 }}>
                      {day.orphanAssignments.map((a) => (
                        <div key={a.id} className={`chip ${a.status === 'ABSENT' ? 'absent' : ''}`} title="必要人員に一致しない時間帯の割当">
                          <span className="name">
                            {a.staffName} {fmtTime(a.start)}-{fmtTime(a.end)}
                          </span>
                          <button type="button" onClick={() => run(() => removeAssignmentAction({ periodId: data.periodId, assignmentId: a.id }))} title="削除">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </th>
                {data.roles.map((role) => {
                  const reqs = day.requirements.filter((r) => r.role === role.key);
                  if (day.eventType === 'CLOSED') {
                    return (
                      <td key={role.key} className="closed">
                        休業
                      </td>
                    );
                  }
                  if (reqs.length === 0) {
                    return <td key={role.key} className="closed" />;
                  }
                  const anyShort = reqs.some((r) => r.assignments.filter((a) => a.status !== 'ABSENT').length < r.headcount);
                  return (
                    <td key={role.key} className={anyShort ? 'short' : undefined}>
                      {reqs.map((req) => {
                        const active = req.assignments.filter((a) => a.status !== 'ABSENT');
                        const missing = req.headcount - active.length;
                        const isTarget = dropTarget === req.id;
                        // ドラッグ中のスタッフがこの日に × を出していれば、ドロップ自体を受け付けない
                        const refused = isRefused(draggingStaffId, day.businessDate);
                        return (
                          <div
                            key={req.id}
                            className={refused ? 'no-drop' : isTarget ? 'drop-target' : undefined}
                            onDragOver={(e) => {
                              if (refused) {
                                // preventDefault を呼ばない = ドロップ不可。カーソルも禁止表示になる
                                e.dataTransfer.dropEffect = 'none';
                                return;
                              }
                              e.preventDefault();
                              setDropTarget(req.id);
                            }}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(e) => onDrop(e, req.id, day.businessDate)}
                            style={{ minHeight: 40, padding: 2 }}
                            title={refused ? '本人の希望が × のため割り当てできません' : undefined}
                          >
                            <div className="cell-meta">
                              {fmtTime(req.start)}-{fmtTime(req.end)} {active.length}/{req.headcount}
                              {missing > 0 ? <strong style={{ color: 'var(--danger)' }}> 不足{missing}</strong> : null}
                            </div>
                            {req.assignments.map((a) => {
                              const pref = prefMap.get(`${a.staffId}|${day.businessDate}`);
                              return (
                                <div
                                  key={a.id}
                                  className={`chip ${a.status === 'ABSENT' ? 'absent' : ''} ${a.source === 'MANUAL' ? 'manual' : ''}`}
                                  draggable={a.status !== 'ABSENT'}
                                  onDragStart={(e) => onDragStart(e, { kind: 'assignment', assignmentId: a.id, staffId: a.staffId })}
                                  onDragEnd={onDragEnd}
                                  title={`${a.status} / ${a.source}${pref ? ` / 希望:${pref}` : ' / 希望未提出'}`}
                                >
                                  <span className="name">{a.staffName}</span>
                                  {a.status === 'CONFIRMED' ? <span className="badge ok">確</span> : null}
                                  {a.status === 'ABSENT' ? <span className="badge danger">欠</span> : null}
                                  {a.status === 'CONFIRMED' ? (
                                    <button
                                      type="button"
                                      title="当日欠勤にして募集をかける"
                                      onClick={() => {
                                        if (confirm(`${a.staffName} を欠勤にして、同条件の欠員募集を LINE 配信しますか?`)) {
                                          run(() => markAbsentAction({ periodId: data.periodId, assignmentId: a.id, issueOpenShift: true }));
                                        }
                                      }}
                                    >
                                      欠勤
                                    </button>
                                  ) : null}
                                  {a.status !== 'ABSENT' ? (
                                    <button type="button" title="外す" onClick={() => run(() => removeAssignmentAction({ periodId: data.periodId, assignmentId: a.id }))}>
                                      ×
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })}
                            {missing > 0 ? (
                              <button
                                type="button"
                                className="btn sm"
                                style={{ marginTop: 2 }}
                                onClick={() => run(() => issueOpenShiftAction({ periodId: data.periodId, requirementId: req.id }))}
                              >
                                募集をかける
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        青 = 自動生成 / 黄 = 手修正 / 「確」= 確定済み / 赤帯 = 欠勤。チップをドラッグして別のセルへ移動、× で外す。
        本人が希望を <strong>×</strong> にした営業日にはドロップできません(枠が赤い斜線になります)。
      </p>
    </div>
  );
}
