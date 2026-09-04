/**
 * Prisma(Supabase PostgreSQL)実装。`@sakura-cross/shared-db` の統合スキーマを使う。
 */
import type { Prisma } from '@prisma/client';
import type { PrismaClientInstance } from '@sakura-cross/shared-db';

import type {
  AiBossStore,
  AppendMessageInput,
  AuditEntry,
  ChunkWriteInput,
  ConversationDetail,
  ConversationListFilter,
  ConversationRecord,
  ConversationSummary,
  CreateDocInput,
  CreateEscalationInput,
  CreateImportInput,
  DashboardStats,
  EscalationPatch,
  EscalationRecord,
  EscalationStatus,
  EscalationWithStaff,
  ImportPatch,
  JobRecord,
  JobStatusValue,
  KnowledgeChunkRecord,
  KnowledgeDocRecord,
  KnowledgeDocVersionRecord,
  KnowledgeImportRecord,
  MessageConfidence,
  MessageRecord,
  MessageSender,
  SearchableChunk,
  StaffRecord,
  UpdateDocInput,
} from './types';

const KNOWLEDGE_REVISION_KEY = 'ai-boss.knowledge_revision';

type StaffRow = {
  id: string;
  lineUserId: string | null;
  authUserId: string | null;
  name: string;
  role: string;
  accessRole: 'ADMIN' | 'STAFF';
  isActive: boolean;
  hiredAt: Date | null;
  createdAt: Date;
};

const staffSelect = {
  id: true,
  lineUserId: true,
  authUserId: true,
  name: true,
  role: true,
  accessRole: true,
  isActive: true,
  hiredAt: true,
  createdAt: true,
} as const;

function toStaff(row: StaffRow): StaffRecord {
  return { ...row, role: String(row.role) };
}

function toMessage(row: {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  citedDocIds: string[];
  confidence: string | null;
  createdAt: Date;
}): MessageRecord {
  return {
    ...row,
    sender: row.sender as MessageSender,
    confidence: (row.confidence as MessageConfidence | null) ?? null,
  };
}

function toEscalation(row: {
  id: string;
  staffId: string;
  conversationId: string | null;
  question: string;
  status: string;
  managerAnswer: string | null;
  answeredBy: string | null;
  answeredAt: Date | null;
  deliveredAt: Date | null;
  addedDocId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EscalationRecord {
  return { ...row, status: row.status as EscalationStatus };
}

function toImport(row: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string | null;
  status: string;
  category: string;
  draftDocId: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeImportRecord {
  return { ...row, status: row.status as KnowledgeImportRecord['status'] };
}

function toJob(row: {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: Date;
  createdAt: Date;
}): JobRecord {
  return { ...row, status: row.status as JobStatusValue };
}

export class PrismaStore implements AiBossStore {
  readonly mode = 'prisma' as const;

  constructor(private readonly prisma: PrismaClientInstance) {}

  // --- スタッフ ---------------------------------------------------------------

  async findStaffByLineUserId(lineUserId: string): Promise<StaffRecord | null> {
    const row = await this.prisma.staff.findUnique({ where: { lineUserId }, select: staffSelect });
    return row ? toStaff(row) : null;
  }

  async findStaffByAuthUserId(authUserId: string): Promise<StaffRecord | null> {
    const row = await this.prisma.staff.findUnique({ where: { authUserId }, select: staffSelect });
    return row ? toStaff(row) : null;
  }

  async findStaffById(id: string): Promise<StaffRecord | null> {
    const row = await this.prisma.staff.findUnique({ where: { id }, select: staffSelect });
    return row ? toStaff(row) : null;
  }

  async createProvisionalStaff(input: { lineUserId: string; displayName: string | null }): Promise<StaffRecord> {
    const row = await this.prisma.staff.create({
      data: {
        lineUserId: input.lineUserId,
        name: input.displayName?.trim() || `未登録スタッフ(${input.lineUserId.slice(-6)})`,
        role: 'FLOOR_VIP',
        accessRole: 'STAFF',
        employmentType: 'PART_TIME',
        hourlyWage: 0,
        isActive: false,
      },
      select: staffSelect,
    });
    return toStaff(row);
  }

  async listStaff(filter: { provisionalOnly?: boolean } = {}): Promise<StaffRecord[]> {
    const rows = await this.prisma.staff.findMany({
      where: filter.provisionalOnly ? { isActive: false, lineUserId: { not: null } } : undefined,
      select: staffSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toStaff);
  }

  // --- ナレッジ ---------------------------------------------------------------

  async listDocs(filter: { category?: string; includeInactive?: boolean; query?: string } = {}): Promise<KnowledgeDocRecord[]> {
    const q = filter.query?.trim();
    return this.prisma.knowledgeDoc.findMany({
      where: {
        ...(filter.includeInactive ? {} : { isActive: true }),
        ...(filter.category ? { category: filter.category } : {}),
        ...(q
          ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
  }

  async getDoc(id: string): Promise<KnowledgeDocRecord | null> {
    return this.prisma.knowledgeDoc.findUnique({ where: { id } });
  }

  async listChunks(docId: string): Promise<KnowledgeChunkRecord[]> {
    return this.prisma.knowledgeChunk.findMany({
      where: { docId },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, docId: true, heading: true, content: true, chunkIndex: true },
    });
  }

  async createDoc(input: CreateDocInput, chunks: ChunkWriteInput[]): Promise<KnowledgeDocRecord> {
    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeDoc.create({ data: { ...input } });
      if (chunks.length > 0) {
        await tx.knowledgeChunk.createMany({ data: chunks.map((c) => ({ docId: created.id, ...c })) });
      }
      await this.bumpRevision(tx);
      return created;
    });
    return doc;
  }

  async updateDoc(id: string, input: UpdateDocInput, chunks?: ChunkWriteInput[]): Promise<KnowledgeDocRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.knowledgeDoc.findUniqueOrThrow({ where: { id } });
      const changed =
        (input.content !== undefined && input.content !== current.content) ||
        (input.title !== undefined && input.title !== current.title) ||
        (input.category !== undefined && input.category !== current.category);
      if (changed) {
        await tx.knowledgeDocVersion.create({
          data: {
            docId: id,
            version: current.version,
            category: current.category,
            title: current.title,
            content: current.content,
            updatedBy: current.updatedBy,
            createdAt: current.updatedAt,
          },
        });
      }
      const updated = await tx.knowledgeDoc.update({
        where: { id },
        data: {
          category: input.category,
          title: input.title,
          content: input.content,
          isActive: input.isActive,
          updatedBy: input.updatedBy,
          version: changed ? current.version + 1 : current.version,
        },
      });
      if (chunks) {
        await tx.knowledgeChunk.deleteMany({ where: { docId: id } });
        if (chunks.length > 0) {
          await tx.knowledgeChunk.createMany({ data: chunks.map((c) => ({ docId: id, ...c })) });
        }
      }
      await this.bumpRevision(tx);
      return updated;
    });
  }

  async deleteDoc(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeDoc.delete({ where: { id } });
      await this.bumpRevision(tx);
    });
  }

  async listDocVersions(docId: string): Promise<KnowledgeDocVersionRecord[]> {
    return this.prisma.knowledgeDocVersion.findMany({ where: { docId }, orderBy: { version: 'desc' } });
  }

  async listSearchableChunks(): Promise<SearchableChunk[]> {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { doc: { isActive: true } },
      select: {
        id: true,
        docId: true,
        heading: true,
        content: true,
        chunkIndex: true,
        doc: { select: { title: true, category: true } },
      },
      orderBy: [{ docId: 'asc' }, { chunkIndex: 'asc' }],
    });
    return rows.map(({ doc, ...chunk }) => ({ ...chunk, docTitle: doc.title, docCategory: doc.category }));
  }

  async knowledgeRevision(): Promise<number> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: KNOWLEDGE_REVISION_KEY } });
    return typeof row?.value === 'number' ? row.value : 0;
  }

  private async bumpRevision(tx: Prisma.TransactionClient): Promise<void> {
    const row = await tx.appSetting.findUnique({ where: { key: KNOWLEDGE_REVISION_KEY } });
    const next = (typeof row?.value === 'number' ? row.value : 0) + 1;
    await tx.appSetting.upsert({
      where: { key: KNOWLEDGE_REVISION_KEY },
      create: { key: KNOWLEDGE_REVISION_KEY, value: next, description: 'ナレッジ更新世代(検索キャッシュ無効化用)' },
      update: { value: next },
    });
  }

  // --- 取込 -------------------------------------------------------------------

  async createImport(input: CreateImportInput): Promise<KnowledgeImportRecord> {
    return toImport(await this.prisma.knowledgeImport.create({ data: { ...input } }));
  }

  async updateImport(id: string, patch: ImportPatch): Promise<KnowledgeImportRecord> {
    return toImport(await this.prisma.knowledgeImport.update({ where: { id }, data: { ...patch } }));
  }

  async listImports(limit = 50): Promise<KnowledgeImportRecord[]> {
    const rows = await this.prisma.knowledgeImport.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toImport);
  }

  async getImport(id: string): Promise<KnowledgeImportRecord | null> {
    const row = await this.prisma.knowledgeImport.findUnique({ where: { id } });
    return row ? toImport(row) : null;
  }

  // --- 会話 -------------------------------------------------------------------

  async findLatestConversation(staffId: string): Promise<ConversationRecord | null> {
    return this.prisma.conversation.findFirst({ where: { staffId }, orderBy: { lastMessageAt: 'desc' } });
  }

  async createConversation(staffId: string, at: Date): Promise<ConversationRecord> {
    return this.prisma.conversation.create({ data: { staffId, createdAt: at, lastMessageAt: at } });
  }

  async closeConversation(id: string, at: Date): Promise<void> {
    await this.prisma.conversation.updateMany({ where: { id, closedAt: null }, data: { closedAt: at } });
  }

  async touchConversation(id: string, at: Date): Promise<void> {
    await this.prisma.conversation.update({ where: { id }, data: { lastMessageAt: at } });
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const createdAt = input.createdAt ?? new Date();
    const [row] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          sender: input.sender,
          content: input.content,
          citedDocIds: input.citedDocIds ?? [],
          confidence: input.confidence ?? null,
          createdAt,
        },
      }),
      this.prisma.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: createdAt } }),
    ]);
    return toMessage(row);
  }

  async listMessages(conversationId: string, limit?: number): Promise<MessageRecord[]> {
    if (limit) {
      const rows = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.reverse().map(toMessage);
    }
    const rows = await this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toMessage);
  }

  private conversationWhere(filter: ConversationListFilter): Prisma.ConversationWhereInput {
    const q = filter.query?.trim();
    return {
      ...(filter.staffId ? { staffId: filter.staffId } : {}),
      ...(filter.since ? { lastMessageAt: { gte: filter.since } } : {}),
      ...(q
        ? {
            OR: [
              { staff: { name: { contains: q, mode: 'insensitive' } } },
              { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
  }

  async listConversations(filter: ConversationListFilter = {}): Promise<ConversationSummary[]> {
    const rows = await this.prisma.conversation.findMany({
      where: this.conversationWhere(filter),
      orderBy: { lastMessageAt: 'desc' },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
      include: {
        staff: { select: { name: true } },
        messages: { select: { sender: true, content: true, confidence: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return rows.map(({ staff, messages, ...c }) => ({
      ...c,
      staffName: staff.name,
      messageCount: messages.length,
      firstQuestion: messages.find((m) => m.sender === 'staff')?.content ?? null,
      hasEscalation: messages.some((m) => m.confidence === 'no_answer' || m.confidence === 'low'),
    }));
  }

  async countConversations(filter: ConversationListFilter = {}): Promise<number> {
    return this.prisma.conversation.count({ where: this.conversationWhere(filter) });
  }

  async getConversation(id: string): Promise<ConversationDetail | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      include: { staff: { select: staffSelect }, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    const { staff, messages, ...c } = row;
    return { ...c, staff: toStaff(staff), messages: messages.map(toMessage) };
  }

  // --- エスカレーション ------------------------------------------------------------

  async createEscalation(input: CreateEscalationInput): Promise<EscalationRecord> {
    return toEscalation(await this.prisma.escalationTicket.create({ data: { ...input, status: 'OPEN' } }));
  }

  async getEscalation(id: string): Promise<EscalationWithStaff | null> {
    const row = await this.prisma.escalationTicket.findUnique({
      where: { id },
      include: { staff: { select: { name: true, lineUserId: true } } },
    });
    if (!row) return null;
    const { staff, ...e } = row;
    return { ...toEscalation(e), staffName: staff.name, staffLineUserId: staff.lineUserId };
  }

  async listEscalations(filter: { status?: EscalationStatus | 'ALL'; limit?: number } = {}): Promise<EscalationWithStaff[]> {
    const status = filter.status ?? 'OPEN';
    const rows = await this.prisma.escalationTicket.findMany({
      where: status === 'ALL' ? undefined : { status },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 100,
      include: { staff: { select: { name: true, lineUserId: true } } },
    });
    return rows.map(({ staff, ...e }) => ({ ...toEscalation(e), staffName: staff.name, staffLineUserId: staff.lineUserId }));
  }

  async updateEscalation(id: string, patch: EscalationPatch): Promise<EscalationRecord> {
    return toEscalation(await this.prisma.escalationTicket.update({ where: { id }, data: { ...patch } }));
  }

  // --- 設定 / 監査 / ジョブ ------------------------------------------------------

  async getSetting(key: string): Promise<unknown | undefined> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return row ? row.value : undefined;
  }

  async setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: json, updatedBy },
      update: { value: json, updatedBy },
    });
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        detail: entry.detail === undefined ? undefined : (entry.detail as Prisma.InputJsonValue),
      },
    });
  }

  async enqueueJob(kind: string, payload: unknown, runAfter?: Date): Promise<JobRecord> {
    const row = await this.prisma.job.create({
      data: { kind, payload: payload as Prisma.InputJsonValue, runAfter: runAfter ?? new Date() },
    });
    return toJob(row);
  }

  async claimDueJobs(kind: string, limit: number, now: Date): Promise<JobRecord[]> {
    // 楽観的に取得 → updateMany(status=PENDING 条件付き)で確保。同時実行でも同じジョブを二重に掴まない
    const candidates = await this.prisma.job.findMany({
      where: { kind, status: 'PENDING', runAfter: { lte: now } },
      orderBy: { runAfter: 'asc' },
      take: limit,
    });
    const claimed: JobRecord[] = [];
    for (const job of candidates) {
      const result = await this.prisma.job.updateMany({
        where: { id: job.id, status: 'PENDING' },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, lockedAt: now },
      });
      if (result.count === 1) {
        claimed.push(toJob({ ...job, status: 'PROCESSING', attempts: job.attempts + 1 }));
      }
    }
    return claimed;
  }

  async completeJob(id: string): Promise<void> {
    await this.prisma.job.update({ where: { id }, data: { status: 'DONE', lockedAt: null } });
  }

  async failJob(id: string, error: string, nextRunAfter: Date | null): Promise<JobRecord> {
    const row = await this.prisma.job.update({
      where: { id },
      data: nextRunAfter
        ? { status: 'PENDING', lastError: error, runAfter: nextRunAfter, lockedAt: null }
        : { status: 'FAILED', lastError: error, lockedAt: null },
    });
    return toJob(row);
  }

  async listJobs(filter: { status?: JobStatusValue; limit?: number } = {}): Promise<JobRecord[]> {
    const rows = await this.prisma.job.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 100,
    });
    return rows.map(toJob);
  }

  // --- 集計 -------------------------------------------------------------------

  async getDashboardStats(now: Date): Promise<DashboardStats> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [openTickets, activeDocs, draftDocs, conversationsLast24h, questionsLast24h, escalationsLast7d, provisionalStaff] =
      await Promise.all([
        this.prisma.escalationTicket.count({ where: { status: 'OPEN' } }),
        this.prisma.knowledgeDoc.count({ where: { isActive: true } }),
        this.prisma.knowledgeDoc.count({ where: { isActive: false } }),
        this.prisma.conversation.count({ where: { lastMessageAt: { gte: dayAgo } } }),
        this.prisma.message.count({ where: { sender: 'staff', createdAt: { gte: dayAgo } } }),
        this.prisma.escalationTicket.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.staff.count({ where: { isActive: false, lineUserId: { not: null } } }),
      ]);
    return { openTickets, activeDocs, draftDocs, conversationsLast24h, questionsLast24h, escalationsLast7d, provisionalStaff };
  }
}
