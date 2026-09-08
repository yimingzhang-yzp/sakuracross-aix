import type { ShiftPayrollSettings } from '@/lib/settings';

import { saveSettingsAction } from './actions';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function SettingsForm({ settings }: { settings: ShiftPayrollSettings }) {
  return (
    <form action={saveSettingsAction} className="stack">
      <div className="card">
        <h2>給与計算</h2>
        <div className="grid-3">
          <label className="field">
            既定時給(円)
            <input name="defaultHourlyWage" type="number" min={0} defaultValue={settings.defaultHourlyWage} />
          </label>
          <label className="field">
            給与締め日
            <select name="payrollClosingDay" defaultValue={String(settings.payrollClosingDay)}>
              <option value="EOM">月末締め</option>
              {[5, 10, 15, 20, 25].map((d) => (
                <option key={d} value={d}>
                  {d} 日締め
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            円未満の端数
            <select name="yenRounding" defaultValue={settings.yenRounding}>
              <option value="floor_daily">日別に切り捨て</option>
              <option value="floor_monthly">月合計で切り捨て</option>
              <option value="round_daily">日別に四捨五入</option>
            </select>
          </label>
          <label className="field">
            深夜割増率
            <input name="nightPremiumRate" type="number" step="0.01" min={0} defaultValue={settings.nightPremiumRate} />
          </label>
          <label className="field">
            深夜開始(HH:mm)
            <input name="nightStart" defaultValue={settings.nightStart} pattern="\d{2}:\d{2}" />
          </label>
          <label className="field">
            深夜終了(HH:mm)
            <input name="nightEnd" defaultValue={settings.nightEnd} pattern="\d{2}:\d{2}" />
          </label>
          <label className="field">
            CSV 文字コード
            <select name="csvEncoding" defaultValue={settings.csvEncoding}>
              <option value="utf8-bom">UTF-8(BOM 付き)</option>
              <option value="sjis">Shift_JIS</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>社会保険・所得税(法定控除)</h2>
        <p className="muted small">
          料率は労使合計を入力し、本人負担分(1/2)を給与から控除します。健康保険・介護保険は協会けんぽの都道府県別料率(毎年 3 月改定)、雇用保険は本人負担分の料率(毎年 4 月改定)を入力してください。
          所得税は国税庁の「電算機計算の特例」(甲欄)で自動計算します。加入の有無・扶養人数・標準報酬月額はスタッフごとに設定します。
        </p>
        <div className="grid-3">
          <label className="field">
            健康保険料率(労使合計。例 0.0991 = 9.91%)
            <input name="healthInsuranceRate" type="number" step="0.0001" min={0} max={1} defaultValue={settings.healthInsuranceRate} />
          </label>
          <label className="field">
            介護保険料率(労使合計。40〜64 歳。例 0.0159)
            <input name="careInsuranceRate" type="number" step="0.0001" min={0} max={1} defaultValue={settings.careInsuranceRate} />
          </label>
          <label className="field">
            厚生年金保険料率(労使合計。例 0.183)
            <input name="pensionInsuranceRate" type="number" step="0.0001" min={0} max={1} defaultValue={settings.pensionInsuranceRate} />
          </label>
          <label className="field">
            雇用保険料率(本人負担分。例 0.0055 = 0.55%)
            <input name="employmentInsuranceWorkerRate" type="number" step="0.0001" min={0} max={1} defaultValue={settings.employmentInsuranceWorkerRate} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>営業カレンダー(曜日ルール)</h2>
        <p className="muted small">カレンダーの「未登録日を一括作成」で使う既定の種別です。定休日は「休業」、週末営業の曜日は「週末営業」、それ以外は「通常営業」になります(定休日が優先)。</p>
        <div className="grid-2">
          <div className="field">
            <span>定休日</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {WEEKDAYS.map((w, i) => (
                <label key={i} style={{ fontSize: 13 }}>
                  <input type="checkbox" name="closedWeekdays" value={i} defaultChecked={settings.closedWeekdays.includes(i)} /> {w}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <span>週末営業の曜日</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {WEEKDAYS.map((w, i) => (
                <label key={i} style={{ fontSize: 13 }}>
                  <input type="checkbox" name="weekendWeekdays" value={i} defaultChecked={settings.weekendWeekdays.includes(i)} /> {w}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>打刻の丸め・休憩</h2>
        <div className="grid-3">
          <label className="field">
            丸め単位(分)
            <select name="roundingMinutes" defaultValue={settings.roundingMinutes}>
              {[0, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? '丸めなし' : `${m} 分`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            丸め方向
            <select name="roundingMode" defaultValue={settings.roundingMode}>
              <option value="favor_worker">出勤は早く・退勤は遅く(労働者有利)</option>
              <option value="nearest">最も近い単位へ</option>
              <option value="strict">出勤は遅く・退勤は早く(非推奨)</option>
            </select>
          </label>
          <label className="field">
            休憩の自動控除
            <select name="autoBreakEnabled" defaultValue={settings.autoBreakEnabled ? 'true' : 'false'}>
              <option value="true">有効(休憩未入力時に自動控除)</option>
              <option value="false">無効</option>
            </select>
          </label>
        </div>
        <h3 style={{ marginTop: 12 }}>自動控除ルール</h3>
        <p className="muted small">実労働がしきい値を超えた場合に控除する分数。複数該当する場合は大きい方を適用。</p>
        <div className="grid-2">
          {[0, 1, 2].map((i) => {
            const rule = settings.autoBreakRules[i];
            return (
              <div key={i} className="grid-2">
                <label className="field">
                  しきい値(分)超
                  <input name={`autoBreakOver${i}`} type="number" min={0} defaultValue={rule?.overMinutes ?? ''} placeholder="例 360" />
                </label>
                <label className="field">
                  控除(分)
                  <input name={`autoBreakMinutes${i}`} type="number" min={0} defaultValue={rule?.breakMinutes ?? ''} placeholder="例 45" />
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>シフト生成</h2>
        <div className="grid-3">
          <label className="field">
            週の割当上限(時間、0 = 無制限)
            <input name="weeklyHoursCap" type="number" min={0} step="0.5" defaultValue={settings.weeklyHoursCap} />
          </label>
          <label className="field">
            週の開始曜日
            <select name="weekStartsOn" defaultValue={settings.weekStartsOn}>
              {WEEKDAYS.map((w, i) => (
                <option key={i} value={i}>
                  {w}曜
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            新人判定(入店からの月数)
            <input name="newcomerMonths" type="number" min={0} defaultValue={settings.newcomerMonths} />
          </label>
          <label className="field">
            早番 = この時刻までに終了
            <input name="earlyShiftEnd" defaultValue={settings.earlyShiftEnd} pattern="\d{2}:\d{2}" />
          </label>
          <label className="field">
            遅番 = この時刻以降に開始
            <input name="lateShiftStart" defaultValue={settings.lateShiftStart} pattern="\d{2}:\d{2}" />
          </label>
          <label className="field">
            未成年の勤務禁止開始
            <input name="minorNightStart" defaultValue={settings.minorNightStart} pattern="\d{2}:\d{2}" />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>LINE 通知・欠員募集</h2>
        <div className="grid-3">
          <label className="field">
            欠員募集の確定方式
            <select name="openShiftMode" defaultValue={settings.openShiftMode}>
              <option value="FIRST_COME">先着順で即確定</option>
              <option value="MANAGER_APPROVAL">店長承認後に確定</option>
            </select>
          </label>
          <label className="field">
            募集の受付期限(時間、0 = 無期限)
            <input name="openShiftExpireHours" type="number" min={0} defaultValue={settings.openShiftExpireHours} />
          </label>
          <label className="field">
            希望提出リマインド(締切の N 日前、カンマ区切り)
            <input name="preferenceReminderDaysBefore" defaultValue={settings.preferenceReminderDaysBefore.join(',')} placeholder="2,0" />
          </label>
        </div>
      </div>

      <div>
        <button type="submit" className="btn primary">
          保存
        </button>
      </div>
    </form>
  );
}
