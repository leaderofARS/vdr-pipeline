import { PipelineEvent, AnomalyDetectionConfig, AnomalyReport } from '../types';

/**
 * AnomalyDetector implements client-side hooks to flag sessions 
 * with unexpected token usage, latency, or behavioral patterns.
 *
 * It is used within the Pipeline event logging loop to provide real-time 
 * feedback on compliance and performance issues.
 */
export class AnomalyDetector {
  private config: AnomalyDetectionConfig;
  private routingHistory: Map<string, number> = new Map();
  private validationCount: number = 0;
  private hasSeenValidation = false;

  constructor(config: AnomalyDetectionConfig) {
    this.config = config;
  }

  /**
   * Run all checks for an incoming event. 
   * Returns an AnomalyReport if any rule is violated.
   */
  check(event: PipelineEvent): AnomalyReport | null {
    // 1. Token Limit check (on GENERATION)
    if (this.config.maxTokensPerStep) {
      const tokens = event.metadata?.tokenCount || (event.type === 'GENERATION' && event.payload.usage?.totalTokens);
      if (tokens && tokens > this.config.maxTokensPerStep) {
        return {
          type: 'TOKEN_LIMIT',
          sessionId: event.sessionId,
          eventId: event.id,
          message: `Token limit exceeded in ${event.type}: ${tokens} > ${this.config.maxTokensPerStep}`,
          details: { actual: tokens, limit: this.config.maxTokensPerStep }
        };
      }
    }

    // 2. Latency Limit check
    if (this.config.maxLatencyMs && event.metadata?.latencyMs) {
      if (event.metadata.latencyMs > this.config.maxLatencyMs) {
        return {
          type: 'LATENCY_LIMIT',
          sessionId: event.sessionId,
          eventId: event.id,
          message: `Latency limit exceeded in ${event.type}: ${event.metadata.latencyMs}ms > ${this.config.maxLatencyMs}ms`,
          details: { actual: event.metadata.latencyMs, limit: this.config.maxLatencyMs }
        };
      }
    }

    // 3. Routing Loop check
    if (event.type === 'ROUTING') {
      const key = `${event.sessionId}:${event.payload.decision}`;
      const count = (this.routingHistory.get(key) || 0) + 1;
      this.routingHistory.set(key, count);
      
      if (count > 3) {
        return {
          type: 'ROUTING_LOOP',
          sessionId: event.sessionId,
          eventId: event.id,
          message: `Potential routing loop detected for decision "${event.payload.decision}" (count: ${count})`,
          details: { decision: event.payload.decision, count }
        };
      }
    }

    if (event.type === 'VALIDATION') {
      this.hasSeenValidation = true;
      this.validationCount++;
    }

    return null;
  }

  /**
   * Final check on session finalization to detect missing validation when required.
   */
  finalCheck(sessionId: string, events: PipelineEvent[]): AnomalyReport | null {
    if (!this.config.requireValidationBeforeFinalize) {
      return null;
    }
    const hadGeneration = events.some((e) => e.type === 'GENERATION');
    if (!hadGeneration) {
      return null;
    }
    if (!events.some((e) => e.type === 'VALIDATION')) {
      return {
        type: 'MISSING_VALIDATION',
        sessionId,
        message:
          'Session contains GENERATION event(s) but no VALIDATION step was logged before finalize.',
        details: { generationCount: events.filter((e) => e.type === 'GENERATION').length }
      };
    }
    return null;
  }
}
