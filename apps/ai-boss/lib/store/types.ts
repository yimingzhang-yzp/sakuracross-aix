/**
 * AI上司の永続化層インターフェース。
 *
 * 実装は 2 つ:
 *   - PrismaStore   … Supabase(DATABASE_URL 設定時)
 *   - InMemoryStore … DB 未設定のローカル開発・テスト・評価スクリプト(プロセス内メモリ)
 *
 * アプリのロジックはこのインターフェースだけに依存し、実 DB なしでも同じコードパスを動かせるようにする。
 */

export interface StaffRecord {
  id: string;
  lineUserId: string | null;
  authUserId: string | null;
  name: string;
  role: string;
  accessRole: 'ADMIN' | 'STAFF';
  isActive: boolean;
  hiredAt: Date | null;
  createdAt: Date;
}

export interface KnowledgeDocRecord {
  id: string;
  category: string;
  title: string;
  content: string;
  version: number;
  isActive: boolean;
  source: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeChunkRecord {
  id: string;
  docId: string;
  heading: string | null;
  content: string;
  chunkIndex: number;
}

/** 検索用に doc の情報を付けたチャンク */
export interface SearchableChunk extends KnowledgeChunkRecord {
  docTitle: string;
  docCategory: string;
}

export interface KnowledgeDocVersionRecord {
  id: string;
  docId: string;
  version: number;
  category: string;
  title: string;
  content: string;
  updatedBy: string;
  createdAt: Date;
}

export interface KnowledgeImportRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string | null;
  status: 'PENDING' | 'CONVERTING' | 'DRAFTED' | 'FAILED';
  category: string;
  draftDocId: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationRecord {
  id: string;
  staffId: string;
  createdAt: Date;
  lastMessageAt: Date;
  closedAt: Date | null;
}

export type MessageSender = 'staff' | 'ai' | 'manager';
export type MessageConfidence = 'high' | 'low' | 'no_answer' | 'emergency' | 'hr_redirect';

export interface MessageRecord {
  id: string;
  conversationId: string;
  sender: MessageSender;
  content: string;
  citedDocIds: string[];
  confidence: MessageConfidence | null;
  createdAt: Date;
}

export type EscalationStatus = 'OPEN' | 'ANSWERED' | 'ADDED_TO_KB';

export interface EscalationRecord {
  id: string;
  staffId: string;
  conversationId: string | null;
  question: string;
  status: EscalationStatus;
  managerAnswer: string | null;
  answeredBy: string | null;
  answeredAt: Date | null;
  deliveredAt: Date | null;
  addedDocId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JobStatusValue = 'PENDING' | 'PROCESSING' | 'FAILED' | 'DONE';

export interface JobRecord {
  id: string;
  kind: string;
  payload: unknown;
  status: JobStatusValue;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: Date;
  createdAt: Date;
}

export interface AuditEntry {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: unknown;
}

// --- 入力型 -----------------------------------------------------------------

export interface ChunkWriteInput {
  chunkIndex: number;
  heading: string | null;
  content: string;
}

export interface CreateDocInput {
  category: string;
  title: string;
  content: string;
  isActive: boolean;
  source: string;
  updatedBy: string;
}

export interface UpdateDocInput {
  category?: string;
  title?: string;
  content?: string;
  isActive?: boolean;
  updatedBy: string;
}

export interface AppendMessageInput {
  conversationId: string;
  sender: MessageSender;
  content: string;
  citedDocIds?: string[];
  confidence?: MessageConfidence | null;
  createdAt?: Date;
}

export interface CreateEscalationInput {
  staffId: string;
  conversationId: string | null;
  question: string;
}

export interface EscalationPatch {
  status?: EscalationStatus;
  managerAnswer?: string | null;
  answeredBy?: string | null;
  answeredAt?: Date | null;
  deliveredAt?: Date | null;
  addedDocId?: string | null;
}

export interface ConversationListFilter {
  /** 質問本文・回答本文・スタッフ名の部分一致 */
  query?: string;
  staffId?: string;
  /** この日時以降に更新された会話 */
  since?: Date;
  limit?: number;
  offset?: number;
}

export interface ConversationSummary extends ConversationRecord {
  staffName: string;
  messageCount: number;
  firstQuestion: string | null;
  /** エスカレーション・低確信度を含むか(一覧の目印) */
  hasEscalation: boolean;
}

export interface ConversationDetail extends ConversationRecord {
  staff: StaffRecord;
  messages: MessageRecord[];
}

export interface EscalationWithStaff extends EscalationRecord {
  staffName: string;
  staffLineUserId: string | null;
}

export interface DashboardStats {
  openTickets: number;
  activeDocs: number;
  draftDocs: number;
  conversationsLast24h: number;
  questionsLast24h: number;
  escalationsLast7d: number;
  provisionalStaff: number;
}

export interface CreateImportInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string | null;
  category: string;
  createdBy: string;
}

export interface ImportPatch {
  status?: KnowledgeImportRecord['status'];
  draftDocId?: string | null;
  lastError?: string | null;
  storagePath?: string | null;
}

// --- ストア本体 ---------------------------------------------------------------

export interface AiBossStore {
  readonly mode: 'memory' | 'prisma';

  // スタッフ
  findStaffByLineUserId(lineUserId: string): Promise<StaffRecord | null>;
  findStaffByAuthUserId(authUserId: string): Promise<StaffRecord | null>;
  findStaffById(id: string): Promise<StaffRecord | null>;
  /** LINE から初めて話しかけてきた未登録ユーザーの仮レコードを作る(ASSUMPTIONS.md 参照) */
  createProvisionalStaff(input: { lineUserId: string; displayName: string | null }): Promise<StaffRecord>;
  listStaff(filter?: { provisionalOnly?: boolean }): Promise<StaffRecord[]>;

  // ナレッジ
  listDocs(filter?: { category?: string; includeInactive?: boolean; query?: string }): Promise<KnowledgeDocRecord[]>;
  getDoc(id: string): Promise<KnowledgeDocRecord | null>;
  listChunks(docId: string): Promise<KnowledgeChunkRecord[]>;
  createDoc(input: CreateDocInput, chunks: ChunkWriteInput[]): Promise<KnowledgeDocRecord>;
  /** 本文が変わる場合は chunks を渡す。保存前の内容は KnowledgeDocVersion にスナップショットされる */
  updateDoc(id: string, input: UpdateDocInput, chunks?: ChunkWriteInput[]): Promise<KnowledgeDocRecord>;
  deleteDoc(id: string): Promise<void>;
  listDocVersions(docId: string): Promise<KnowledgeDocVersionRecord[]>;
  /** 検索対象(isActive=true)の全チャンク */
  listSearchableChunks(): Promise<SearchableChunk[]>;
  /** チャンクの更新世代(キャッシュ無効化用。ナレッジ保存ごとに増える) */
  knowledgeRevision(): Promise<number>;

  // 取込
  createImport(input: CreateImportInput): Promise<KnowledgeImportRecord>;
  updateImport(id: string, patch: ImportPatch): Promise<KnowledgeImportRecord>;
  listImports(limit?: number): Promise<KnowledgeImportRecord[]>;
  getImport(id: string): Promise<KnowledgeImportRecord | null>;

  // 会話
  findLatestConversation(staffId: string): Promise<ConversationRecord | null>;
  createConversation(staffId: string, at: Date): Promise<ConversationRecord>;
  closeConversation(id: string, at: Date): Promise<void>;
  touchConversation(id: string, at: Date): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<MessageRecord>;
  listMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  listConversations(filter?: ConversationListFilter): Promise<ConversationSummary[]>;
  countConversations(filter?: ConversationListFilter): Promise<number>;
  getConversation(id: string): Promise<ConversationDetail | null>;

  // エスカレーション
  createEscalation(input: CreateEscalationInput): Promise<EscalationRecord>;
  getEscalation(id: string): Promise<EscalationWithStaff | null>;
  listEscalations(filter?: { status?: EscalationStatus | 'ALL'; limit?: number }): Promise<EscalationWithStaff[]>;
  updateEscalation(id: string, patch: EscalationPatch): Promise<EscalationRecord>;

  // 設定 / 監査 / ジョブ
  getSetting(key: string): Promise<unknown | undefined>;
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
  enqueueJob(kind: string, payload: unknown, runAfter?: Date): Promise<JobRecord>;
  /** 実行時刻が来た PENDING ジョブを PROCESSING にして取り出す */
  claimDueJobs(kind: string, limit: number, now: Date): Promise<JobRecord[]>;
  completeJob(id: string): Promise<void>;
  failJob(id: string, error: string, nextRunAfter: Date | null): Promise<JobRecord>;
  listJobs(filter?: { status?: JobStatusValue; limit?: number }): Promise<JobRecord[]>;

  // 集計
  getDashboardStats(now: Date): Promise<DashboardStats>;
}
