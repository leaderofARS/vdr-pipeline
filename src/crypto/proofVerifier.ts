import * as crypto from 'crypto';
import { MerkleProof } from '../types';

/**
 * Standalone verifier (no Pipeline instance needed)
 * @param proof The Merkle proof to verify
 * @returns true if the proof is valid for the provided root
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let current = proof.leaf.toLowerCase();

  for (const step of proof.path) {
    const sibling = step.sibling.toLowerCase();
    // sort() ensures sequence independence for siblings
    const pair = [current, sibling].sort();
    current = crypto.createHash('sha256').update(pair.join('')).digest('hex');
  }

  return current === proof.root.toLowerCase();
}
