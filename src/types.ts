export type PipelineEventType =
  | 'PROMPT'
  | 'RETRIEVAL'
  | 'GENERATION'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'VALIDATION'
  | 'ROUTING'
  | 'MEMORY_READ'
  | 'MEMORY_WRITE'
  | 'SPAWN'
  | 'CUSTOM'
  | 'ANOMALY';


export interface EventMetadata {
  model?: string;
  provider?: string;
  latencyMs?: number;
  tokenCount?: number;
  tags?: string[];
}


export interface PipelineEvent {
  id: string;
  sessionId: string;
  sequenceIndex: number;
  type: PipelineEventType;
  payload: Record<string, any>;
  hash: string;
  timestamp: number;
  metadata?: EventMetadata;
}

export interface MerkleProof {
  leaf: string;
  root: string;
  sessionId: string;
  sequenceIndex: number;
  path: Array<{
    sibling: string;
    direction: 'left' | 'right';
  }>;
  anchorTransactionSignature?: string;
}

export interface ZKProof {
  proof: any;
  publicInputs: any[];
  claim: string;
  merkleRoot: string;
  eventHash: string;
  format: 'groth16' | 'plonk' | 'mock';
}

export interface ZKProofProvider {
  name: string;
  /**
   * Prove a claim about an event (e.g. tokenCount < 500) and its inclusion in a root.
   */
  prove(params: {
    event: PipelineEvent;
    merkleProof: MerkleProof;
    claim: string;
    merkleRoot: string;
  }): Promise<ZKProof>;

  /**
   * Verify the proof against public inputs.
   */
  verify(proof: ZKProof): Promise<boolean>;
}

export interface PersistenceAdapter {
  save(session: PartialSession): Promise<void>;
  load(sessionId: string): Promise<PartialSession | null>;
  delete(sessionId: string): Promise<void>;
}

export interface PartialSession {
  sessionId: string;
  pipelineId: string;
  events: PipelineEvent[];
  createdAt: number;
}

export interface AnchorResult {
  mode: 'managed' | 'direct';
  transactionSignature: string;
  merkleRoot: string;
  sessionId: string;
  eventCount: number;
  anchoredAt: number;
  sipheronAnchorId?: string;
  explorerUrl: string;
}

export interface PipelineSession {
  sessionId: string;
  pipelineId: string;
  status: 'active' | 'finalized';
  events: PipelineEvent[];
  merkleRoot: string | null;
  merkleLeaves: string[];
  anchorResult?: AnchorResult;
  createdAt: number;
  finalizedAt?: number;
  /**
   * When this snapshot is a lineage aggregate root, records which session roots were included (ids only).
   * Used for managed-mode anchor metadata — no secrets.
   */
  lineage?: PipelineSessionLineageMeta;
}

/** Session ids only; safe for logs and API metadata. */
export interface PipelineSessionLineageMeta {
  parentSessionId: string;
  childSessionIds: string[];
}

export interface SpawnPayload {
  parentSessionId: string;
  /**
   * Optional: The specific event hash in the parent session that triggered this spawn.
   * Strengthens causal provenance.
   */
  parentEventHash?: string;
  /**
   * Optional: The parent's Merkle root at the moment of spawning.
   * Provides a "point-in-time" cryptographic commitment.
   */
  parentStateRoot?: string;
}

export interface LineageAnchorResult extends AnchorResult {
  lineageRoot: string;
  parentSessionId: string;
  childSessionIds: string[];
  includedSessionRoots: string[];
}

export interface PipelineConfig {
  pipelineName: string;
  /**
   * When set, this session is a child of the given parent session (public session id only — never a secret).
   * Use `Pipeline.createChildFromParent()` to auto-log `SPAWN`.
   */
  parentSessionId?: string;
  /**
   * Optional: The parent's Merkle root at the moment of spawning.
   * Use `Pipeline.createChildFromParent()` to auto-link.
   */
  parentStateRoot?: string;
  /**
   * Optional: The specific event hash in the parent session that triggered this spawn.
   * Use `Pipeline.createChildFromParent()` to auto-link.
   */
  parentEventHash?: string;
  apiKey?: string;
  /** SipHeron API origin (same as vdr-core `baseUrl`). Defaults to the hosted API origin when unset. */
  apiBaseUrl?: string;
  solanaSecretKey?: Uint8Array;
  rpcEndpoint?: string;
  network?: 'mainnet-beta' | 'devnet';
  persistenceAdapter?: PersistenceAdapter;
  middleware?: any; 
  logger?: (msg: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
  streaming?: StreamingConfig;
  webhooks?: WebhookConfig[];
  anomalyDetection?: AnomalyDetectionConfig;
  /** Optional provider for zero-knowledge proofs (Phase 8). */
  zkProvider?: ZKProofProvider;
}

export interface StreamingConfig {
  enabled: boolean;
  /**
   * When true (default for managed mode with an API key), each `logEvent` POSTs hash-only telemetry to
   * `POST /api/pipeline/live-event`. Dashboards can subscribe via `GET /api/pipeline/sessions/:id/stream` (SSE).
   */
  useHttpIngest?: boolean;
  /** Set automatically from `PipelineConfig.apiBaseUrl` / defaults — you normally do not set this. */
  apiBaseUrl?: string;
  /** Set automatically from `PipelineConfig.apiKey` when using HTTP ingest. */
  apiKey?: string;
  /** Optional alternate WebSocket URL for custom real-time backends. */
  webSocketUrl?: string;
  authToken?: string;
  onConnectionError?: (error: any) => void;
}

export interface WebhookConfig {
  url: string;
  secret?: string; 
  events?: ('anchor.confirmed' | 'session.finalized')[];
}

export interface AnomalyDetectionConfig {
  maxTokensPerStep?: number;
  maxLatencyMs?: number;
  /** If true, finalization warns (via `onAnomaly`) when the session had GENERATION but no VALIDATION event. */
  requireValidationBeforeFinalize?: boolean;
  onAnomaly?: (anomaly: AnomalyReport) => void;
}

export interface AnomalyReport {
  type: 'TOKEN_LIMIT' | 'LATENCY_LIMIT' | 'ROUTING_LOOP' | 'MISSING_VALIDATION';
  sessionId: string;
  eventId?: string;
  message: string;
  details?: any;
}


// ── Payload Interfaces ──────────────────────────────────────────────────

export interface PromptPayload {
  role: 'user' | 'system' | 'assistant';
  content: string;
  templateId?: string;
  variables?: Record<string, string>;
}

export interface GenerationPayload {
  content: string;
  model: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface RetrievalPayload {
  query: string;
  resultCount: number;
  sourceIds?: string[];
  retrieverName?: string;
  scoreThreshold?: number;
}

export interface ToolCallPayload {
  toolName: string;
  toolId?: string;
  arguments: Record<string, any>;
}

export interface ToolResultPayload {
  toolName: string;
  toolId?: string;
  result: any;
  isError?: boolean;
  errorMessage?: string;
}

export interface RoutingPayload {
  decision: string;
  reason?: string;
  candidates?: string[];
}

export interface MemoryPayload {
  memoryKey?: string;
  summary?: string;
  entryCount?: number;
}

export interface ValidationPayload {
  passed: boolean;
  validatorName: string;
  score?: number;
  flags?: string[];
}
