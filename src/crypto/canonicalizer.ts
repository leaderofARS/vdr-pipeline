import * as crypto from 'crypto';

/**
 * RFC 8785 (JSON Canonicalization Scheme)-aligned payload canonicalizer.
 *
 * Produces deterministic, byte-identical JSON serialization across any
 * JavaScript engine by enforcing:
 * 1. Recursive lexicographic key sorting
 * 2. Undefined/function/symbol elimination
 * 3. Date → ISO-8601 normalization
 * 4. NaN/Infinity → null normalization
 * 5. BigInt → string conversion
 * 6. Buffer/Uint8Array → hex string conversion
 * 7. Consistent Unicode escaping (JSON.stringify defaults)
 *
 * This is critical for cross-environment hash determinism — the same payload
 * must produce the same hash whether computed in Node.js, Deno, or a browser.
 *
 * @example
 * ```typescript
 * const canonical = canonicalize({ z: 1, a: 2, m: new Date('2024-01-01') });
 * // → '{"a":2,"m":"2024-01-01T00:00:00.000Z","z":1}'
 *
 * const hash = canonicalHash({ z: 1, a: 2 });
 * // → '...' (64-char SHA-256 hex)
 * ```
 */

/**
 * Produce a canonical JSON string from any serializable value.
 * Object keys are recursively sorted; special JS types are normalized.
 *
 * @param value - Any JSON-serializable value
 * @returns Deterministic JSON string
 * @throws Error if value contains circular references
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Recursively sort object keys and normalize special types.
 */
function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    return value;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  // Buffer / Uint8Array → hex
  if (Buffer.isBuffer(value)) {
    return value.toString('hex');
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }

  // Map → sorted plain object
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[String(k)] = sortKeys(v);
    }
    return sortKeysObject(obj);
  }

  // Set → sorted array
  if (value instanceof Set) {
    return Array.from(value).map(sortKeys).sort();
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (typeof value === 'object') {
    return sortKeysObject(value as Record<string, unknown>);
  }

  // Functions, symbols, etc. → null
  return null;
}

/**
 * Sort object keys lexicographically and recursively process values.
 */
function sortKeysObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const val = obj[key];
    // Skip undefined, functions, symbols
    if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
      continue;
    }
    sorted[key] = sortKeys(val);
  }

  return sorted;
}

/**
 * Produce a SHA-256 hash of the canonical JSON representation.
 *
 * @param value - Any JSON-serializable value
 * @returns 64-char lowercase hex SHA-256 digest of the canonical form
 */
export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compare two values for canonical equality.
 * Two values are canonically equal if their canonical JSON forms are identical.
 *
 * @returns true if both values produce the same canonical JSON string
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Compute a canonical fingerprint — a shorter, human-friendly identifier
 * from the canonical hash (first 16 hex chars = 64 bits).
 *
 * @param value - Any JSON-serializable value
 * @returns 16-char hex fingerprint
 */
export function canonicalFingerprint(value: unknown): string {
  return canonicalHash(value).slice(0, 16);
}
