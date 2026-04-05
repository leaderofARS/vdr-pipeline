import { PipelineSession } from '../types';

/**
 * Build an immutable PipelineSession snapshot.
 * This is the canonical factory used by Pipeline.exportSession().
 *
 * @param data - Raw session data to freeze into an immutable snapshot
 * @returns A frozen, serializable PipelineSession object
 */
export function buildPipelineSession(data: PipelineSession): Readonly<PipelineSession> {
  return Object.freeze({ ...data, events: [...data.events] });
}

/**
 * Reconstruct a MerkleProof for any event in a stored session snapshot.
 * Useful for offline proof generation from a persisted snapshot.
 *
 * @param session - A finalized PipelineSession snapshot
 * @param eventHash - The 64-char hex hash of the event to prove
 * @returns A MerkleProof or null if the event hash is not in this session
 */
export function getProofFromSnapshot(
  session: PipelineSession,
  eventHash: string
): import('../types').MerkleProof | null {
  if (!session.merkleRoot || session.merkleLeaves.length === 0) return null;

  const { MerkleTree } = require('../crypto/MerkleTree');
  const tree = new MerkleTree(session.merkleLeaves);
  const proof = tree.getProof(eventHash);
  if (!proof) return null;

  return {
    ...proof,
    sessionId: session.sessionId,
    root: session.merkleRoot,
    anchorTransactionSignature: session.anchorResult?.transactionSignature,
  };
}
