/**
 * Content-Addressable Store (CAS) for event deduplication and lookup.
 *
 * Stores values keyed by their SHA-256 hash. If the same payload is logged
 * twice, it maps to the same hash and is only stored once. This provides:
 * - O(1) deduplication for repeated events
 * - O(1) payload lookup by hash (useful for proof verification)
 * - Memory-efficient storage when agents repeat prompts
 *
 * @example
 * ```typescript
 * const cas = new ContentAddressableStore<PipelineEvent>();
 *
 * cas.put(event.hash, event);
 * const found = cas.get(event.hash);
 * console.log(cas.has(event.hash)); // true
 * console.log(cas.size);           // 1
 * ```
 */
export class ContentAddressableStore<T> {
  private store: Map<string, T> = new Map();

  /**
   * Store a value by its content hash. If the hash already exists,
   * the existing value is preserved (content-addressed idempotency).
   *
   * @param hash - 64-char hex SHA-256 hash
   * @param value - The value to store
   * @returns true if this was a new entry, false if hash already existed
   */
  put(hash: string, value: T): boolean {
    const key = hash.toLowerCase();
    if (this.store.has(key)) {
      return false; // Already stored — deduplicated
    }
    this.store.set(key, value);
    return true;
  }

  /**
   * Retrieve a value by its content hash.
   * @returns The stored value, or undefined if not found
   */
  get(hash: string): T | undefined {
    return this.store.get(hash.toLowerCase());
  }

  /**
   * Check if a hash exists in the store.
   */
  has(hash: string): boolean {
    return this.store.has(hash.toLowerCase());
  }

  /**
   * Remove a value by its content hash.
   * @returns true if the entry existed and was removed
   */
  delete(hash: string): boolean {
    return this.store.delete(hash.toLowerCase());
  }

  /**
   * Get the number of unique entries in the store.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Get all stored hashes.
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get all stored values.
   */
  values(): T[] {
    return Array.from(this.store.values());
  }

  /**
   * Iterate over all entries.
   */
  entries(): Array<[string, T]> {
    return Array.from(this.store.entries());
  }

  /**
   * Clear all entries from the store.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the deduplication ratio: unique / total puts.
   * Returns 1.0 if every put() was unique, < 1.0 if there were duplicates.
   */
  private totalPuts = 0;
  recordPut(hash: string, value: T): boolean {
    this.totalPuts++;
    return this.put(hash, value);
  }

  getDeduplicationStats(): { unique: number; total: number; ratio: number } {
    const unique = this.store.size;
    const total = this.totalPuts || unique; // fallback if recordPut not used
    return {
      unique,
      total,
      ratio: total > 0 ? unique / total : 1.0,
    };
  }
}
