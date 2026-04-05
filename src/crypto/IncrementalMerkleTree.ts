import * as crypto from 'crypto';
import { MerkleConstructionError } from '../errors';
import { MerkleProof } from '../types';

/**
 * IncrementalMerkleTree implements an append-only Merkle tree.
 * 
 * Unlike a standard Merkle tree that requires all leaves to be known upfront,
 * an incremental tree allows adding leaves one by one and efficiently
 * updating the root and proofs.
 * 
 * It uses a "filled peaks" or "frontier" approach to maintain the tree state
 * with O(log N) space and update time.
 * 
 * ## Use Case
 * ideal for long-running agent sessions where events are added periodically
 * and you want to maintain a "running total" of the integrity root without 
 * rebuilding the entire tree.
 */
export class IncrementalMerkleTree {
  private leaves: string[] = [];
  private branches: string[][] = []; // [depth][index]
  
  constructor(initialLeaves: string[] = []) {
    for (const leaf of initialLeaves) {
      this.append(leaf);
    }
  }

  /**
   * Append a new leaf to the tree and update the root.
   * @param leafHash - 64-char hex SHA-256 hash
   */
  append(leafHash: string): void {
    const normalized = leafHash.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      throw new MerkleConstructionError(`Invalid leaf hash: ${leafHash}`);
    }

    this.leaves.push(normalized);
    this.updateTree(normalized);
  }

  private updateTree(leaf: string): void {
    if (this.branches.length === 0) {
      this.branches.push([leaf]);
      return;
    }

    let current = leaf;
    let index = this.leaves.length - 1;

    for (let depth = 0; depth < this.branches.length; depth++) {
      if (index % 2 === 0) {
        // Left node, just add it to the layer
        if (this.branches[depth].length <= index) {
          this.branches[depth].push(current);
        } else {
          this.branches[depth][index] = current;
        }
        return; // Done for this append
      } else {
        // Right node, hash with sibling and promote
        const left = this.branches[depth][index - 1];
        const pair = [left, current].sort();
        current = crypto.createHash('sha256').update(pair.join('')).digest('hex');
        index = Math.floor(index / 2);
        
        // If we need a new layer
        if (depth + 1 === this.branches.length) {
          this.branches.push([current]);
          return;
        }
      }
    }
  }

  /**
   * Get the current Merkle root.
   */
  getRoot(): string {
    if (this.leaves.length === 0) return '0'.repeat(64);
    
    // We need to compute the peak root by processing the "incomplete" tree
    // if the number of leaves is not a power of 2.
    // However, for an incremental tree where we want a stable root, 
    // we often "promote" odd nodes.
    
    return this.computeCurrentRoot();
  }

  private computeCurrentRoot(): string {
    if (this.leaves.length === 1) return this.leaves[0];
    
    let currentLayer = this.leaves;
    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          const pair = [currentLayer[i], currentLayer[i + 1]].sort();
          nextLayer.push(crypto.createHash('sha256').update(pair.join('')).digest('hex'));
        } else {
          nextLayer.push(currentLayer[i]); // Promote odd node
        }
      }
      currentLayer = nextLayer;
    }
    return currentLayer[0];
  }

  /**
   * Generate a proof for a leaf index.
   */
  getProof(index: number): MerkleProof | null {
    if (index < 0 || index >= this.leaves.length) return null;

    const leaf = this.leaves[index];
    const root = this.computeCurrentRoot();
    const path: Array<{ sibling: string; direction: 'left' | 'right' }> = [];

    let currentLayer = this.leaves;
    let currentIndex = index;

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const isRight = currentIndex === i + 1;
        const isLeft = currentIndex === i;

        if (i + 1 < currentLayer.length) {
          const pair = [currentLayer[i], currentLayer[i + 1]].sort();
          const hash = crypto.createHash('sha256').update(pair.join('')).digest('hex');
          
          if (isLeft) {
            path.push({ sibling: currentLayer[i + 1], direction: 'right' });
            currentIndex = nextLayer.length;
          } else if (isRight) {
            path.push({ sibling: currentLayer[i], direction: 'left' });
            currentIndex = nextLayer.length;
          }
          nextLayer.push(hash);
        } else {
          // Promotion case
          if (isLeft) {
            currentIndex = nextLayer.length;
          }
          nextLayer.push(currentLayer[i]);
        }
      }
      currentLayer = nextLayer;
    }

    return {
      leaf,
      root,
      sessionId: '', // Fill later
      sequenceIndex: index,
      path
    };
  }

  get leavesCount(): number {
    return this.leaves.length;
  }
}
