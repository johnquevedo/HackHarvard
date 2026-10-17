import { z } from "zod";
import type {
  AgentT,
  ApprovalKindT,
  ApprovalT,
  ConsentScopeT,
  DecisionChannelT,
  InboundMessageT,
  IntegrationStatusT,
  IntentStatusT,
  IntentT,
  OpportunityT,
  OpportunityTypeT,
  OutboxRecordT,
  ProviderSendRequestT,
  ProviderSendResultT,
  SharedIntentViewT,
  UserT,
} from "./domain.ts";
import { RejectReason } from "./domain.ts";
import { NewEvent, DomainEvent } from "./events.ts";
import type { ParsedCommand } from "./commands.ts";
import type { A2ATypeT } from "./a2a.ts";
export interface Clock {
  now(): Date;
  nowIso(): string;
}
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
export interface Unsubscribe {
  (): void;
}
export interface Job<T> {
  (): Promise<T>;
}

// ---------- Messaging (owner A1, package @dennis/messaging) ----------
export interface InboundHandler {
  (msg: InboundMessageT): Promise<void>;
}
export interface MessagingProvider {
  readonly name: "photon" | "sim";
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(req: ProviderSendRequestT): Promise<ProviderSendResultT>;
  health(): Promise<IntegrationStatusT>;
}

// ---------- Banking (owner A2, package @dennis/purchasing) ----------
export interface BankAccountView {
  accountRef: string;
  label: string;
  last4: string;
  balanceCents: number;
  ownerKey: string;
}
export interface SeedBankingInput {
  members: { linkKey: string; displayName: string; startCents: number }[];
  poolStartCents: number;
  runTag: string;
}
export interface BankSeedResult {
  provider: "nessie" | "sim";
  accounts: BankAccountView[];
  created: number;
  reused: number;
}
export interface BankTransferRequest {
  fromAccountRef: string;
  toAccountRef: string;
  amountCents: number;
  memo: string; // must contain the payment attempt idempotency key
}
export interface BankTransferRecord {
  providerTransferId: string;
  fromAccountRef: string;
  toAccountRef: string;
  amountCents: number;
  status: string;
  memo: string | null;
  createdAt: string | null;
  raw: unknown;
}
export interface BankTransferResult {
  record: BankTransferRecord;
  mode: "live" | "simulated";
}
export interface BankingProvider {
  readonly name: "nessie" | "sim";
  ensureSeeded(input: SeedBankingInput): Promise<BankSeedResult>;
  getBalance(
    accountRef: string,
  ): Promise<{ accountRef: string; balanceCents: number; fetchedAt: string }>;
  listAccounts(): Promise<BankAccountView[]>;
  transfer(req: BankTransferRequest): Promise<BankTransferResult>;
  getTransfer(providerTransferId: string): Promise<BankTransferRecord | null>;
  findTransfersByMemo(accountRef: string, memoContains: string): Promise<BankTransferRecord[]>;
  health(): Promise<IntegrationStatusT>;
}

// ---------- LLM (owner A3, package @dennis/llm) ----------
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface StructuredRequest<T> {
  task: string; // for example "purchase_detector_v1"
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  traceId?: string;
}
export interface StructuredResult<T> {
  value: T;
  usage: LlmUsage;
  model: string;
  provider: "anthropic" | "chalk_gateway" | "mock";
  latencyMs: number;
  attempts: number;
}
export interface StructuredLlm {
  readonly name: "anthropic" | "chalk_gateway" | "mock";
  generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  health(): Promise<IntegrationStatusT>;
}

// ---------- Detectors (interface: A1; implementations: A2 purchase, A3 milestone) ----------
export interface DetectorInput {
  agentId: string;
  userId: string;
  messageId: string;
  text: string;
  receivedAt: string;
  recentContext: string[]; // up to 3 earlier authorized messages from the same user
  regionCode: string;
  enabledCategories: string[];
}
export interface DetectorDeps {
  llm: StructuredLlm;
  clock: Clock;
  log: Logger;
}
export interface Detection {
  kind: "purchase" | "milestone";
  confidence: number;
  rationale: string;
  privatePayload: Record<string, unknown>; // validated against PurchaseIntentPrivate or MilestonePrivate
  publicPayload: Record<string, unknown> | null; // validated against PurchaseIntentPublic, else null
  summary: string; // one short line for the private lane
}
export interface DetectorOutcome {
  detections: Detection[];
  rejected: { reason: z.infer<typeof RejectReason>; detail: string }[];
  llm: { provider: string; model: string; latencyMs: number } | null;
}
export interface Detector {
  readonly id: "purchase" | "milestone";
  readonly intentKind: "purchase" | "milestone";
  detect(input: DetectorInput, deps: DetectorDeps): Promise<DetectorOutcome>;
}
export interface DetectionHandler {
  (input: { intent: IntentT; agent: AgentT }): Promise<void>;
}
export interface DetectorRegistry {
  register(detector: Detector): void;
  list(): Detector[];
  onDetection(kind: "purchase" | "milestone", handler: DetectionHandler): void;
  handlersFor(kind: "purchase" | "milestone"): DetectionHandler[];
}

// ---------- Platform services (owner A1, package @dennis/platform) ----------
export interface EventBus {
  emit(e: z.infer<typeof NewEvent>): z.infer<typeof DomainEvent>;
  subscribe(
    filter: { viewerAgentId?: string; judge?: boolean },
    listener: EventListener,
  ): Unsubscribe;
  history(q: {
    sinceSeq?: number;
    limit?: number;
    viewerAgentId?: string;
    judge?: boolean;
  }): z.infer<typeof DomainEvent>[];
}
export interface EventListener {
  (e: z.infer<typeof DomainEvent>): void;
}

export interface ConsentService {
  has(userId: string, scope: ConsentScopeT): Promise<boolean>;
  require(userId: string, scope: ConsentScopeT): Promise<void>; // throws DennisError("consent_required")
  set(input: {
    userId: string;
    scope: ConsentScopeT;
    granted: boolean;
    via: "imessage" | "dashboard" | "seed_demo" | "sim_phone";
  }): Promise<void>;
  onRevoked(handler: ConsentRevokedHandler): void;
}
export interface ConsentRevokedHandler {
  (userId: string, scope: ConsentScopeT): Promise<void>;
}

export interface ApprovalRequestInput {
  kind: ApprovalKindT;
  userId: string;
  agentId: string;
  opportunityId?: string;
  payload: Record<string, unknown>; // EXACTLY what the user is approving
  promptText: string; // contains the literal token {code}
  ttlMinutes: number;
  idempotencyKey: string;
}
export interface ApprovalService {
  request(input: ApprovalRequestInput): Promise<ApprovalT>; // creates, queues the notification, emits events
  decide(input: {
    approvalId: string;
    userId: string;
    decision: "approve" | "decline";
    via: DecisionChannelT;
  }): Promise<ApprovalT>;
  get(approvalId: string): Promise<ApprovalT | null>;
  findPending(userId: string, code: string | null): Promise<ApprovalT[]>;
  // Throws DennisError("approval_invalid") unless approved, unexpired, unconsumed, same user, same kind, same payload hash.
  assertApproved(input: {
    approvalId: string;
    userId: string;
    kind: ApprovalKindT;
    payloadHash: string;
  }): Promise<ApprovalT>;
  consumeInTransaction(approvalId: string, tx: unknown): void; // CR-A2-001: synchronous, inside the caller transaction.
  consume(approvalId: string): Promise<void>; // call inside the same DB transaction as the guarded action
  onDecided(kind: ApprovalKindT, handler: ApprovalDecidedHandler): void;
  expireDue(): Promise<number>;
}
export interface ApprovalDecidedHandler {
  (approval: ApprovalT): Promise<void>;
}
export { hashPayload } from "./hash.ts";

export interface NotifyRequest {
  userId: string;
  kind: "info" | "approval_request" | "result" | "invite";
  text: string;
  approvalId?: string;
  opportunityId?: string;
  idempotencyKey: string;
}
export interface Notifier {
  send(req: NotifyRequest): Promise<OutboxRecordT>;
}

export interface A2ASendInput {
  type: A2ATypeT;
  fromAgentId: string;
  toAgentId: string;
  conversationId: string;
  opportunityId?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}
export interface A2AMessage {
  id: string;
  type: A2ATypeT;
  fromAgentId: string;
  toAgentId: string;
  conversationId: string;
  opportunityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface A2AHandler {
  (msg: A2AMessage): Promise<void>;
}
export interface A2ABus {
  send(input: A2ASendInput): Promise<A2AMessage>; // validates payload, persists, emits a2a.sent, schedules delivery
  on(type: A2ATypeT, handler: A2AHandler): void; // handler runs serialized per receiving agent
  listConversation(conversationId: string): Promise<A2AMessage[]>;
}

export interface NewIntent {
  agentId: string;
  userId: string;
  kind: "purchase" | "milestone";
  sourceMessageId: string | null;
  privatePayload: Record<string, unknown>;
  publicPayload: Record<string, unknown> | null;
  confidence: number;
  rationale: string;
  expiresAt?: string;
}
export interface IntentStore {
  create(input: NewIntent): Promise<IntentT>;
  get(id: string): Promise<IntentT | null>;
  listByAgent(
    agentId: string,
    filter?: { kind?: "purchase" | "milestone"; status?: IntentStatusT },
  ): Promise<IntentT[]>;
  listShared(filter: {
    kind: "purchase" | "milestone";
    excludeAgentId: string;
  }): Promise<SharedIntentViewT[]>;
  markShared(id: string): Promise<IntentT>;
  setStatus(id: string, status: IntentStatusT, reason?: string): Promise<IntentT>;
  revoke(id: string, by: { userId: string }): Promise<IntentT>; // clears shared flag, emits intent.revoked
}
export interface UpsertOpportunity {
  type: OpportunityTypeT;
  domainRefId: string;
  status: string;
  headline: string;
  participantAgentIds: string[];
}
export interface OpportunityStore {
  upsert(input: UpsertOpportunity): Promise<OpportunityT>; // emits opportunity.updated
  get(id: string): Promise<OpportunityT | null>;
  list(filter?: {
    type?: OpportunityTypeT;
    viewerAgentId?: string;
    limit?: number;
  }): Promise<OpportunityT[]>;
}
export interface UserDirectory {
  getByHandle(handle: string): Promise<UserT | null>;
  get(userId: string): Promise<UserT | null>;
  getAgentByUserId(userId: string): Promise<AgentT | null>;
  getAgent(agentId: string): Promise<AgentT | null>;
  listFriends(userId: string, opts?: { canInvite?: boolean }): Promise<UserT[]>;
}
export interface CommandInput {
  userId: string;
  agentId: string;
  command: ParsedCommand;
  messageId: string;
}
export interface CommandHandler {
  (input: CommandInput): Promise<{ reply?: string }>;
}
export interface CommandRegistry {
  register(kind: "back" | "fade" | "pass", handler: CommandHandler): void;
}
export interface IntegrationRegistry {
  report(status: IntegrationStatusT): void; // emits integration.status when mode or health changes
  list(): IntegrationStatusT[];
}
