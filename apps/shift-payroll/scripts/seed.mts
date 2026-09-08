/**
 * シフト給与のシードデータ
 *
 *   npm run db:seed   (ルートから。DATABASE_URL が必要)
 *
 * 投入内容(何度実行しても同じ結果になるよう upsert / 存在チェックで冪等にしている):
 * - 設定値(AppSetting)
 * - スタッフ 10 名(社員2・未成年1・新人2 を含む)+ 時給履歴(1 名は月途中で改定)
 * - イベント種別ごとの必要人員テンプレート
 * - 当月+翌月の営業日(設定の曜日ルール: 日月は休業、金土は週末営業。土曜の一部はビッグイベント)と必要人員
 * - 半月単位のシフト期間 2 つと希望シフト
 * - 前月の勤怠実績(承認済み)・日払い・インセンティブ(給与計算デモ用)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addBusinessDays, businessDateTimeToDate, businessDateToDbValue, toBusinessDate } from '@sakura-cross/business-date';
import { getPrisma, disconnectPrisma } from '@sakura-cross/shared-db';
import { config as loadEnv } from 'dotenv';

import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../lib/settings';
import { type EventTypeValue, suggestEventType } from '../lib/scheduling/day-type';
import { expandTemplates } from '../lib/scheduling/templates';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true });

const prisma = getPrisma();

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function monthsAgo(months: number, day = 1): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day));
}
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

type Role = 'RECEPTION' | 'BARTENDER' | 'BARBACK' | 'FLOOR_VIP' | 'CLOAK' | 'SECURITY' | 'MANAGER';

const STAFF: Array<{
  n: number;
  name: string;
  nameKana: string;
  role: Role;
  employmentType: 'PART_TIME' | 'FULL_TIME' | 'CONTRACT';
  hourlyWage: number;
  monthlySalary?: number;
  isMinor?: boolean;
  skills?: Record<string, boolean>;
  hiredAt: Date;
  accessRole?: 'ADMIN' | 'STAFF';
  lineUserId?: string;
  /** 法定控除(省略時: 甲欄・扶養 0・未加入) */
  deduction?: {
    taxTableType?: 'KOU' | 'OTSU' | 'NONE';
    dependentsCount?: number;
    socialInsuranceEnrolled?: boolean;
    careInsuranceApplicable?: boolean;
    employmentInsuranceEnrolled?: boolean;
    standardMonthlyRemuneration?: number;
  };
}> = [
  { n: 1, name: '高橋 健', nameKana: 'タカハシ ケン', role: 'MANAGER', employmentType: 'FULL_TIME', hourlyWage: 0, monthlySalary: 320_000, hiredAt: new Date('2019-04-01'), accessRole: 'ADMIN', skills: { floor_vip: true, bartender: true }, lineUserId: 'Udev-manager', deduction: { socialInsuranceEnrolled: true, careInsuranceApplicable: true, employmentInsuranceEnrolled: true, dependentsCount: 1, standardMonthlyRemuneration: 320_000 } },
  { n: 2, name: '佐藤 美咲', nameKana: 'サトウ ミサキ', role: 'FLOOR_VIP', employmentType: 'FULL_TIME', hourlyWage: 0, monthlySalary: 280_000, hiredAt: new Date('2021-07-01'), skills: { reception: true }, deduction: { socialInsuranceEnrolled: true, employmentInsuranceEnrolled: true, standardMonthlyRemuneration: 280_000 } },
  { n: 3, name: '鈴木 大輔', nameKana: 'スズキ ダイスケ', role: 'BARTENDER', employmentType: 'PART_TIME', hourlyWage: 1400, hiredAt: new Date('2022-03-15'), skills: { barback: true }, deduction: { employmentInsuranceEnrolled: true } },
  { n: 4, name: '田中 玲奈', nameKana: 'タナカ レナ', role: 'BARTENDER', employmentType: 'PART_TIME', hourlyWage: 1350, hiredAt: new Date('2023-09-01') },
  { n: 5, name: '伊藤 翔', nameKana: 'イトウ ショウ', role: 'BARBACK', employmentType: 'PART_TIME', hourlyWage: 1200, hiredAt: daysAgo(42), skills: { bartender: true } },
  { n: 6, name: '渡辺 花', nameKana: 'ワタナベ ハナ', role: 'RECEPTION', employmentType: 'PART_TIME', hourlyWage: 1300, hiredAt: new Date('2023-02-01'), skills: { cloak: true }, lineUserId: 'Udev-staff' },
  { n: 7, name: '山本 悠', nameKana: 'ヤマモト ユウ', role: 'RECEPTION', employmentType: 'PART_TIME', hourlyWage: 1250, isMinor: true, hiredAt: daysAgo(21) },
  { n: 8, name: '中村 蓮', nameKana: 'ナカムラ レン', role: 'SECURITY', employmentType: 'PART_TIME', hourlyWage: 1500, hiredAt: new Date('2020-10-01'), deduction: { taxTableType: 'OTSU' } },
  { n: 9, name: '小林 拓真', nameKana: 'コバヤシ タクマ', role: 'SECURITY', employmentType: 'PART_TIME', hourlyWage: 1450, hiredAt: new Date('2022-11-01'), skills: { reception: true } },
  { n: 10, name: '加藤 さくら', nameKana: 'カトウ サクラ', role: 'CLOAK', employmentType: 'PART_TIME', hourlyWage: 1200, hiredAt: new Date('2024-06-01'), skills: { reception: true } },
];

const TEMPLATES: Record<Exclude<EventTypeValue, 'CLOSED'>, Array<{ roleNeeded: Role; startTime: string; endTime: string; headcount: number }>> = {
  NORMAL: [
    { roleNeeded: 'RECEPTION', startTime: '20:00', endTime: '05:00', headcount: 1 },
    { roleNeeded: 'BARTENDER', startTime: '20:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'BARBACK', startTime: '20:00', endTime: '05:00', headcount: 1 },
    { roleNeeded: 'FLOOR_VIP', startTime: '21:00', endTime: '05:00', headcount: 1 },
    { roleNeeded: 'SECURITY', startTime: '20:00', endTime: '05:00', headcount: 1 },
    { roleNeeded: 'CLOAK', startTime: '21:00', endTime: '04:00', headcount: 1 },
  ],
  // 週末営業: 通常より厚め、ビッグイベントほどではない
  WEEKEND: [
    { roleNeeded: 'RECEPTION', startTime: '20:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'BARTENDER', startTime: '20:00', endTime: '05:00', headcount: 3 },
    { roleNeeded: 'BARBACK', startTime: '20:00', endTime: '05:00', headcount: 1 },
    { roleNeeded: 'FLOOR_VIP', startTime: '21:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'SECURITY', startTime: '20:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'CLOAK', startTime: '20:00', endTime: '05:00', headcount: 1 },
  ],
  BIG_EVENT: [
    { roleNeeded: 'RECEPTION', startTime: '20:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'BARTENDER', startTime: '20:00', endTime: '05:00', headcount: 4 },
    { roleNeeded: 'BARBACK', startTime: '20:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'FLOOR_VIP', startTime: '21:00', endTime: '05:00', headcount: 2 },
    { roleNeeded: 'SECURITY', startTime: '20:00', endTime: '05:00', headcount: 3 },
    { roleNeeded: 'CLOAK', startTime: '20:00', endTime: '05:00', headcount: 1 },
  ],
  RENTAL: [
    { roleNeeded: 'BARTENDER', startTime: '19:00', endTime: '00:00', headcount: 2 },
    { roleNeeded: 'FLOOR_VIP', startTime: '19:00', endTime: '00:00', headcount: 1 },
    { roleNeeded: 'SECURITY', startTime: '19:00', endTime: '00:00', headcount: 1 },
  ],
};

/** 決定的な擬似乱数(シードは文字列)。実行ごとに希望がばらつかないようにする */
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function seedSettings(): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: {},
    create: { key: SETTINGS_KEY, value: DEFAULT_SETTINGS, description: 'シフト給与の業務パラメータ(管理画面 > 設定)', updatedBy: 'seed' },
  });
  console.log('✓ 設定値');
}

async function seedStaff(): Promise<void> {
  for (const s of STAFF) {
    await prisma.staff.upsert({
      where: { id: id(s.n) },
      update: {},
      create: {
        id: id(s.n),
        name: s.name,
        nameKana: s.nameKana,
        role: s.role,
        employmentType: s.employmentType,
        hourlyWage: s.hourlyWage,
        monthlySalary: s.monthlySalary ?? null,
        isMinor: s.isMinor ?? false,
        skills: s.skills ?? undefined,
        hiredAt: s.hiredAt,
        accessRole: s.accessRole ?? 'STAFF',
        lineUserId: s.lineUserId ?? null,
        taxTableType: s.deduction?.taxTableType ?? 'KOU',
        dependentsCount: s.deduction?.dependentsCount ?? 0,
        socialInsuranceEnrolled: s.deduction?.socialInsuranceEnrolled ?? false,
        careInsuranceApplicable: s.deduction?.careInsuranceApplicable ?? false,
        employmentInsuranceEnrolled: s.deduction?.employmentInsuranceEnrolled ?? false,
        standardMonthlyRemuneration: s.deduction?.standardMonthlyRemuneration ?? null,
      },
    });
    if (s.hourlyWage > 0) {
      const exists = await prisma.wageHistory.count({ where: { staffId: id(s.n) } });
      if (exists === 0) {
        const base = s.n === 4 ? 1300 : s.hourlyWage;
        await prisma.wageHistory.create({
          data: { staffId: id(s.n), hourlyWage: base, effectiveFrom: businessDateToDbValue(ymd(s.hiredAt) < '2024-01-01' ? '2024-01-01' : ymd(s.hiredAt)) },
        });
        if (s.n === 4) {
          // 田中: 前月 15 日に 1,300 → 1,350 へ改定(給与計算デモ)
          await prisma.wageHistory.create({
            data: { staffId: id(s.n), hourlyWage: 1350, effectiveFrom: businessDateToDbValue(ymd(monthsAgo(1, 15))) },
          });
        }
      }
    }
  }
  console.log(`✓ スタッフ ${STAFF.length} 名 + 時給履歴`);
}

async function seedTemplates(): Promise<void> {
  const count = await prisma.staffingTemplate.count();
  if (count > 0) {
    console.log('- 必要人員テンプレートは既に存在(スキップ)');
    return;
  }
  let sortOrder = 0;
  for (const [eventType, rows] of Object.entries(TEMPLATES) as Array<[keyof typeof TEMPLATES, (typeof TEMPLATES)['NORMAL']]>) {
    for (const row of rows) {
      await prisma.staffingTemplate.create({ data: { eventType, ...row, sortOrder: sortOrder++ } });
    }
  }
  console.log('✓ 必要人員テンプレート');
}

async function seedBusinessDays(): Promise<string[]> {
  const today = toBusinessDate(new Date());
  const [y, m] = today.split('-').map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(y, m + 1, 0)); // 翌月末
  const end = ymd(endDate);
  const dates: string[] = [];
  for (let d = start; d <= end; d = addBusinessDays(d, 1)) dates.push(d);

  const eventNames = ['TOKYO TRANCE COLLECTIVE', 'ROPPONGI BASS NIGHT', 'NEON SATURDAY', 'MIDNIGHT GROOVE'];
  for (const date of dates) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=日
    // 既定の曜日ルール(日月休業・金土週末営業)に、土曜の一部をビッグイベント、水曜の一部を貸切として上書き
    let eventType: EventTypeValue = suggestEventType(date, DEFAULT_SETTINGS);
    let eventName: string | null = null;
    let expectedCrowd: number | null = eventType === 'CLOSED' ? null : eventType === 'WEEKEND' ? 250 : 120;
    if (eventType === 'WEEKEND' && dow === 6 && hash(date) < 0.35) {
      eventType = 'BIG_EVENT';
      eventName = eventNames[Math.floor(hash(`${date}-name`) * eventNames.length)]!;
      expectedCrowd = 350 + Math.floor(hash(`${date}-crowd`) * 200);
    } else if (eventType === 'NORMAL' && dow === 3 && hash(`${date}-rental`) < 0.2) {
      eventType = 'RENTAL';
      eventName = '貸切パーティー';
      expectedCrowd = 80;
    }
    const day = await prisma.businessDay.upsert({
      where: { businessDate: businessDateToDbValue(date) },
      update: {},
      create: { businessDate: businessDateToDbValue(date), eventType, eventName, expectedCrowd },
    });
    if (eventType !== 'CLOSED') {
      const existing = await prisma.staffingRequirement.count({ where: { businessDayId: day.id } });
      if (existing === 0) {
        const drafts = expandTemplates(date, TEMPLATES[eventType]);
        await prisma.staffingRequirement.createMany({
          data: drafts.map((d) => ({ businessDayId: day.id, ...d })),
        });
      }
    }
  }
  console.log(`✓ 営業日 ${dates.length} 日(${start}〜${end})+ 必要人員`);
  return dates;
}

async function seedPeriodsAndPreferences(dates: string[]): Promise<void> {
  const today = toBusinessDate(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();

  const halves: Array<{ start: string; end: string }> = [];
  if (d <= 15) {
    halves.push({ start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15` });
    halves.push({ start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
  } else {
    halves.push({ start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    halves.push({ start: `${ny}-${pad(nm)}-01`, end: `${ny}-${pad(nm)}-15` });
  }

  for (const [i, half] of halves.entries()) {
    const existing = await prisma.shiftPeriod.findFirst({
      where: { periodStart: businessDateToDbValue(half.start), periodEnd: businessDateToDbValue(half.end) },
    });
    if (!existing) {
      const deadlineDate = addBusinessDays(half.start, -5);
      await prisma.shiftPeriod.create({
        data: {
          periodStart: businessDateToDbValue(half.start),
          periodEnd: businessDateToDbValue(half.end),
          preferenceDeadline: businessDateTimeToDate(deadlineDate, '23:59'),
          status: 'COLLECTING',
        },
      });
    }
    // 希望: 決定的な擬似乱数で ○ 65% / × 15% / 早番のみ 10% / 遅番のみ 10%
    const periodDates = dates.filter((x) => x >= half.start && x <= half.end);
    for (const s of STAFF) {
      for (const date of periodDates) {
        const r = hash(`${s.n}-${date}-pref`);
        const availability = r < 0.65 ? 'OK' : r < 0.8 ? 'NG' : r < 0.9 ? 'EARLY_ONLY' : 'LATE_ONLY';
        await prisma.shiftPreference.upsert({
          where: { staffId_businessDate: { staffId: id(s.n), businessDate: businessDateToDbValue(date) } },
          update: {},
          create: { staffId: id(s.n), businessDate: businessDateToDbValue(date), availability },
        });
      }
    }
    console.log(`✓ シフト期間 ${i + 1}: ${half.start}〜${half.end} + 希望`);
  }
}

async function seedLastMonthAttendance(): Promise<void> {
  const prevFirst = monthsAgo(1, 1);
  const py = prevFirst.getUTCFullYear();
  const pm = prevFirst.getUTCMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const days = new Date(Date.UTC(py, pm, 0)).getUTCDate();

  let created = 0;
  for (const s of STAFF) {
    if (s.role === 'MANAGER') continue;
    // 各スタッフ 8 営業日分。水〜日の中から決定的に選ぶ
    const candidates: string[] = [];
    for (let day = 1; day <= days; day++) {
      const date = `${py}-${pad(pm)}-${pad(day)}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow !== 1 && dow !== 2) candidates.push(date);
    }
    const picked = candidates.filter((date) => hash(`${s.n}-${date}-work`) < 0.45).slice(0, 8);
    for (const [i, date] of picked.entries()) {
      const isMinorShift = s.isMinor;
      const clockIn = businessDateTimeToDate(date, isMinorShift ? '18:00' : i === 0 ? '19:00' : '20:00');
      const clockOut = businessDateTimeToDate(date, isMinorShift ? '21:45' : i === 0 ? '04:00' : '04:00');
      // i === 0 は 9 時間・休憩未入力(自動控除 60 分のデモ)
      await prisma.timeRecord.upsert({
        where: { staffId_businessDate: { staffId: id(s.n), businessDate: businessDateToDbValue(date) } },
        update: {},
        create: {
          staffId: id(s.n),
          businessDate: businessDateToDbValue(date),
          clockIn,
          clockOut,
          breakMinutes: i === 0 || isMinorShift ? 0 : 30,
          approved: true,
          source: 'seed',
        },
      });
      created++;
    }
  }
  // 日払い 5,000 円(渡辺)とインセンティブ(鈴木)
  const advDate = `${py}-${pad(pm)}-10`;
  const advExists = await prisma.advancePayment.count({ where: { staffId: id(6) } });
  if (advExists === 0) {
    await prisma.advancePayment.create({
      data: { staffId: id(6), businessDate: businessDateToDbValue(advDate), amount: 5000, paidBy: '高橋 健', memo: 'シードデータ' },
    });
  }
  const incExists = await prisma.incentive.count({ where: { staffId: id(3) } });
  if (incExists === 0) {
    await prisma.incentive.create({
      data: { staffId: id(3), businessDate: businessDateToDbValue(advDate), kind: 'bottle_back', amount: 3000 },
    });
  }
  console.log(`✓ 前月(${py}-${pad(pm)})の勤怠 ${created} 件 + 日払い + インセンティブ`);
}

async function main(): Promise<void> {
  console.log('シードデータを投入します…');
  await seedSettings();
  await seedStaff();
  await seedTemplates();
  const dates = await seedBusinessDays();
  await seedPeriodsAndPreferences(dates);
  await seedLastMonthAttendance();
  console.log('完了。管理画面: http://localhost:3001/admin');
}

main()
  .catch((error) => {
    console.error('シードに失敗しました:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
