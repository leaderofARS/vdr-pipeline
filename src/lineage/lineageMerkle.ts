import { MerkleTree } from '../crypto/MerkleTree';
import { verifyMerkleProof } from '../crypto/proofVerifier';
import { LineageError } from '../errors';
import type { MerkleProof, PipelineSession } from '../types';

/**
 * Canonical leaf order for a lineage Merkle tree:
 * parent session root first, then each child session root sorted by `sessionId` (lexicographic).
 * Deterministic across processes.
 */
export function buildLineageLeaves(parent: PipelineSession, children: PipelineSession[]): string[] {
  if (!parent.merkleRoot || !/^[0-9a-f]{64}$/i.test(parent.merkleRoot)) {
    throw new LineageError('Parent session must be finalized with a valid 64-char hex merkleRoot.', {
      sessionId: parent.sessionId
    });
  }
  const ordered = [...children].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  for (const c of ordered) {
    if (!c.merkleRoot || !/^[0-9a-f]{64}$/i.test(c.merkleRoot)) {
      throw new LineageError('Each child session must be finalized with a valid merkleRoot.', {
        sessionId: c.sessionId
      });
    }
  }
  return [parent.merkleRoot.toLowerCase(), ...ordered.map((c) => c.merkleRoot!.toLowerCase())];
}

export function buildLineageMerkleTree(parent: PipelineSession, children: PipelineSession[]): MerkleTree {
  const leaves = buildLineageLeaves(parent, children);
  return new MerkleTree(leaves);
}

/**
 * Prove that a session's Merkle root is included in the lineage aggregate root.
 */
export function getLineageProofForSessionRoot(
  tree: MerkleTree,
  sessionMerkleRoot: string
): MerkleProof | null {
  const leaf = sessionMerkleRoot.toLowerCase();
  const p = tree.getProof(leaf);
  return p;
}

export function verifyLineageProof(proof: MerkleProof, expectedLineageRoot: string): boolean {
  if (proof.root.toLowerCase() !== expectedLineageRoot.toLowerCase()) return false;
  return verifyMerkleProof(proof);
}
