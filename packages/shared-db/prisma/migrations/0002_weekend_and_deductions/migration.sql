-- 週末営業(EventType.WEEKEND)と、給与の法定控除(社会保険・雇用保険・所得税)の追加

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'WEEKEND';

-- AlterTable
ALTER TABLE "Staff"
  ADD COLUMN "taxTableType" TEXT NOT NULL DEFAULT 'KOU',
  ADD COLUMN "dependentsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "socialInsuranceEnrolled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "careInsuranceApplicable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "employmentInsuranceEnrolled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "standardMonthlyRemuneration" INTEGER,
  ADD COLUMN "fixedIncomeTax" INTEGER;

-- 社員は社会保険・雇用保険に加入している前提の初期値(スタッフ画面で変更可)
UPDATE "Staff"
   SET "socialInsuranceEnrolled" = true,
       "employmentInsuranceEnrolled" = true
 WHERE "employmentType" = 'FULL_TIME';

-- AlterTable
ALTER TABLE "PayrollItem"
  ADD COLUMN "healthInsurance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "careInsurance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pensionInsurance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "employmentInsurance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "incomeTax" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "standardMonthlyRemuneration" INTEGER,
  ADD COLUMN "taxableIncome" INTEGER NOT NULL DEFAULT 0;
