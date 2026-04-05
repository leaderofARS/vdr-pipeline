import { Pipeline } from './Pipeline';
import { PipelineConfig, AnchorResult } from '../types';

type PoolConfig = Omit<PipelineConfig, 'pipelineName'>;

/**
 * PipelinePool manages a pool of named Pipeline sessions for concurrent agent execution.
 *
 * Use this when running multiple parallel agent runs that each need their own
 * isolated provenance session. Each session in the pool is keyed by a developer-chosen
 * string (e.g., user ID, request ID, or agent name).
 *
 * ## Example
 *
 * ```typescript
 * const pool = new PipelinePool({ apiKey: process.env.SIPHERON_API_KEY! });
 *
 * // For each concurrent agent run:
 * const session = pool.getOrCreate('agent-run-001', 'my-agent');
 * await session.logPrompt({ role: 'user', content: 'Hello' });
 *
 * // Finalize one session
 * const result = await pool.finalizeAndAnchor('agent-run-001');
 *
 * // Or finalize all at once
 * const results = await pool.finalizeAll();
 * ```
 */
export class PipelinePool {
  private config: PoolConfig;
  private sessions: Map<string, Pipeline>;

  /**
   * @param config - Pipeline configuration without `pipelineName`.
   *   `pipelineName` is supplied per-session via `getOrCreate()`.
   */
  constructor(config: PoolConfig) {
    this.config = config;
    this.sessions = new Map();
  }

  /**
   * Get an existing Pipeline session or create a new one for the given key.
   *
   * @param sessionKey - Unique identifier for this session (e.g., request ID, user ID)
   * @param pipelineName - Human-readable pipeline label for the SipHeron dashboard.
   *   Ignored if the session already exists.
   * @returns The existing or newly created Pipeline instance
   */
  getOrCreate(sessionKey: string, pipelineName: string): Pipeline {
    if (!this.sessions.has(sessionKey)) {
      const pipeline = new Pipeline({ ...this.config, pipelineName });
      this.sessions.set(sessionKey, pipeline);
    }
    return this.sessions.get(sessionKey)!;
  }

  /**
   * Get an existing Pipeline session by key.
   *
   * @param sessionKey - The key used when the session was created
   * @returns The Pipeline instance, or undefined if not found
   */
  get(sessionKey: string): Pipeline | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * Check if a session exists in the pool for the given key.
   */
  has(sessionKey: string): boolean {
    return this.sessions.has(sessionKey);
  }

  /**
   * Get all session keys currently in the pool.
   */
  keys(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get the number of sessions currently in the pool.
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Finalize and anchor the session for the given key.
   * The session is removed from the pool after successful anchoring.
   *
   * @param sessionKey - The session to finalize
   * @returns The AnchorResult for the anchored session
   * @throws Error if the session does not exist in the pool
   */
  async finalizeAndAnchor(sessionKey: string): Promise<AnchorResult> {
    const pipeline = this.sessions.get(sessionKey);
    if (!pipeline) {
      throw new Error(`No session found in pool for key: "${sessionKey}"`);
    }

    const result = await pipeline.finalizeAndAnchor();
    this.sessions.delete(sessionKey);
    return result;
  }

  /**
   * Finalize and anchor all sessions currently in the pool.
   * Sessions are processed concurrently (Promise.allSettled).
   * Successfully anchored sessions are removed from the pool.
   * Failed sessions remain in the pool so they can be retried.
   *
   * @returns A map of sessionKey → AnchorResult for all succeeded sessions.
   *   Check the returned map size vs pool size to detect failures.
   */
  async finalizeAll(): Promise<Map<string, AnchorResult>> {
    const results = new Map<string, AnchorResult>();
    const entries = Array.from(this.sessions.entries());

    const settled = await Promise.allSettled(
      entries.map(async ([key, pipeline]) => {
        const result = await pipeline.finalizeAndAnchor();
        return { key, result };
      })
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { key, result } = outcome.value;
        results.set(key, result);
        this.sessions.delete(key);
      }
      // Failed sessions remain in the pool for retry
    }

    return results;
  }

  /**
   * Remove a session from the pool without finalizing it.
   * Use this to discard a session that should not be anchored.
   *
   * @param sessionKey - The session to remove
   * @returns true if the session existed and was removed, false if not found
   */
  remove(sessionKey: string): boolean {
    return this.sessions.delete(sessionKey);
  }
  
  /**
   * Recover all sessions stored in the persistence adapter and rehydrate the pool.
   *
   * Use this on process restart to resume agent execution from the last
   * persisted state. Sessions are recovered from the adapter if it supports `list()`.
   *
   * NOTE: The `sessionKey` used in the pool is re-derived as `sessionId` for 
   * recovered sessions (as keys are not stored by the adapter).
   *
   * @returns The number of sessions recovered
   */
  async recoverSessions(): Promise<number> {
    const adapter = (this.config as any).persistenceAdapter;
    if (!adapter) return 0;
    
    // Only works if adapter supports list() (like FileSystemPersistenceAdapter)
    if (typeof adapter.list !== 'function') {
        console.warn("[VDR-PIPELINE] PersistenceAdapter does not support list(). Recovery skipped.");
        return 0;
    }

    const sessionIds = await adapter.list();
    let count = 0;

    for (const sessionId of sessionIds) {
      if (this.sessions.has(sessionId)) continue;

      const pipeline = new Pipeline({ ...this.config, pipelineName: 'recovered-agent' });
      const success = await pipeline.resumeSession(sessionId);
      
      if (success) {
        this.sessions.set(sessionId, pipeline);
        count++;
      }
    }

    return count;
  }
}
