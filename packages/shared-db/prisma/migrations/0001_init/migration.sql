-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('RECEPTION', 'BARTENDER', 'BARBACK', 'FLOOR_VIP', 'CLOAK', 'SECURITY', 'MANAGER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PART_TIME', 'FULL_TIME', 'CONTRACT');

-- CreateEnum
CREATE TYPE "AccessRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('NORMAL', 'BIG_EVENT', 'RENTAL', 'CLOSED');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('OK', 'NG', 'EARLY_ONLY', 'LATE_ONLY');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'ABSENT');

-- CreateEnum
CREATE TYPE "OpenShiftStatus" AS ENUM ('OPEN', 'FILLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('NEEDS_REVIEW', 'APPROVED', 'SCHEDULED', 'PAID', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'DONE');

-- CreateEnum
CREATE TYPE "LineChannel" AS ENUM ('STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT,
    "authUserId" TEXT,
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "role" "StaffRole" NOT NULL,
    "accessRole" "AccessRole" NOT NULL DEFAULT 'STAFF',
    "employmentType" "EmploymentType" NOT NULL,
    "hourlyWage" INTEGER NOT NULL,
    "monthlySalary" INTEGER,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "skills" JSONB,
    "hiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageHistory" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "hourlyWage" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineRegistrationRequest" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "nameInput" TEXT NOT NULL,
    "nameKanaInput" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "staffId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineRegistrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingTemplate" (
    "id" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "roleNeeded" "StaffRole" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPeriod" (
    "id" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "preferenceDeadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COLLECTING',
    "generatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "remindersSent" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDay" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "eventName" TEXT,
    "eventType" "EventType" NOT NULL DEFAULT 'NORMAL',
    "expectedCrowd" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingRequirement" (
    "id" TEXT NOT NULL,
    "businessDayId" TEXT NOT NULL,
    "roleNeeded" "StaffRole" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL,

    CONSTRAINT "StaffingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPreference" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "availability" "Availability" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "businessDayId" TEXT NOT NULL,
    "roleAssigned" "StaffRole" NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "notifiedSignature" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenShiftRequest" (
    "id" TEXT NOT NULL,
    "businessDayId" TEXT NOT NULL,
    "roleNeeded" "StaffRole" NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "OpenShiftStatus" NOT NULL DEFAULT 'OPEN',
    "filledByStaffId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'FIRST_COME',
    "notifiedStaffIds" TEXT[],
    "assignmentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenShiftRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenShiftApplication" (
    "id" TEXT NOT NULL,
    "openShiftRequestId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenShiftApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "requesterStaffId" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "acceptedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeRecord" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "editedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'LIFF',
    "clockInLocation" JSONB,
    "clockOutLocation" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeRecordCorrectionRequest" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "requestedClockIn" TIMESTAMP(3),
    "requestedClockOut" TIMESTAMP(3),
    "requestedBreakMinutes" INTEGER,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeRecordCorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePayment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidBy" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incentive" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "settingsSnapshot" JSONB,
    "warnings" TEXT[],
    "createdBy" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "payslipsSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "nightMinutes" INTEGER NOT NULL,
    "basePay" INTEGER NOT NULL,
    "nightPremiumPay" INTEGER NOT NULL,
    "incentivePay" INTEGER NOT NULL,
    "advanceDeduction" INTEGER NOT NULL,
    "grossPay" INTEGER NOT NULL,
    "netPay" INTEGER NOT NULL,
    "monthlySalary" INTEGER,
    "warnings" TEXT[],
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocVersion" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "chunkIndex" INTEGER NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "category" TEXT NOT NULL,
    "draftDocId" TEXT,
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citedDocIds" TEXT[],
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationTicket" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "conversationId" TEXT,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "managerAnswer" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "addedDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuiz" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "answerIdx" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizResult" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAliases" TEXT[],
    "registrationNo" TEXT,
    "bankInfo" TEXT,
    "paymentTerms" TEXT,
    "defaultPaymentMethod" TEXT,
    "knownEmails" TEXT[],
    "expectedMonthly" BOOLEAN NOT NULL DEFAULT false,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceIntake" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "emailFrom" TEXT,
    "emailSubject" TEXT,
    "unknownSender" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT true,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "vendorId" TEXT,
    "extracted" JSONB NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "dueDate" DATE,
    "dueDateSource" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "flags" TEXT[],
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "invoiceIds" TEXT[],
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "webhookEventId" TEXT NOT NULL,
    "channel" "LineChannel" NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("webhookEventId")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_lineUserId_key" ON "Staff"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_authUserId_key" ON "Staff"("authUserId");

-- CreateIndex
CREATE INDEX "Staff_isActive_role_idx" ON "Staff"("isActive", "role");

-- CreateIndex
CREATE INDEX "WageHistory_staffId_effectiveFrom_idx" ON "WageHistory"("staffId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LineRegistrationRequest_lineUserId_key" ON "LineRegistrationRequest"("lineUserId");

-- CreateIndex
CREATE INDEX "LineRegistrationRequest_status_createdAt_idx" ON "LineRegistrationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StaffingTemplate_eventType_idx" ON "StaffingTemplate"("eventType");

-- CreateIndex
CREATE INDEX "ShiftPeriod_periodStart_periodEnd_idx" ON "ShiftPeriod"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDay_businessDate_key" ON "BusinessDay"("businessDate");

-- CreateIndex
CREATE INDEX "StaffingRequirement_businessDayId_roleNeeded_idx" ON "StaffingRequirement"("businessDayId", "roleNeeded");

-- CreateIndex
CREATE INDEX "ShiftPreference_businessDate_idx" ON "ShiftPreference"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPreference_staffId_businessDate_key" ON "ShiftPreference"("staffId", "businessDate");

-- CreateIndex
CREATE INDEX "ShiftAssignment_staffId_status_idx" ON "ShiftAssignment"("staffId", "status");

-- CreateIndex
CREATE INDEX "ShiftAssignment_businessDayId_roleAssigned_idx" ON "ShiftAssignment"("businessDayId", "roleAssigned");

-- CreateIndex
CREATE INDEX "OpenShiftRequest_status_businessDayId_idx" ON "OpenShiftRequest"("status", "businessDayId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenShiftApplication_openShiftRequestId_staffId_key" ON "OpenShiftApplication"("openShiftRequestId", "staffId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_status_idx" ON "ShiftSwapRequest"("status");

-- CreateIndex
CREATE INDEX "TimeRecord_businessDate_approved_idx" ON "TimeRecord"("businessDate", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "TimeRecord_staffId_businessDate_key" ON "TimeRecord"("staffId", "businessDate");

-- CreateIndex
CREATE INDEX "TimeRecordCorrectionRequest_status_createdAt_idx" ON "TimeRecordCorrectionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TimeRecordCorrectionRequest_staffId_businessDate_idx" ON "TimeRecordCorrectionRequest"("staffId", "businessDate");

-- CreateIndex
CREATE INDEX "AdvancePayment_staffId_businessDate_idx" ON "AdvancePayment"("staffId", "businessDate");

-- CreateIndex
CREATE INDEX "Incentive_staffId_businessDate_idx" ON "Incentive"("staffId", "businessDate");

-- CreateIndex
CREATE INDEX "PayrollRun_periodStart_periodEnd_idx" ON "PayrollRun"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_payrollRunId_staffId_key" ON "PayrollItem"("payrollRunId", "staffId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_category_isActive_idx" ON "KnowledgeDoc"("category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocVersion_docId_version_key" ON "KnowledgeDocVersion"("docId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_docId_chunkIndex_key" ON "KnowledgeChunk"("docId", "chunkIndex");

-- CreateIndex
CREATE INDEX "KnowledgeImport_status_createdAt_idx" ON "KnowledgeImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_staffId_lastMessageAt_idx" ON "Conversation"("staffId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "EscalationTicket_status_createdAt_idx" ON "EscalationTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EscalationTicket_staffId_createdAt_idx" ON "EscalationTicket"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingQuiz_category_isActive_idx" ON "TrainingQuiz"("category", "isActive");

-- CreateIndex
CREATE INDEX "QuizResult_staffId_answeredAt_idx" ON "QuizResult"("staffId", "answeredAt");

-- CreateIndex
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "InvoiceIntake_status_receivedAt_idx" ON "InvoiceIntake"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_createdAt_idx" ON "Invoice"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_kind_sentAt_idx" ON "NotificationLog"("kind", "sentAt");

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_receivedAt_idx" ON "ProcessedWebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_kind_status_idx" ON "Job"("kind", "status");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "WageHistory" ADD CONSTRAINT "WageHistory_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineRegistrationRequest" ADD CONSTRAINT "LineRegistrationRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPreference" ADD CONSTRAINT "ShiftPreference_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftRequest" ADD CONSTRAINT "OpenShiftRequest_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftRequest" ADD CONSTRAINT "OpenShiftRequest_filledByStaffId_fkey" FOREIGN KEY ("filledByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftApplication" ADD CONSTRAINT "OpenShiftApplication_openShiftRequestId_fkey" FOREIGN KEY ("openShiftRequestId") REFERENCES "OpenShiftRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftApplication" ADD CONSTRAINT "OpenShiftApplication_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requesterStaffId_fkey" FOREIGN KEY ("requesterStaffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_acceptedByStaffId_fkey" FOREIGN KEY ("acceptedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeRecord" ADD CONSTRAINT "TimeRecord_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeRecordCorrectionRequest" ADD CONSTRAINT "TimeRecordCorrectionRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incentive" ADD CONSTRAINT "Incentive_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocVersion" ADD CONSTRAINT "KnowledgeDocVersion_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeImport" ADD CONSTRAINT "KnowledgeImport_draftDocId_fkey" FOREIGN KEY ("draftDocId") REFERENCES "KnowledgeDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationTicket" ADD CONSTRAINT "EscalationTicket_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizResult" ADD CONSTRAINT "QuizResult_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizResult" ADD CONSTRAINT "QuizResult_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "TrainingQuiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "InvoiceIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

