import * as crypto from 'crypto';

/**
 * HMAC Commitment Scheme for provable timestamps and commit/reveal workflows.
 *
 * This implements a cryptographic commitment scheme using HMAC-SHA256:
 * 1. **Commit phase**: The committer hashes the payload with a secret → produces a commitment
 * 2. **Reveal phase**: The committer reveals the payload + secret → verifier recomputes and compares
 *
 * ## Use Cases
 * - **Provable Timestamps**: Commit to an event hash at time T, reveal later to prove it existed at T
 * - **Fair Ordering**: Commit all agent decisions before revealing, preventing retrospective changes
 * - **Audit Envelopes**: Create tamper-evident audit records that can be verified by third parties
 *
 * @example
 * ```typescript
 * // Commit phase — agent makes a decision
 * const { commitment, secret, timestamp } = HMACCommitment.commit(eventHash);
 * // Store commitment publicly, keep secret private
 *
 * // Reveal phase — prove the decision was made at the claimed time
 * const isValid = HMACCommitment.reveal(eventHash, secret, commitment);
 * ```
 */
export interface Commitment {
  /** HMAC-SHA256 commitment hash */
  commitment: string;
  /** Random 256-bit secret used to create the commitment (keep private until reveal) */
  secret: string;
  /** Unix timestamp (ms) when the commitment was created */
  timestamp: number;
  /** The payload hash that was committed to */
  payloadHash: string;
}

export class HMACCommitment {
  /**
   * Create a new commitment to a payload hash.
   * Generates a cryptographically random secret and computes HMAC-SHA256.
   *
   * @param payloadHash - The 64-char hex hash to commit to
   * @returns Commitment object containing the commitment, secret, and metadata
   */
  static commit(payloadHash: string): Commitment {
    const secret = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();

    const commitment = crypto
      .createHmac('sha256', secret)
      .update(payloadHash)
      .digest('hex');

    return {
      commitment,
      secret,
      timestamp,
      payloadHash,
    };
  }

  /**
   * Verify a commitment by recomputing HMAC-SHA256 with the revealed secret.
   *
   * @param payloadHash - The original payload hash
   * @param secret - The secret revealed by the committer
   * @param commitment - The commitment to verify against
   * @returns true if the commitment is valid
   */
  static reveal(payloadHash: string, secret: string, commitment: string): boolean {
    const recomputed = crypto
      .createHmac('sha256', secret)
      .update(payloadHash)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(recomputed, 'hex'),
      Buffer.from(commitment, 'hex')
    );
  }

  /**
   * Create commitments for a batch of payload hashes (e.g., all events in a session).
   * Returns individual commitments plus a batch commitment covering all payloads.
   *
   * @param payloadHashes - Array of 64-char hex hashes
   * @returns Individual commitments and a batch commitment
   */
  static commitBatch(payloadHashes: string[]): {
    commitments: Commitment[];
    batchCommitment: Commitment;
  } {
    const commitments = payloadHashes.map(hash => HMACCommitment.commit(hash));

    // Create a batch commitment over all individual commitments
    const batchPayload = commitments.map(c => c.commitment).sort().join('');
    const batchHash = crypto.createHash('sha256').update(batchPayload).digest('hex');
    const batchCommitment = HMACCommitment.commit(batchHash);

    return { commitments, batchCommitment };
  }

  /**
   * Verify a batch of commitments including the batch commitment.
   *
   * @param payloadHashes - Original payload hashes
   * @param commitments - Individual commitments to verify
   * @param batchCommitment - The batch commitment to verify
   * @returns Object with individual results and overall validity
   */
  static revealBatch(
    payloadHashes: string[],
    commitments: Commitment[],
    batchCommitment: Commitment
  ): { valid: boolean; individualResults: boolean[] } {
    if (payloadHashes.length !== commitments.length) {
      return { valid: false, individualResults: [] };
    }

    const individualResults = payloadHashes.map((hash, i) =>
      HMACCommitment.reveal(hash, commitments[i].secret, commitments[i].commitment)
    );

    // Verify batch commitment
    const batchPayload = commitments.map(c => c.commitment).sort().join('');
    const batchHash = crypto.createHash('sha256').update(batchPayload).digest('hex');
    const batchValid = HMACCommitment.reveal(
      batchHash,
      batchCommitment.secret,
      batchCommitment.commitment
    );

    return {
      valid: batchValid && individualResults.every(Boolean),
      individualResults,
    };
  }
}
