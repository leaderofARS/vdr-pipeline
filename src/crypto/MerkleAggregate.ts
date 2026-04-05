import { MerkleTree } from './MerkleTree';
import { MerkleConstructionError } from '../errors';

/**
 * MerkleAggregate allows for recursive Merkle root aggregation.
 * 
 * It takes an array of session roots (or bundle roots) and combines them
 * into a single aggregate root. This is a "merkle of merkles" pattern.
 * 
 * ## Use Case
 * ideal for high-throughput systems to aggregate thousands of session roots
 * into a single daily "master anchor" on the blockchain.
 * 
 * Each session remains provable against the master root by providing a
 * composite proof (proof within its session + proof within the session group).
 */
export class MerkleAggregate {
  private tree: MerkleTree;
  private roots: string[];

  /**
   * @param roots - Array of 64-char hex session roots
   */
  constructor(roots: string[]) {
    if (!roots || roots.length === 0) {
      throw new MerkleConstructionError('Cannot aggregate empty roots');
    }
    this.roots = [...roots];
    this.tree = new MerkleTree(this.roots);
  }

  /**
   * Get the aggregate root.
   */
  getAggregateRoot(): string {
    return this.tree.getRoot();
  }

  /**
   * Get the combined leaf count (total roots being aggregated).
   */
  getLeafCount(): number {
    return this.tree.getLeafCount();
  }

  /**
   * Get an aggregation proof for a specific session root.
   * Combine this with an individual event proof for a "full path" verification.
   */
  getAggregateProof(sessionRoot: string): import('../types').MerkleProof | null {
    return this.tree.getProof(sessionRoot);
  }

  /**
   * Verify an aggregate proof.
   */
  static verify(proof: import('../types').MerkleProof): boolean {
    const { verifyMerkleProof } = require('./proofVerifier');
    return verifyMerkleProof(proof);
  }
}
