import { PipelineEvent, PipelineEventType, EventMetadata } from '../types';

/**
 * PipelineMiddleware provides an interceptor chain for event processing.
 *
 * Middleware functions are executed in order before each event is stored.
 * They can:
 * - **Transform** payloads (e.g., PII redaction, content truncation)
 * - **Validate** payloads (e.g., schema enforcement, content policy checks)
 * - **Enrich** metadata (e.g., add environment info, trace IDs)
 * - **Block** events (return null to discard an event before hashing)
 * - **Log** events (side-effect-only observation without modification)
 *
 * ## Design Pattern
 * Follows the Express.js / Koa middleware pattern:
 * each function receives the event context and a `next()` callback.
 *
 * @example
 * ```typescript
 * const middleware = new PipelineMiddleware();
 *
 * // PII redaction
 * middleware.use(async (ctx, next) => {
 *   if (ctx.payload.content) {
 *     ctx.payload.content = ctx.payload.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');
 *   }
 *   return next();
 * });
 *
 * // Content length validation
 * middleware.use(async (ctx, next) => {
 *   if (JSON.stringify(ctx.payload).length > 100_000) {
 *     ctx.payload.content = '[TRUNCATED: payload exceeds 100KB]';
 *   }
 *   return next();
 * });
 *
 * // Usage with Pipeline
 * const pipeline = Pipeline.withApiKey(key, {
 *   pipelineName: 'my-agent',
 *   middleware,
 * });
 * ```
 */

export interface MiddlewareContext {
  /** The event type */
  type: PipelineEventType;
  /** The event payload (mutable — modify in place for transformation) */
  payload: Record<string, any>;
  /** The event metadata (mutable — modify in place for enrichment) */
  metadata: EventMetadata;
  /** The session ID */
  sessionId: string;
  /** The pipeline name */
  pipelineName: string;
  /** The sequence index of this event within the session */
  sequenceIndex: number;
  /** Timestamp of the event (ms) */
  timestamp: number;
  /**
   * Set to true to discard this event entirely.
   * The event will not be hashed, stored, or included in the session.
   */
  discard: boolean;
}

export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void>;

export class PipelineMiddleware {
  private stack: Array<{ name: string; fn: MiddlewareFn }> = [];

  /**
   * Add a middleware function to the stack.
   * Middleware runs in the order it is added.
   *
   * @param fn - The middleware function
   * @param name - Optional name for debugging
   */
  use(fn: MiddlewareFn, name?: string): this {
    this.stack.push({
      name: name || `middleware-${this.stack.length}`,
      fn,
    });
    return this;
  }

  /**
   * Remove a middleware by name.
   * @returns true if the middleware was found and removed
   */
  remove(name: string): boolean {
    const index = this.stack.findIndex(m => m.name === name);
    if (index >= 0) {
      this.stack.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get the number of middleware functions in the stack.
   */
  get length(): number {
    return this.stack.length;
  }

  /**
   * List all middleware names in execution order.
   */
  list(): string[] {
    return this.stack.map(m => m.name);
  }

  /**
   * Execute all middleware in order.
   * Returns the (potentially modified) context after all middleware has run.
   * If any middleware sets ctx.discard = true, execution continues but the
   * event will be discarded by the Pipeline.
   */
  async execute(ctx: MiddlewareContext): Promise<MiddlewareContext> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index >= this.stack.length) return;
      const middleware = this.stack[index++];
      await middleware.fn(ctx, next);
    };

    await next();
    return ctx;
  }

  /**
   * Clear all middleware from the stack.
   */
  clear(): void {
    this.stack = [];
  }
}

// ── Built-in Middleware Factories ──────────────────────────────────────────────

/**
 * Create a PII redaction middleware.
 * Replaces common PII patterns in string payload values:
 * - SSNs (###-##-####)
 * - Credit card numbers (16 digits)
 * - Email addresses
 * - Phone numbers
 */
export function createPIIRedactionMiddleware(name = 'pii-redactor'): { name: string; fn: MiddlewareFn } {
  const patterns: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN-REDACTED]' },
    { regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CC-REDACTED]' },
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL-REDACTED]' },
    { regex: /\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, replacement: '[PHONE-REDACTED]' },
  ];

  return {
    name,
    fn: async (ctx, next) => {
      const redact = (value: any): any => {
        if (typeof value === 'string') {
          let result = value;
          for (const { regex, replacement } of patterns) {
            result = result.replace(regex, replacement);
          }
          return result;
        }
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === 'object') {
          const result: Record<string, any> = {};
          for (const [k, v] of Object.entries(value)) {
            result[k] = redact(v);
          }
          return result;
        }
        return value;
      };
      ctx.payload = redact(ctx.payload);
      return next();
    },
  };
}

/**
 * Create a payload size limit middleware.
 * Truncates payload if its JSON size exceeds maxBytes.
 */
export function createPayloadSizeLimitMiddleware(
  maxBytes: number = 100_000,
  name = 'size-limiter'
): { name: string; fn: MiddlewareFn } {
  return {
    name,
    fn: async (ctx, next) => {
      const size = JSON.stringify(ctx.payload).length;
      if (size > maxBytes) {
        ctx.payload = {
          _truncated: true,
          _originalSizeBytes: size,
          _maxBytes: maxBytes,
          summary: `Payload truncated: ${size} bytes exceeds ${maxBytes} byte limit`,
        };
      }
      return next();
    },
  };
}

/**
 * Create a metadata enrichment middleware.
 * Adds static key-value pairs to every event's metadata.
 */
export function createMetadataEnrichmentMiddleware(
  enrichments: Record<string, any>,
  name = 'metadata-enricher'
): { name: string; fn: MiddlewareFn } {
  return {
    name,
    fn: async (ctx, next) => {
      ctx.metadata = { ...ctx.metadata, ...enrichments };
      return next();
    },
  };
}

/**
 * Create an event type filter middleware.
 * Discards events that match the specified types.
 */
export function createTypeFilterMiddleware(
  discardTypes: PipelineEventType[],
  name = 'type-filter'
): { name: string; fn: MiddlewareFn } {
  const set = new Set(discardTypes);
  return {
    name,
    fn: async (ctx, next) => {
      if (set.has(ctx.type)) {
        ctx.discard = true;
      }
      return next();
    },
  };
}
