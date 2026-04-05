import { hashDocument } from '@sipheron/vdr-core';
import { PipelineSerializationError } from '../errors';

/**
 * Deterministic replacer for JSON.stringify to ensure consistency.
 * - Sorts object keys alphabetically
 * - Converts Dates to ISO strings
 * - Maps NaN/Infinity to null
 */
function deterministicReplacer(key: string, value: any): any {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
    return null;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // Sort object keys
    return Object.keys(value)
      .sort()
      .reduce((acc: Record<string, any>, k: string) => {
        if (value[k] !== undefined) {
          acc[k] = value[k];
        }
        return acc;
      }, {});
  }
  return value;
}

/**
 * Produce a deterministic SHA-256 hash for a pipeline event.
 * Uses vdr-core's hashDocument internally.
 *
 * @param type       - PipelineEventType string
 * @param payload    - Arbitrary serializable object (no circular refs, no undefined top-level)
 * @param timestamp  - Unix ms timestamp
 * @param sessionId  - Parent session UUID
 * @param sequenceIndex - Monotonically increasing position within the session
 * @returns 64-char lowercase hex SHA-256 digest
 * @throws PipelineSerializationError if payload contains circular references or non-serializable data
 */
export async function hashEvent(
  type: string,
  payload: Record<string, any>,
  timestamp: number,
  sessionId: string,
  sequenceIndex: number
): Promise<string> {
  let serialized: string;
  
  // Construct the pre-image object
  const preImage = {
    type,
    payload,
    timestamp,
    sessionId,
    sequenceIndex,
  };

  try {
    // Serialize with deterministic key sorting and filtering
    serialized = JSON.stringify(preImage, deterministicReplacer);
  } catch (error: any) {
    throw new PipelineSerializationError(
      `Failed to serialize event payload for hashing: ${error.message}`,
      { type, sequenceIndex }
    );
  }

  // Hash using the vdr-core primitive
  return await hashDocument(Buffer.from(serialized));
}
