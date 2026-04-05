import * as crypto from 'crypto';
import { MerkleConstructionError } from '../errors';

/**
 * HashChain provides a tamper-evident sequential hash chain.
 *
 * Each entry's hash includes the previous entry's hash, creating a
 * cryptographic chain where modifying or reordering any entry invalidates
 * all subsequent hashes. This is the same principle used in blockchain
 * block headers — each block commits to the previous one.
 *
 * ## Use Case
 * Use alongside MerkleTree for **dual integrity guarantees**:
 * - MerkleTree provides O(log n) inclusion proofs for any individual event
 * - HashChain provides O(1) sequential integrity (tamper detection for ordering)
 *
 * ## Chain Structure
 * ```
 * entry[0].chainHash = SHA-256(GENESIS || entry[0].hash)
 * entry[1].chainHash = SHA-256(entry[0].chainHash || entry[1].hash)
 * entry[n].chainHash = SHA-256(entry[n-1].chainHash || entry[n].hash)
 * ```
 *
 * @example
 * ```typescript
 * const chain = new HashChain();
 * chain.append(eventHash1);
 * chain.append(eventHash2);
 * chain.append(eventHash3);
 *
 * // Verify the entire chain
 * console.log(chain.verify()); // true
 *
 * // Get the chain head (latest cumulative hash)
 * console.log(chain.getHead()); // 64-char hex
 * ```
 */

const GENESIS_SEED = '0'.repeat(64);

export interface ChainEntry {
  /** Index in the chain (0-based) */
  index: number;
  /** Original event hash (the input) */
  eventHash: string;
  /** Cumulative chain hash (includes all previous entries) */
  chainHash: string;
  /** The previous chain hash used as input (genesis for index 0) */
  previousChainHash: string;
}

export class HashChain {
  private entries: ChainEntry[] = [];

  /**
   * Create a new HashChain, optionally pre-populating from existing entries.
   * @param entries - Optional array of ChainEntries to restore from (e.g., from serialization)
   */
  constructor(entries?: ChainEntry[]) {
    if (entries && entries.length > 0) {
      // Validate and restore
      this.entries = [...entries];
      if (!this.verify()) {
        throw new MerkleConstructionError(
          'Cannot restore HashChain: provided entries fail integrity verification.'
        );
      }
    }
  }

  /**
   * Append a new event hash to the chain.
   * @param eventHash - A 64-char lowercase hex SHA-256 hash
   * @returns The new ChainEntry with its cumulative chainHash
   */
  append(eventHash: string): ChainEntry {
    const normalized = eventHash.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      throw new MerkleConstructionError(
        `HashChain.append: invalid hex hash "${eventHash.slice(0, 16)}..."`
      );
    }

    const previousChainHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1].chainHash
      : GENESIS_SEED;

    const chainHash = crypto
      .createHash('sha256')
      .update(previousChainHash + normalized)
      .digest('hex');

    const entry: ChainEntry = {
      index: this.entries.length,
      eventHash: normalized,
      chainHash,
      previousChainHash,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Get the chain head (latest cumulative hash).
   * Returns the genesis seed if the chain is empty.
   */
  getHead(): string {
    if (this.entries.length === 0) return GENESIS_SEED;
    return this.entries[this.entries.length - 1].chainHash;
  }

  /**
   * Get the chain length (number of entries).
   */
  length(): number {
    return this.entries.length;
  }

  /**
   * Get the entry at a specific index.
   */
  getEntry(index: number): ChainEntry | null {
    return index >= 0 && index < this.entries.length ? this.entries[index] : null;
  }

  /**
   * Get all entries as a shallow copy.
   */
  getEntries(): ChainEntry[] {
    return [...this.entries];
  }

  /**
   * Verify the integrity of the entire chain.
   * Returns true if every entry's chainHash is correctly derived from
   * its previousChainHash and eventHash.
   */
  verify(): boolean {
    if (this.entries.length === 0) return true;

    let expectedPrevious = GENESIS_SEED;

    for (const entry of this.entries) {
      if (entry.previousChainHash !== expectedPrevious) return false;

      const expectedHash = crypto
        .createHash('sha256')
        .update(expectedPrevious + entry.eventHash)
        .digest('hex');

      if (entry.chainHash !== expectedHash) return false;
      expectedPrevious = entry.chainHash;
    }

    return true;
  }

  /**
   * Verify the chain up to a specific index (inclusive).
   * Useful for partial verification without checking the entire chain.
   */
  verifyUpTo(index: number): boolean {
    if (index < 0 || index >= this.entries.length) return false;

    let expectedPrevious = GENESIS_SEED;

    for (let i = 0; i <= index; i++) {
      const entry = this.entries[i];
      if (entry.previousChainHash !== expectedPrevious) return false;

      const expectedHash = crypto
        .createHash('sha256')
        .update(expectedPrevious + entry.eventHash)
        .digest('hex');

      if (entry.chainHash !== expectedHash) return false;
      expectedPrevious = entry.chainHash;
    }

    return true;
  }

  /**
   * Detect the first tampered index in the chain.
   * Returns -1 if the chain is valid.
   */
  findTamperedIndex(): number {
    let expectedPrevious = GENESIS_SEED;

    for (const entry of this.entries) {
      if (entry.previousChainHash !== expectedPrevious) return entry.index;

      const expectedHash = crypto
        .createHash('sha256')
        .update(expectedPrevious + entry.eventHash)
        .digest('hex');

      if (entry.chainHash !== expectedHash) return entry.index;
      expectedPrevious = entry.chainHash;
    }

    return -1;
  }

  /**
   * Serialize the chain to a JSON-safe object.
   */
  toJSON(): { entries: ChainEntry[]; head: string } {
    return {
      entries: this.getEntries(),
      head: this.getHead(),
    };
  }

  /**
   * Restore a HashChain from serialized JSON.
   * @throws MerkleConstructionError if the entries fail verification
   */
  static fromJSON(data: { entries: ChainEntry[] }): HashChain {
    return new HashChain(data.entries);
  }
}
