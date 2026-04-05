import { hashDocument } from '@sipheron/vdr-core';
import { PipelineSerializationError } from '../errors';
import { canonicalize } from './canonicalizer';
import * as crypto from 'crypto';

/**
 * SaltedEventHasher adds a random seed or "pepper" to each event hash.
 * 
 * This prevents rainbow table attacks and frequency analysis attacks where 
 * an attacker can guess the original prompt by observing a common hash.
 * 
 * Each event in the session is hashed with:
 * SHA256(canonicalPayload || salt)
 */
export class SaltedEventHasher {
  private salt: string;

  /**
   * @param salt - 64-char hex string to use as salt.
   *   If not provided, a random 256-bit salt is generated.
   */
  constructor(salt?: string) {
    this.salt = salt || crypto.randomBytes(32).toString('hex');
  }

  /**
   * @returns 64-char hex salt
   */
  getSalt(): string {
    return this.salt;
  }

  /**
   * Hash an event with the salt.
   */
  async hash(
    type: string,
    payload: Record<string, any>,
    timestamp: number,
    sessionId: string,
    sequenceIndex: number
  ): Promise<string> {
    const preImage = {
      type,
      payload,
      timestamp,
      sessionId,
      sequenceIndex,
      salt: this.salt
    };

    try {
      const serialized = canonicalize(preImage);
      return await hashDocument(Buffer.from(serialized));
    } catch (err: any) {
      throw new PipelineSerializationError(
        `Failed to hash salted event: ${err.message}`, 
        { type, sequenceIndex }
      );
    }
  }

  /**
   * Verify a payload against a salted hash.
   */
  async verify(
    expectedHash: string,
    type: string,
    payload: Record<string, any>,
    timestamp: number,
    sessionId: string,
    sequenceIndex: number
  ): Promise<boolean> {
    const actualHash = await this.hash(type, payload, timestamp, sessionId, sequenceIndex);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  }
}
