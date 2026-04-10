import * as crypto from 'crypto';
import { EventStore } from './EventStore';
import { BaseAnchor } from '../anchoring/BaseAnchor';
import { SipHeronAnchor } from '../anchoring/SipHeronAnchor';
import { SolanaAnchor } from '../anchoring/SolanaAnchor';
import { hashEvent } from '../crypto/eventHasher';
import { MerkleTree } from '../crypto/MerkleTree';
import { verifyMerkleProof } from '../crypto/proofVerifier';
import {
  PipelineConfig,
  PipelineEventType,
  EventMetadata,
  PromptPayload,
  GenerationPayload,
  RetrievalPayload,
  ToolCallPayload,
  ToolResultPayload,
  RoutingPayload,
  MemoryPayload,
  ValidationPayload,
  AnchorResult,
  MerkleProof,
  PipelineSession,
  PipelineEvent,
  ZKProof
} from '../types';
import {
  SessionFinalizedError,
  EmptySessionError,
  AnchorConfigError,
  PipelineSerializationError,
  ZKProofError
} from '../errors';
import { PipelineMiddleware, MiddlewareContext } from './PipelineMiddleware';
import { SessionMetrics } from './SessionMetrics';
import { PipelineStreamer } from './PipelineStreamer';
import { AnomalyDetector } from './AnomalyDetector';
import { WebhookDispatcher } from './Webhooks';
import { PersistenceAdapter } from '../types';
import { AuditTrail } from '../lineage/AuditTrail';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_PREFIX = '[VDR-PIPELINE]';

export class Pipeline {
  private config: PipelineConfig;
  private store?: EventStore;
  private sessionId?: string;
  private status: 'idle' | 'active' | 'finalized' = 'idle';
  private tree?: MerkleTree;
  private anchorResult?: AnchorResult;
  private finalizedAt?: number;
  private anchorDriver?: BaseAnchor;
  private debugMode: boolean;
  private middleware?: PipelineMiddleware;
  private streamer?: PipelineStreamer;
  private anomalyDetector?: AnomalyDetector;
  private webhooks?: WebhookDispatcher;

  constructor(config: PipelineConfig) {
    if (!config.apiKey && !config.solanaSecretKey) {
      throw new AnchorConfigError(
        'Must provide either apiKey (managed mode) or solanaSecretKey (direct mode) in PipelineConfig.'
      );
    }

    this.config = Object.assign({ network: 'mainnet-beta' }, config);
    this.debugMode = process.env.VDRPIPELINE_DEBUG === 'true';

    // Managed mode takes precedence; warn if both are set
    if (this.config.apiKey && this.config.solanaSecretKey) {
      this.log(
        'Both apiKey and solanaSecretKey are set. Managed mode (apiKey) takes precedence.',
        'warn'
      );
    }

    if (this.config.apiKey) {
      this.anchorDriver = new SipHeronAnchor(this.config);
    } else if (this.config.solanaSecretKey) {
      this.anchorDriver = new SolanaAnchor(this.config);
    }

    if (this.config.middleware) {
      this.middleware = this.config.middleware;
    }

    if (this.config.streaming?.enabled) {
      this.streamer = new PipelineStreamer({
        ...this.config.streaming,
        pipelineName: this.config.pipelineName,
        apiKey: this.config.apiKey,
        apiBaseUrl: this.config.apiBaseUrl
      });
    }

    if (this.config.anomalyDetection) {
      this.anomalyDetector = new AnomalyDetector(this.config.anomalyDetection);
    }

    if (this.config.webhooks?.length) {
      this.webhooks = new WebhookDispatcher(this.config.webhooks);
    }
  }


  // ── Convenience constructors ───────────────────────────────────────────────

  static withApiKey(apiKey: string, config: Omit<PipelineConfig, 'apiKey'>): Pipeline {
    return new Pipeline({ ...config, apiKey });
  }

  static withSolanaKey(solanaSecretKey: Uint8Array, config: Omit<PipelineConfig, 'solanaSecretKey'>): Pipeline {
    return new Pipeline({ ...config, solanaSecretKey });
  }

  /**
   * Create a child pipeline tied to the parent's current session. Starts the child session and
   * records `SPAWN` as sequence index 0 (public session ids only).
   */
  static async createChildFromParent(
    parent: Pipeline,
    config: Omit<PipelineConfig, 'parentSessionId' | 'parentEventHash' | 'parentStateRoot'>,
    options?: { parentEventHash?: string }
  ): Promise<Pipeline> {
    const parentSessionId = parent.getSessionId();
    const parentEventHash = options?.parentEventHash;
    const parentStateRoot = parent.getCurrentRoot();
    const child = new Pipeline({ ...config, parentSessionId, parentEventHash, parentStateRoot });
    child.startSession(config.pipelineName);
    await child.logEvent('SPAWN', { parentSessionId, parentEventHash, parentStateRoot });
    return child;
  }

  // ── Session control ────────────────────────────────────────────────────────

  startSession(pipelineId?: string): string {
    if (this.status !== 'idle') {
      return this.sessionId!;
    }
    this.sessionId = crypto.randomUUID();
    this.store = new EventStore(
      this.sessionId,
      pipelineId || this.config.pipelineName,
      this.config.persistenceAdapter
    );
    this.status = 'active';
    this.log(`Session started: ${this.sessionId} (pipeline: ${pipelineId || this.config.pipelineName})`, 'info');
    return this.sessionId;
  }

  /**
   * Proactively clear sensitive security data from memory.
   * Zeroes out the solanaSecretKey buffer and clears the apiKey.
   * Call this when you are done with the Pipeline instance.
   */
  destroy(): void {
    this.log('Destroying pipeline instance and zeroing secrets...', 'debug');
    if (this.config.solanaSecretKey) {
      this.config.solanaSecretKey.fill(0);
    }
    this.config.apiKey = '[DESTROYED]';
    this.config.solanaSecretKey = undefined;
    this.status = 'finalized';
  }

  /**
   * Resume an existing session from the persistence adapter.
   */
  async resumeSession(sessionId: string): Promise<boolean> {
    if (!this.config.persistenceAdapter) return false;
    
    const partial = await this.config.persistenceAdapter.load(sessionId);
    if (!partial) return false;

    this.sessionId = sessionId;
    this.store = new EventStore(
      this.sessionId,
      partial.pipelineId,
      this.config.persistenceAdapter
    );
    
    // Restore events
    for (const event of partial.events) {
       await this.store.addEvent(event);
    }

    this.status = 'active';
    this.log(`Session resumed: ${this.sessionId}`, 'info');
    return true;
  }

  getSessionId(): string {
    if (this.status === 'idle') {
      throw new Error('Session has not started yet. Call startSession() or logEvent() first.');
    }
    return this.sessionId!;
  }

  getPipelineId(): string {
    return this.config.pipelineName;
  }

  /**
   * Returns the hash of the most recently logged event in the current session.
   * Extremely useful for causal linking when spawning child sessions or multi-step chains.
   */
  getLastEventHash(): string | undefined {
    if (!this.store || this.store.getEventCount() === 0) return undefined;
    const events = this.store.getEvents();
    return events[events.length - 1].hash;
  }

  getSessionStatus(): 'idle' | 'active' | 'finalized' {
    return this.status;
  }

  getEventCount(): number {
    return this.store ? this.store.getEventCount() : 0;
  }

  // ── Event logging ──────────────────────────────────────────────────────────

  async logEvent(
    type: PipelineEventType,
    payload: Record<string, any>,
    metadata?: EventMetadata
  ): Promise<string> {
    if (this.status === 'finalized') {
      throw new SessionFinalizedError(
        'Cannot log events into a finalized session. Create a new Pipeline instance for a new session.',
        { sessionId: this.sessionId }
      );
    }
    if (this.status === 'idle') {
      this.startSession(this.config.pipelineName);
    }

    const timestamp = Date.now();
    const sequenceIndex = this.store!.getEventCount();

    // ── Execute Middleware Stack ───────────────────────────────────────────
    let finalPayload = { ...payload };
    let finalMetadata = { ...metadata };
    
    if (this.middleware) {
      const ctx: MiddlewareContext = {
        type,
        payload: finalPayload,
        metadata: finalMetadata,
        sessionId: this.sessionId!,
        pipelineName: this.config.pipelineName,
        sequenceIndex,
        timestamp,
        discard: false
      };
      
      await this.middleware.execute(ctx);
      
      if (ctx.discard) {
        this.log(`Event ignored by middleware: ${type} at index ${sequenceIndex}`, 'debug');
        return ''; 
      }
      
      finalPayload = ctx.payload;
      finalMetadata = ctx.metadata;
    }

    const hash = await hashEvent(type, finalPayload, timestamp, this.sessionId!, sequenceIndex);

    this.log(`Event #${sequenceIndex} hashed: ${type} → ${hash.slice(0, 12)}...`, 'debug');

    const event: PipelineEvent = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId!,
      sequenceIndex,
      type,
      payload: finalPayload,
      hash,
      timestamp,
      metadata: finalMetadata
    };

    // ── Execute Anomaly Detection ─────────────────────────────────────────
    if (this.anomalyDetector) {
      const anomaly = this.anomalyDetector.check(event);
      if (anomaly) {
        this.log(`Anomaly detected: ${anomaly.message}`, 'warn');
        if (this.config.anomalyDetection?.onAnomaly) {
          this.config.anomalyDetection.onAnomaly(anomaly);
        }
        // Optionally tag event as anomalous or log it
        event.type = 'ANOMALY';
        event.payload.anomaly = anomaly;
      }
    }

    await this.store!.addEvent(event);

    // ── Stream Event ───────────────────────────────────────────────────────
    if (this.streamer) {
      this.streamer.stream(event).catch(() => {});
    }

    return hash;
  }




  async logPrompt(payload: PromptPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('PROMPT', payload, metadata);
  }
  async logGeneration(payload: GenerationPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('GENERATION', payload, metadata);
  }
  async logRetrieval(payload: RetrievalPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('RETRIEVAL', payload, metadata);
  }
  async logToolCall(payload: ToolCallPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('TOOL_CALL', payload, metadata);
  }
  async logToolResult(payload: ToolResultPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('TOOL_RESULT', payload, metadata);
  }
  async logRouting(payload: RoutingPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('ROUTING', payload, metadata);
  }
  async logMemoryRead(payload: MemoryPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('MEMORY_READ', payload, metadata);
  }
  async logMemoryWrite(payload: MemoryPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('MEMORY_WRITE', payload, metadata);
  }
  async logValidation(payload: ValidationPayload, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('VALIDATION', payload, metadata);
  }

  async logSpawn(payload: { parentSessionId: string; parentEventHash?: string; parentStateRoot?: string }, metadata?: EventMetadata): Promise<string> {
    return this.logEvent('SPAWN', payload, metadata);
  }

  async logCustom(
    subtype: string,
    payload: Record<string, any>,
    metadata?: EventMetadata
  ): Promise<string> {
    return this.logEvent('CUSTOM', { subtype, ...payload }, metadata);
  }

  /**
   * Log multiple events in a single batch.
   * Efficiently processes events through middleware and appends to store.
   *
   * @param events - Array of event definitions
   * @returns Array of 64-char hex hashes
   */
  async logBatch(
    events: Array<{ type: PipelineEventType; payload: Record<string, any>; metadata?: EventMetadata }>
  ): Promise<string[]> {
    const hashes: string[] = [];
    for (const e of events) {
      hashes.push(await this.logEvent(e.type, e.payload, e.metadata));
    }
    return hashes;
  }

  // ── Finalization ───────────────────────────────────────────────────────────

  finalizeOnly(): PipelineSession {
    if (this.status === 'finalized') {
      return this.exportSession();
    }
    if (this.status === 'idle' || !this.store || this.store.getEventCount() === 0) {
      throw new EmptySessionError(
        'Cannot finalize an empty session. Log at least one event before finalizing.',
        { sessionId: this.sessionId }
      );
    }

    const events = this.store.getEvents();
    const leaves = events.map(e => e.hash);

    this.tree = new MerkleTree(leaves);
    this.status = 'finalized';
    this.finalizedAt = Date.now();

    this.log(
      `MerkleTree: ${leaves.length} leaves, depth ${this.tree.getDepth()}, root: ${this.tree.getRoot().slice(0, 12)}...`,
      'debug'
    );

    const session = this.exportSession();

    if (this.anomalyDetector && this.config.anomalyDetection?.requireValidationBeforeFinalize) {
      const late = this.anomalyDetector.finalCheck(this.sessionId!, session.events);
      if (late) {
        this.log(`Anomaly detected: ${late.message}`, 'warn');
        if (this.config.anomalyDetection.onAnomaly) {
          this.config.anomalyDetection.onAnomaly(late);
        }
      }
    }

    if (this.webhooks) {
      this.webhooks.dispatch('session.finalized', session);
    }

    return session;
  }


  /**
   * Submit an intermediate Merkle root for all events logged so far,
   * without closing or finalizing the current session.
   *
   * This is useful for long-running agents that want to anchor their
   * progress periodically.
   *
   * @returns The AnchorResult for this checkpoint
   */
  /**
   * Anchor any finalized snapshot with this pipeline's anchor driver (same API key / keypair).
   * Used for lineage aggregate roots; does not change this instance's session.
   */
  async anchorSessionSnapshot(snapshot: PipelineSession): Promise<AnchorResult> {
    if (!snapshot.merkleRoot) {
      throw new EmptySessionError('Snapshot must include merkleRoot.', {
        sessionId: snapshot.sessionId
      });
    }
    if (!this.anchorDriver) {
      throw new AnchorConfigError('No anchoring driver initialized.');
    }
    return this.anchorDriver.anchor(snapshot);
  }

  async checkpointAndAnchor(): Promise<AnchorResult> {
    if (this.status === 'finalized') {
      throw new SessionFinalizedError('Cannot checkpoint a finalized session.');
    }
    if (this.status === 'idle' || !this.store || this.store.getEventCount() === 0) {
      throw new EmptySessionError('Cannot checkpoint an empty session.');
    }

    if (!this.anchorDriver) {
      throw new AnchorConfigError('No anchoring driver initialized.');
    }

    // Build intermediate tree (does not set this.tree or this.status)
    const events = this.store.getEvents();
    const leaves = events.map(e => e.hash);
    const checkpointTree = new MerkleTree(leaves);
    const checkpointRoot = checkpointTree.getRoot();

    this.log(`Checkpointing session: ${leaves.length} events, root: ${checkpointRoot.slice(0, 12)}...`, 'info');

    // Manually build a session snapshot for the anchor driver
    const snapshot: PipelineSession = {
      sessionId: this.sessionId!,
      pipelineId: this.config.pipelineName,
      status: 'active',
      events,
      merkleRoot: checkpointRoot,
      merkleLeaves: leaves,
      createdAt: this.store.getCreatedAt()
    };

    const result = await this.anchorDriver.anchor(snapshot);

    this.log(`Checkpoint anchored. TX: ${result.transactionSignature}`, 'info');

    return result;
  }

  async finalizeAndAnchor(): Promise<AnchorResult> {
    if (this.status !== 'finalized') {
      this.finalizeOnly();
    }

    // Pre-anchor validation
    this.validatePreAnchor();

    if (!this.anchorDriver) {
      throw new AnchorConfigError('No anchoring driver initialized.');
    }

    this.log(
      `Anchoring via ${this.config.apiKey ? 'SipHeron API' : 'Solana RPC'}...`,
      'info'
    );

    const session = this.exportSession();
    this.anchorResult = await this.anchorDriver.anchor(session);

    this.log(
      `Anchored. TX: ${this.anchorResult.transactionSignature}${this.anchorResult.sipheronAnchorId ? ` | AnchorID: ${this.anchorResult.sipheronAnchorId}` : ''}`,
      'info'
    );

    // Clean up persistence AFTER successful anchoring
    if (this.config.persistenceAdapter && this.store) {
      this.store.clearPersistence().catch(err => 
        this.log(`Failed to clear persistent state for session ${this.sessionId}: ${err.message}`, 'warn')
      );
    }

    if (this.webhooks) {
      this.webhooks.dispatch('anchor.confirmed', this.anchorResult);
    }

    return this.anchorResult;
  }



  // ── Merkle utilities ───────────────────────────────────────────────────────

  getMerkleRoot(): string | null {
    if (!this.tree) return null;
    return this.tree.getRoot();
  }

  /**
   * Compute a temporary Merkle root for all events logged so far without finalizing the session.
   * Useful for point-in-time state binding between sessions.
   */
  getCurrentRoot(): string | undefined {
    if (!this.store || this.store.getEventCount() === 0) return undefined;
    const events = this.store.getEvents();
    const leaves = events.map(e => e.hash);
    const tempTree = new MerkleTree(leaves);
    return tempTree.getRoot();
  }

  getProof(eventHash: string): MerkleProof | null {
    if (!this.tree) return null;
    const proof = this.tree.getProof(eventHash);
    if (proof) {
      proof.sessionId = this.sessionId!;
      if (this.anchorResult?.transactionSignature) {
        proof.anchorTransactionSignature = this.anchorResult.transactionSignature;
      }
    }
    return proof;
  }

  /**
   * Generate a Zero-Knowledge proof for a specific claim about an event (Phase 8).
   * Requires a `zkProvider` to be configured. 
   * 
   * Claims examples: 
   * - "tokenCount < 500"
   * - "model == 'gpt-4o'"
   */
  async generateZKProof(eventHash: string, claim: string): Promise<ZKProof> {
    if (!this.config.zkProvider) {
      throw new ZKProofError('No ZK provider configured in PipelineConfig.');
    }
    
    const event = this.store?.getEvents().find(e => e.hash === eventHash);
    if (!event) {
      throw new ZKProofError(`Event with hash ${eventHash} not found in current session.`);
    }

    const merkleProof = this.getProof(eventHash);
    if (!merkleProof) {
      throw new ZKProofError('Cannot generate ZK proof: session not finalized or event not in tree.');
    }

    const root = this.getMerkleRoot();
    if (!root) {
      throw new ZKProofError('Session has no Merkle root. Call finalizeOnly() first.');
    }

    return this.config.zkProvider.prove({
      event,
      merkleProof,
      claim,
      merkleRoot: root
    });
  }

  /**
   * Verify a ZK proof against the configured ZK provider (Phase 8).
   */
  async verifyZKProof(proof: ZKProof): Promise<boolean> {
     if (!this.config.zkProvider) {
      throw new ZKProofError('No ZK provider configured in PipelineConfig.');
    }
    return this.config.zkProvider.verify(proof);
  }

  verifyProof(proof: MerkleProof): boolean {
    return verifyMerkleProof(proof);
  }

  // ── Session export ─────────────────────────────────────────────────────────

  exportSession(): PipelineSession {
    if (this.status === 'idle') {
      throw new EmptySessionError('Cannot export an empty session.');
    }
    return {
      sessionId: this.sessionId!,
      pipelineId: this.config.pipelineName,
      status: this.status,
      events: this.store!.getEvents(),
      merkleRoot: this.tree ? this.tree.getRoot() : null,
      merkleLeaves: this.tree ? this.store!.getEvents().map(e => e.hash) : [],
      anchorResult: this.anchorResult,
      createdAt: this.store!.getCreatedAt(),
      finalizedAt: this.finalizedAt
    };
  }

  /**
   * Get observability metrics for the current session.
   */
  getMetrics(): SessionMetrics {
    return SessionMetrics.fromSession(this.exportSession());
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Validate the session before submitting to the blockchain.
   * Ensures all event hashes are valid and sequenceIndexes are unique.
   */
  private validatePreAnchor(): void {
    const events = this.store!.getEvents();

    if (events.length === 0) {
      throw new EmptySessionError('Cannot anchor a session with no events.', {
        sessionId: this.sessionId
      });
    }

    const seqSet = new Set<number>();
    for (const event of events) {
      if (!/^[0-9a-f]{64}$/i.test(event.hash)) {
        throw new PipelineSerializationError(
          `Event ${event.id} has an invalid hash format: "${event.hash.slice(0, 12)}..."`,
          { eventId: event.id, sequenceIndex: event.sequenceIndex }
        );
      }
      if (seqSet.has(event.sequenceIndex)) {
        throw new PipelineSerializationError(
          `Duplicate sequenceIndex ${event.sequenceIndex} detected. Session may be corrupt.`,
          { sessionId: this.sessionId, sequenceIndex: event.sequenceIndex }
        );
      }
      seqSet.add(event.sequenceIndex);
    }
  }

  /**
   * Structured logger. Uses config.logger if provided.
   * Performs deep redacting of any strings that look like secrets (API keys, private keys).
   */
  private log(msg: string, level: LogLevel): void {
    // Proactively redact all known security sensitive strings from logs
    let scrubbed = msg;
    const targets = [
      this.config.apiKey,
      this.config.solanaSecretKey ? Buffer.from(this.config.solanaSecretKey).toString('hex') : null,
      this.config.solanaSecretKey ? Buffer.from(this.config.solanaSecretKey).toString('base64') : null,
    ].filter(Boolean) as string[];

    for (const t of targets) {
      if (t.length > 5) scrubbed = (scrubbed as any).replaceAll(t, '[REDACTED]');
    }

    // Heuristics for unknown secrets (Base58/64 strings > 40 chars)
    scrubbed = scrubbed.replace(/[1-9A-HJ-NP-Za-km-z]{40,88}/g, '[REDACTED_SEC]');

    const formatted = `${LOG_PREFIX} [${level}]  ${scrubbed}`;
    if (this.config.logger) {
      this.config.logger(scrubbed, level);
      return;
    }

    if (level === 'debug' && !this.debugMode) return;

    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else if (level === 'info' || (level === 'debug' && this.debugMode)) {
      console.log(formatted);
    }
  }
}
