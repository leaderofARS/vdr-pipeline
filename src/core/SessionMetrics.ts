import { PipelineEvent, PipelineEventType, PipelineSession } from '../types';

/**
 * SessionMetrics computes observability analytics from a PipelineSession.
 *
 * Provides aggregate statistics for token usage, latency, event distribution,
 * throughput, and cost estimation — the data needed for compliance dashboards,
 * billing, and performance monitoring.
 *
 * @example
 * ```typescript
 * const session = pipeline.exportSession();
 * const metrics = SessionMetrics.fromSession(session);
 *
 * console.log(metrics.totalTokens);        // 12500
 * console.log(metrics.avgLatencyMs);        // 1200
 * console.log(metrics.eventDistribution);   // { PROMPT: 3, GENERATION: 3, RETRIEVAL: 2 }
 * console.log(metrics.durationMs);          // 4500
 * console.log(metrics.eventsPerSecond);     // 1.78
 * ```
 */
export interface SessionMetricsData {
  /** Total number of events in the session */
  eventCount: number;
  /** Duration from first to last event (ms) */
  durationMs: number;
  /** Events per second throughput */
  eventsPerSecond: number;
  /** Event count by type */
  eventDistribution: Record<string, number>;
  /** Total tokens across all GENERATION events */
  totalTokens: number;
  /** Total prompt tokens */
  promptTokens: number;
  /** Total completion tokens */
  completionTokens: number;
  /** Average latency (ms) across events with latencyMs metadata */
  avgLatencyMs: number | null;
  /** Maximum latency (ms) */
  maxLatencyMs: number | null;
  /** Minimum latency (ms) */
  minLatencyMs: number | null;
  /** P95 latency (ms) */
  p95LatencyMs: number | null;
  /** Number of unique models used */
  uniqueModels: string[];
  /** Number of unique tools called */
  uniqueTools: string[];
  /** Number of retrieval operations */
  retrievalCount: number;
  /** Total documents retrieved */
  totalDocumentsRetrieved: number;
  /** Number of validation events */
  validationCount: number;
  /** Number of validation passes vs failures */
  validationPassRate: number | null;
  /** Estimated cost based on token counts ($USD) at GPT-4o rates */
  estimatedCostUsd: number | null;
  /** Session start time (ms) */
  startedAt: number;
  /** Session end time (ms) */
  endedAt: number;
  /** Whether the session has been finalized */
  isFinalized: boolean;
  /** Whether the session has been anchored */
  isAnchored: boolean;
  /** The session ID of the parent that spawned this session (if any) */
  parentSessionId?: string;
  /** Whether this is a child session */
  isChild: boolean;
}

// GPT-4o pricing: $2.50/1M input, $10/1M output (mid-2024)
const GPT4O_PROMPT_COST_PER_TOKEN = 2.5 / 1_000_000;
const GPT4O_COMPLETION_COST_PER_TOKEN = 10 / 1_000_000;

export class SessionMetrics {
  private data: SessionMetricsData;

  private constructor(data: SessionMetricsData) {
    this.data = data;
  }

  /**
   * Compute metrics from a PipelineSession.
   */
  static fromSession(session: PipelineSession): SessionMetrics {
    const events = session.events;
    const latencies: number[] = [];
    const models = new Set<string>();
    const tools = new Set<string>();
    const distribution: Record<string, number> = {};

    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalDocsRetrieved = 0;
    let retrievalCount = 0;
    let validationCount = 0;
    let validationPasses = 0;

    for (const event of events) {
      // Distribution
      distribution[event.type] = (distribution[event.type] || 0) + 1;

      // Latency
      if (event.metadata?.latencyMs !== undefined) {
        latencies.push(event.metadata.latencyMs);
      }

      // Models
      if (event.metadata?.model) {
        models.add(event.metadata.model);
      }

      // Type-specific
      switch (event.type) {
        case 'GENERATION':
          if (event.payload.usage) {
            promptTokens += event.payload.usage.promptTokens || 0;
            completionTokens += event.payload.usage.completionTokens || 0;
            totalTokens += event.payload.usage.totalTokens || 0;
          }
          if (event.metadata?.tokenCount) {
            totalTokens = Math.max(totalTokens, event.metadata.tokenCount);
          }
          if (event.payload.model) models.add(event.payload.model);
          break;

        case 'TOOL_CALL':
          if (event.payload.toolName) tools.add(event.payload.toolName);
          break;

        case 'RETRIEVAL':
          retrievalCount++;
          totalDocsRetrieved += event.payload.resultCount || 0;
          break;

        case 'VALIDATION':
          validationCount++;
          if (event.payload.passed) validationPasses++;
          break;
      }
    }

    // Time calculations
    const timestamps = events.map(e => e.timestamp);
    const startedAt = timestamps.length > 0 ? Math.min(...timestamps) : session.createdAt;
    const endedAt = timestamps.length > 0 ? Math.max(...timestamps) : session.createdAt;
    const durationMs = endedAt - startedAt;
    const eventsPerSecond = durationMs > 0 ? (events.length / durationMs) * 1000 : 0;

    // Latency stats
    latencies.sort((a, b) => a - b);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null;
    const p95Index = latencies.length > 0
      ? Math.ceil(latencies.length * 0.95) - 1
      : -1;

    // Cost estimation
    const estimatedCost = (promptTokens > 0 || completionTokens > 0)
      ? promptTokens * GPT4O_PROMPT_COST_PER_TOKEN + completionTokens * GPT4O_COMPLETION_COST_PER_TOKEN
      : null;

    return new SessionMetrics({
      eventCount: events.length,
      durationMs,
      eventsPerSecond,
      eventDistribution: distribution,
      totalTokens,
      promptTokens,
      completionTokens,
      avgLatencyMs: avgLatency,
      maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1] : null,
      minLatencyMs: latencies.length > 0 ? latencies[0] : null,
      p95LatencyMs: p95Index >= 0 ? latencies[p95Index] : null,
      uniqueModels: Array.from(models),
      uniqueTools: Array.from(tools),
      retrievalCount,
      totalDocumentsRetrieved: totalDocsRetrieved,
      validationCount,
      validationPassRate: validationCount > 0 ? validationPasses / validationCount : null,
      estimatedCostUsd: estimatedCost,
      startedAt,
      endedAt,
      isFinalized: session.status === 'finalized',
      isAnchored: !!session.anchorResult,
      parentSessionId: session.events.find(e => e.type === 'SPAWN')?.payload.parentSessionId,
      isChild: session.events.some(e => e.type === 'SPAWN')
    });
}

  /**
   * Compute metrics from raw events (no session object needed).
   */
  static fromEvents(events: PipelineEvent[]): SessionMetrics {
    const fakeSession: PipelineSession = {
      sessionId: 'metrics-only',
      pipelineId: 'metrics-only',
      status: 'active',
      events,
      merkleRoot: null,
      merkleLeaves: [],
      createdAt: events.length > 0 ? events[0].timestamp : Date.now(),
    };
    return SessionMetrics.fromSession(fakeSession);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get eventCount() { return this.data.eventCount; }
  get durationMs() { return this.data.durationMs; }
  get eventsPerSecond() { return this.data.eventsPerSecond; }
  get eventDistribution() { return { ...this.data.eventDistribution }; }
  get totalTokens() { return this.data.totalTokens; }
  get promptTokens() { return this.data.promptTokens; }
  get completionTokens() { return this.data.completionTokens; }
  get avgLatencyMs() { return this.data.avgLatencyMs; }
  get maxLatencyMs() { return this.data.maxLatencyMs; }
  get minLatencyMs() { return this.data.minLatencyMs; }
  get p95LatencyMs() { return this.data.p95LatencyMs; }
  get uniqueModels() { return [...this.data.uniqueModels]; }
  get uniqueTools() { return [...this.data.uniqueTools]; }
  get retrievalCount() { return this.data.retrievalCount; }
  get totalDocumentsRetrieved() { return this.data.totalDocumentsRetrieved; }
  get validationCount() { return this.data.validationCount; }
  get validationPassRate() { return this.data.validationPassRate; }
  get estimatedCostUsd() { return this.data.estimatedCostUsd; }
  get isFinalized() { return this.data.isFinalized; }
  get isAnchored() { return this.data.isAnchored; }

  /**
   * Export all metrics as a plain object (for serialization / logging).
   */
  toJSON(): SessionMetricsData {
    return { ...this.data };
  }

  /**
   * Format a human-readable summary string.
   */
  summary(): string {
    const lines: string[] = [
      `Events: ${this.eventCount} (${this.durationMs}ms, ${this.eventsPerSecond.toFixed(1)} eps)`,
      `Tokens: ${this.totalTokens} (prompt: ${this.promptTokens}, completion: ${this.completionTokens})`,
    ];
    if (this.avgLatencyMs !== null) {
      lines.push(`Latency: avg=${this.avgLatencyMs.toFixed(0)}ms, p95=${this.p95LatencyMs?.toFixed(0)}ms`);
    }
    if (this.uniqueModels.length > 0) {
      lines.push(`Models: ${this.uniqueModels.join(', ')}`);
    }
    if (this.uniqueTools.length > 0) {
      lines.push(`Tools: ${this.uniqueTools.join(', ')}`);
    }
    if (this.estimatedCostUsd !== null) {
      lines.push(`Est. Cost: $${this.estimatedCostUsd.toFixed(4)}`);
    }
    return lines.join('\n');
  }
}
