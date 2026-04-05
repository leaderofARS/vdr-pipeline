import { MerkleProof } from '../types';
import { verifyMerkleProof } from '../crypto/proofVerifier';

/**
 * Hash-only bundle you can hand to a verifier UI or auditor tool (no raw prompts).
 */
export interface ProofExplorerBundle {
  kind: 'vdr-pipeline-merkle-proof';
  version: 1;
  leaf: string;
  merkleRoot: string;
  sessionId: string;
  sequenceIndex: number;
  pathDepth: number;
  anchorTransactionSignature?: string;
  verifiedLocally: boolean;
}

/**
 * Build a portable, privacy-safe description of a Merkle proof for dashboard / explorer tools.
 */
export function proofToExplorerBundle(
  proof: MerkleProof,
  options?: { anchorTransactionSignature?: string }
): ProofExplorerBundle {
  const verifiedLocally = verifyMerkleProof(proof);
  return {
    kind: 'vdr-pipeline-merkle-proof',
    version: 1,
    leaf: proof.leaf,
    merkleRoot: proof.root,
    sessionId: proof.sessionId,
    sequenceIndex: proof.sequenceIndex,
    pathDepth: proof.path.length,
    anchorTransactionSignature: options?.anchorTransactionSignature ?? proof.anchorTransactionSignature,
    verifiedLocally
  };
}

/** Re-run local Merkle verification (same as `pipeline.verifyProof`). */
export function verifyProofForExplorer(proof: MerkleProof): boolean {
  return verifyMerkleProof(proof);
}
