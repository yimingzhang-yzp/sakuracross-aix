/**
 * プロセス内メモリで完結するストア。DB 未設定時のローカル開発・テスト・評価スクリプト用。
 * 単一プロセス前提(Vercel などのサーバーレスでは使わない → getStore() が Prisma を選ぶ)。
 */
import { randomUUID } from 'node:crypto';

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
  MessageRecord,
  SearchableChunk,
  StaffRecord,
  UpdateDocInput,
} from './types';

export interface InMemoryStoreOptions {
  now?: () => Date;
}

export class InMemoryStore implements AiBossStore {
  readonly mode = 'memory' as const;

  readonly staff = new Map<string, StaffRecord>();
  readonly docs = new Map<string, KnowledgeDocRecord>();
  readonly chunks = new Map<string, KnowledgeChunkRecord[]>();
  readonly versions = new Map<string, KnowledgeDocVersionRecord[]>();
  readonly imports = new Map<string, KnowledgeImportRecord>();
  readonly conversations = new Map<string, ConversationRecord>();
  readonly messages = new Map<string, MessageRecord[]>();
  readonly escalations = new Map<string, EscalationRecord>();
  readonly settings = new Map<string, unknown>();
  readonly auditLog: (AuditEntry & { createdAt: Date })[] = [];
  readonly jobs = new Map<string, JobRecord>();
  private revision = 0;
  private readonly now: () => Date;

  constructor(options: InMemoryStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  // --- スタッフ ---------------------------------------------------------------

  async findStaffByLineUserId(lineUserId: string): Promise<StaffRecord | null> {
    for (const staff of this.staff.values()) if (staff.lineUserId === lineUserId) return staff;
    return null;
  }

  async findStaffByAuthUserId(authUserId: string): Promise<StaffRecord | null> {
    for (const staff of this.staff.values()) if (staff.authUserId === authUserId) return staff;
    return null;
  }

  async findStaffById(id: string): Promise<StaffRecord | null> {
    return this.staff.get(id) ?? null;
  }

  async createProvisionalStaff(input: { lineUserId: string; displayName: string | null }): Promise<StaffRecord> {
    const record: StaffRecord = {
      id: randomUUID(),
      lineUserId: input.lineUserId,
      authUserId: null,
      name: input.displayName?.trim() || `未登録スタッフ(${input.lineUserId.slice(-6)})`,
      role: 'FLOOR_VIP',
      accessRole: 'STAFF',
      isActive: false,
      hiredAt: null,
      createdAt: this.now(),
    };
    this.staff.set(record.id, record);
    return record;
  }

  async listStaff(filter: { provisionalOnly?: boolean } = {}): Promise<StaffRecord[]> {
    const list = [...this.staff.values()];
    return filter.provisionalOnly ? list.filter((s) => !s.isActive && s.lineUserId) : list;
  }

  /** テスト用: 登録済みスタッフを直接追加 */
  addStaff(partial: Partial<StaffRecord> & { name: string }): StaffRecord {
    const record: StaffRecord = {
      id: partial.id ?? randomUUID(),
      lineUserId: partial.lineUserId ?? null,
      authUserId: partial.authUserId ?? null,
      name: partial.name,
      role: partial.role ?? 'FLOOR_VIP',
      accessRole: partial.accessRole ?? 'STAFF',
      isActive: partial.isActive ?? true,
      hiredAt: partial.hiredAt ?? null,
      createdAt: partial.createdAt ?? this.now(),
    };
    this.staff.set(record.id, record);
    return record;
  }

  // --- ナレッジ ---------------------------------------------------------------

  async listDocs(filter: { category?: string; includeInactive?: boolean; query?: string } = {}): Promise<KnowledgeDocRecord[]> {
    const q = filter.query?.trim().toLowerCase();
    return [...this.docs.values()]
      .filter((d) => (filter.includeInactive ? true : d.isActive))
      .filter((d) => (filter.category ? d.category === filter.category : true))
      .filter((d) => (q ? d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q) : true))
      .sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.title.localeCompare(b.title, 'ja'));
  }

  async getDoc(id: string): Promise<KnowledgeDocRecord | null> {
    return this.docs.get(id) ?? null;
  }

  async listChunks(docId: string): Promise<KnowledgeChunkRecord[]> {
    return [...(this.chunks.get(docId) ?? [])];
  }

  async createDoc(input: CreateDocInput, chunks: ChunkWriteInput[]): Promise<KnowledgeDocRecord> {
    const at = this.now();
    const record: KnowledgeDocRecord = {
      id: randomUUID(),
      category: input.category,
      title: input.title,
      content: input.content,
      version: 1,
      isActive: input.isActive,
      source: input.source,
      updatedBy: input.updatedBy,
      createdAt: at,
      updatedAt: at,
    };
    this.docs.set(record.id, record);
    this.chunks.set(record.id, chunks.map((c) => ({ id: randomUUID(), docId: record.id, ...c })));
    this.revision += 1;
    return record;
  }

  async updateDoc(id: string, input: UpdateDocInput, chunks?: ChunkWriteInput[]): Promise<KnowledgeDocRecord> {
    const current = this.docs.get(id);
    if (!current) throw new Error(`KnowledgeDoc が見つかりません: ${id}`);
    const contentChanged = input.content !== undefined && input.content !== current.content;
    const titleChanged = input.title !== undefined && input.title !== current.title;
    const categoryChanged = input.category !== undefined && input.category !== current.category;
    let version = current.version;
    if (contentChanged || titleChanged || categoryChanged) {
      const list = this.versions.get(id) ?? [];
      list.push({
        id: randomUUID(),
        docId: id,
        version: current.version,
        category: current.category,
        title: current.title,
        content: current.content,
        updatedBy: current.updatedBy,
        createdAt: current.updatedAt,
      });
      this.versions.set(id, list);
      version += 1;
    }
    const updated: KnowledgeDocRecord = {
      ...current,
      category: input.category ?? current.category,
      title: input.title ?? current.title,
      content: input.content ?? current.content,
      isActive: input.isActive ?? current.isActive,
      updatedBy: input.updatedBy,
      version,
      updatedAt: this.now(),
    };
    this.docs.set(id, updated);
    if (chunks) this.chunks.set(id, chunks.map((c) => ({ id: randomUUID(), docId: id, ...c })));
    this.revision += 1;
    return updated;
  }

  async deleteDoc(id: string): Promise<void> {
    this.docs.delete(id);
    this.chunks.delete(id);
    this.versions.delete(id);
    this.revision += 1;
  }

  async listDocVersions(docId: string): Promise<KnowledgeDocVersionRecord[]> {
    return [...(this.versions.get(docId) ?? [])].sort((a, b) => b.version - a.version);
  }

  async listSearchableChunks(): Promise<SearchableChunk[]> {
    const result: SearchableChunk[] = [];
    for (const doc of this.docs.values()) {
      if (!doc.isActive) continue;
      for (const chunk of this.chunks.get(doc.id) ?? []) {
        result.push({ ...chunk, docTitle: doc.title, docCategory: doc.category });
      }
    }
    return result;
  }

  async knowledgeRevision(): Promise<number> {
    return this.revision;
  }

  // --- 取込 -------------------------------------------------------------------

  async createImport(input: CreateImportInput): Promise<KnowledgeImportRecord> {
    const at = this.now();
    const record: KnowledgeImportRecord = {
      id: randomUUID(),
      ...input,
      status: 'PENDING',
      draftDocId: null,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    };
    this.imports.set(record.id, record);
    return record;
  }

  async updateImport(id: string, patch: ImportPatch): Promise<KnowledgeImportRecord> {
    const current = this.imports.get(id);
    if (!current) throw new Error(`KnowledgeImport が見つかりません: ${id}`);
    const updated = { ...current, ...stripUndefined(patch), updatedAt: this.now() } as KnowledgeImportRecord;
    this.imports.set(id, updated);
    return updated;
  }

  async listImports(limit = 50): Promise<KnowledgeImportRecord[]> {
    return [...this.imports.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  async getImport(id: string): Promise<KnowledgeImportRecord | null> {
    return this.imports.get(id) ?? null;
  }

  // --- 会話 -------------------------------------------------------------------

  async findLatestConversation(staffId: string): Promise<ConversationRecord | null> {
    let latest: ConversationRecord | null = null;
    for (const c of this.conversations.values()) {
      if (c.staffId !== staffId) continue;
      if (!latest || c.lastMessageAt > latest.lastMessageAt) latest = c;
    }
    return latest;
  }

  async createConversation(staffId: string, at: Date): Promise<ConversationRecord> {
    const record: ConversationRecord = { id: randomUUID(), staffId, createdAt: at, lastMessageAt: at, closedAt: null };
    this.conversations.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  async closeConversation(id: string, at: Date): Promise<void> {
    const c = this.conversations.get(id);
    if (c && !c.closedAt) this.conversations.set(id, { ...c, closedAt: at });
  }

  async touchConversation(id: string, at: Date): Promise<void> {
    const c = this.conversations.get(id);
    // 古い時刻で上書きしない(店長回答の追記などで順序が入れ替わっても最終時刻は最大値を保つ)
    if (c && at > c.lastMessageAt) this.conversations.set(id, { ...c, lastMessageAt: at });
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const list = this.messages.get(input.conversationId);
    if (!list) throw new Error(`Conversation が見つかりません: ${input.conversationId}`);
    const record: MessageRecord = {
      id: randomUUID(),
      conversationId: input.conversationId,
      sender: input.sender,
      content: input.content,
      citedDocIds: input.citedDocIds ?? [],
      confidence: input.confidence ?? null,
      createdAt: input.createdAt ?? this.now(),
    };
    list.push(record);
    await this.touchConversation(input.conversationId, record.createdAt);
    return record;
  }

  async listMessages(conversationId: string, limit?: number): Promise<MessageRecord[]> {
    const list = [...(this.messages.get(conversationId) ?? [])].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    return limit ? list.slice(-limit) : list;
  }

  private matchesFilter(c: ConversationRecord, filter: ConversationListFilter): boolean {
    if (filter.staffId && c.staffId !== filter.staffId) return false;
    if (filter.since && c.lastMessageAt < filter.since) return false;
    if (filter.query) {
      const q = filter.query.toLowerCase();
      const staffName = this.staff.get(c.staffId)?.name.toLowerCase() ?? '';
      const hit =
        staffName.includes(q) || (this.messages.get(c.id) ?? []).some((m) => m.content.toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  }

  async listConversations(filter: ConversationListFilter = {}): Promise<ConversationSummary[]> {
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    return [...this.conversations.values()]
      .filter((c) => this.matchesFilter(c, filter))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(offset, offset + limit)
      .map((c) => {
        const msgs = this.messages.get(c.id) ?? [];
        return {
          ...c,
          staffName: this.staff.get(c.staffId)?.name ?? '(不明)',
          messageCount: msgs.length,
          firstQuestion: msgs.find((m) => m.sender === 'staff')?.content ?? null,
          hasEscalation: msgs.some((m) => m.confidence === 'no_answer' || m.confidence === 'low'),
        };
      });
  }

  async countConversations(filter: ConversationListFilter = {}): Promise<number> {
    return [...this.conversations.values()].filter((c) => this.matchesFilter(c, filter)).length;
  }

  async getConversation(id: string): Promise<ConversationDetail | null> {
    const c = this.conversations.get(id);
    if (!c) return null;
    const staff = this.staff.get(c.staffId);
    if (!staff) return null;
    return { ...c, staff, messages: await this.listMessages(id) };
  }

  // --- エスカレーション ------------------------------------------------------------

  async createEscalation(input: CreateEscalationInput): Promise<EscalationRecord> {
    const at = this.now();
    const record: EscalationRecord = {
      id: randomUUID(),
      staffId: input.staffId,
      conversationId: input.conversationId,
      question: input.question,
      status: 'OPEN',
      managerAnswer: null,
      answeredBy: null,
      answeredAt: null,
      deliveredAt: null,
      addedDocId: null,
      createdAt: at,
      updatedAt: at,
    };
    this.escalations.set(record.id, record);
    return record;
  }

  private withStaff(e: EscalationRecord): EscalationWithStaff {
    const staff = this.staff.get(e.staffId);
    return { ...e, staffName: staff?.name ?? '(不明)', staffLineUserId: staff?.lineUserId ?? null };
  }

  async getEscalation(id: string): Promise<EscalationWithStaff | null> {
    const e = this.escalations.get(id);
    return e ? this.withStaff(e) : null;
  }

  async listEscalations(filter: { status?: EscalationStatus | 'ALL'; limit?: number } = {}): Promise<EscalationWithStaff[]> {
    const status = filter.status ?? 'OPEN';
    return [...this.escalations.values()]
      .filter((e) => status === 'ALL' || e.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit ?? 100)
      .map((e) => this.withStaff(e));
  }

  async updateEscalation(id: string, patch: EscalationPatch): Promise<EscalationRecord> {
    const current = this.escalations.get(id);
    if (!current) throw new Error(`EscalationTicket が見つかりません: ${id}`);
    const updated = { ...current, ...stripUndefined(patch), updatedAt: this.now() } as EscalationRecord;
    this.escalations.set(id, updated);
    return updated;
  }

  // --- 設定 / 監査 / ジョブ ------------------------------------------------------

  async getSetting(key: string): Promise<unknown | undefined> {
    return this.settings.get(key);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value);
  }

  async audit(entry: AuditEntry): Promise<void> {
    this.auditLog.push({ ...entry, createdAt: this.now() });
  }

  async enqueueJob(kind: string, payload: unknown, runAfter?: Date): Promise<JobRecord> {
    const at = this.now();
    const record: JobRecord = {
      id: randomUUID(),
      kind,
      payload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      runAfter: runAfter ?? at,
      createdAt: at,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  async claimDueJobs(kind: string, limit: number, now: Date): Promise<JobRecord[]> {
    const due = [...this.jobs.values()]
      .filter((j) => j.kind === kind && j.status === 'PENDING' && j.runAfter <= now)
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())
      .slice(0, limit);
    return due.map((j) => {
      const claimed: JobRecord = { ...j, status: 'PROCESSING', attempts: j.attempts + 1 };
      this.jobs.set(j.id, claimed);
      return claimed;
    });
  }

  async completeJob(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, status: 'DONE' });
  }

  async failJob(id: string, error: string, nextRunAfter: Date | null): Promise<JobRecord> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`Job が見つかりません: ${id}`);
    const updated: JobRecord = nextRunAfter
      ? { ...j, status: 'PENDING', lastError: error, runAfter: nextRunAfter }
      : { ...j, status: 'FAILED', lastError: error };
    this.jobs.set(id, updated);
    return updated;
  }

  async listJobs(filter: { status?: JobStatusValue; limit?: number } = {}): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => (filter.status ? j.status === filter.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit ?? 100);
  }

  // --- 集計 -------------------------------------------------------------------

  async getDashboardStats(now: Date): Promise<DashboardStats> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let questionsLast24h = 0;
    for (const list of this.messages.values()) {
      questionsLast24h += list.filter((m) => m.sender === 'staff' && m.createdAt >= dayAgo).length;
    }
    return {
      openTickets: [...this.escalations.values()].filter((e) => e.status === 'OPEN').length,
      activeDocs: [...this.docs.values()].filter((d) => d.isActive).length,
      draftDocs: [...this.docs.values()].filter((d) => !d.isActive).length,
      conversationsLast24h: [...this.conversations.values()].filter((c) => c.lastMessageAt >= dayAgo).length,
      questionsLast24h,
      escalationsLast7d: [...this.escalations.values()].filter((e) => e.createdAt >= weekAgo).length,
      provisionalStaff: [...this.staff.values()].filter((s) => !s.isActive && s.lineUserId).length,
    };
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
