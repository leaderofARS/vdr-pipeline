import { PipelineEvent, PipelineEventType, EventMetadata } from '../types';

/**
 * EventFilter provides rich querying, filtering, and aggregation over  
 * PipelineEvent arrays. Designed for post-session analysis, audit queries,
 * and compliance reporting.
 *
 * All filter methods are pure — they return new arrays without mutating inputs.
 *
 * @example
 * ```typescript
 * const events = pipeline.exportSession().events;
 * const filter = new EventFilter(events);
 *
 * const prompts = filter.byType('PROMPT').results();
 * const recentTools = filter.byType('TOOL_CALL').after(fiveMinutesAgo).results();
 * const expensive = filter.byType('GENERATION').where(e => e.metadata?.tokenCount > 1000).results();
 * ```
 */
export class EventFilter {
  private events: PipelineEvent[];

  constructor(events: PipelineEvent[]) {
    this.events = [...events];
  }

  // ── Chainable Filters ───────────────────────────────────────────────────────

  /**
   * Filter events by type.
   */
  byType(type: PipelineEventType): EventFilter {
    return new EventFilter(this.events.filter(e => e.type === type));
  }

  /**
   * Filter events by multiple types (OR).
   */
  byTypes(types: PipelineEventType[]): EventFilter {
    const set = new Set(types);
    return new EventFilter(this.events.filter(e => set.has(e.type)));
  }

  /**
   * Filter events after a given timestamp (inclusive).
   */
  after(timestampMs: number): EventFilter {
    return new EventFilter(this.events.filter(e => e.timestamp >= timestampMs));
  }

  /**
   * Filter events before a given timestamp (inclusive).
   */
  before(timestampMs: number): EventFilter {
    return new EventFilter(this.events.filter(e => e.timestamp <= timestampMs));
  }

  /**
   * Filter events within a time range (inclusive).
   */
  between(startMs: number, endMs: number): EventFilter {
    return new EventFilter(this.events.filter(e => e.timestamp >= startMs && e.timestamp <= endMs));
  }

  /**
   * Filter events by metadata model name.
   */
  byModel(model: string): EventFilter {
    return new EventFilter(this.events.filter(e => e.metadata?.model === model));
  }

  /**
   * Filter events that have any of the given tags.
   */
  byTags(tags: string[]): EventFilter {
    const tagSet = new Set(tags);
    return new EventFilter(
      this.events.filter(e =>
        e.metadata?.tags?.some(t => tagSet.has(t)) ?? false
      )
    );
  }

  /**
   * Filter events by a custom predicate function.
   */
  where(predicate: (event: PipelineEvent) => boolean): EventFilter {
    return new EventFilter(this.events.filter(predicate));
  }

  /**
   * Filter events by sequence index range (inclusive).
   */
  bySequenceRange(start: number, end: number): EventFilter {
    return new EventFilter(
      this.events.filter(e => e.sequenceIndex >= start && e.sequenceIndex <= end)
    );
  }

  /**
   * Filter events whose payload contains a specific key.
   */
  hasPayloadKey(key: string): EventFilter {
    return new EventFilter(this.events.filter(e => key in e.payload));
  }

  /**
   * Exclude events by type.
   */
  excludeType(type: PipelineEventType): EventFilter {
    return new EventFilter(this.events.filter(e => e.type !== type));
  }

  // ── Terminal Operations ────────────────────────────────────────────────────

  /**
   * Return the filtered results as an array.
   */
  results(): PipelineEvent[] {
    return [...this.events];
  }

  /**
   * Return the first matching event, or null.
   */
  first(): PipelineEvent | null {
    return this.events.length > 0 ? this.events[0] : null;
  }

  /**
   * Return the last matching event, or null.
   */
  last(): PipelineEvent | null {
    return this.events.length > 0 ? this.events[this.events.length - 1] : null;
  }

  /**
   * Return the count of matching events.
   */
  count(): number {
    return this.events.length;
  }

  /**
   * Check if any events match.
   */
  exists(): boolean {
    return this.events.length > 0;
  }

  /**
   * Return only the event hashes.
   */
  hashes(): string[] {
    return this.events.map(e => e.hash);
  }

  /**
   * Group events by type and return a Map.
   */
  groupByType(): Map<PipelineEventType, PipelineEvent[]> {
    const groups = new Map<PipelineEventType, PipelineEvent[]>();
    for (const event of this.events) {
      const existing = groups.get(event.type) || [];
      existing.push(event);
      groups.set(event.type, existing);
    }
    return groups;
  }

  /**
   * Map events to a different shape.
   */
  map<T>(fn: (event: PipelineEvent) => T): T[] {
    return this.events.map(fn);
  }

  /**
   * Sort events by a comparator function.
   */
  sortBy(comparator: (a: PipelineEvent, b: PipelineEvent) => number): EventFilter {
    return new EventFilter([...this.events].sort(comparator));
  }

  /**
   * Get a time-ordered view (ascending by timestamp).
   */
  chronological(): EventFilter {
    return this.sortBy((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get a reverse-time-ordered view (descending by timestamp).
   */
  reverseChronological(): EventFilter {
    return this.sortBy((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Take the first N events from the current filter.
   */
  take(n: number): EventFilter {
    return new EventFilter(this.events.slice(0, n));
  }

  /**
   * Skip the first N events from the current filter.
   */
  skip(n: number): EventFilter {
    return new EventFilter(this.events.slice(n));
  }
}
