import prismaPkg from '@prisma/client';

export { getPrisma, disconnectPrisma, isDatabaseConfigured } from './client.js';
export type { PrismaClientInstance } from './client.js';
export { pingDatabase } from './health.js';
export type { DatabaseHealth, DatabaseHealthStatus, PingDatabaseOptions } from './health.js';
export { getSupabaseEnv, isSupabaseConfigured, getSupabaseAdmin, createSupabaseAnonClient } from './supabase.js';
export type { SupabaseEnv } from './supabase.js';

// Prisma が生成する型(モデル型・入力型・enum 型)をそのまま再エクスポート
export type * from '@prisma/client';

// enum の実行時値(CJS からの named import は ESM で解決できないため default 経由で取り出す)
// Prisma 名前空間(型)は export type * で再エクスポートされる。実行時の値(Prisma.JsonNull 等)が必要なら @prisma/client から default import する
export const StaffRole = prismaPkg.StaffRole;
export const EmploymentType = prismaPkg.EmploymentType;
export const AccessRole = prismaPkg.AccessRole;
export const EventType = prismaPkg.EventType;
export const Availability = prismaPkg.Availability;
export const ShiftStatus = prismaPkg.ShiftStatus;
export const OpenShiftStatus = prismaPkg.OpenShiftStatus;
export const InvoiceStatus = prismaPkg.InvoiceStatus;
export const JobStatus = prismaPkg.JobStatus;
export const LineChannel = prismaPkg.LineChannel;
