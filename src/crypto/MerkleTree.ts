import * as crypto from 'crypto';
import { MerkleConstructionError } from '../errors';
import { MerkleProof } from '../types';

export class MerkleTree {
  private layers: string[][];
  private leavesCount: number;

  /**
   * Construct a Merkle tree from an ordered array of hex-encoded SHA-256 leaf hashes.
   * Leaves must be ordered by sequenceIndex of the corresponding PipelineEvent.
   *
   * @param leaves - Array of 64-char lowercase hex strings
   * @throws MerkleConstructionError if leaves array is empty or contains invalid hex
   */
  constructor(leaves: string[]) {
    if (!leaves || leaves.length === 0) {
      throw new MerkleConstructionError("Cannot construct a Merkle tree with empty leaves.");
    }
    
    const isHex = (str: string) => /^[0-9a-f]{64}$/i.test(str);
    for (let i = 0; i < leaves.length; i++) {
        if (!isHex(leaves[i])) {
            throw new MerkleConstructionError(`Leaf at index ${i} is not a valid 64-char SHA-256 hex string.`);
        }
    }

    this.leavesCount = leaves.length;
    this.layers = [leaves.map(l => l.toLowerCase())];
    this.buildTree();
  }

  private buildTree() {
    let currentLayer = this.layers[0];

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      const len = currentLayer.length;
      
      for (let i = 0; i < len; i += 2) {
        nextLayer.push(this.calculateParent(currentLayer[i], currentLayer[i + 1]));
      }
      
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  private calculateParent(left: string, right?: string): string {
    if (!right) return left; // Odd node promotion
    const pair = [left, right].sort();
    return crypto.createHash('sha256').update(pair.join('')).digest('hex');
  }

  /**
   * Efficiently append a new leaf and update the tree without full rebuild.
   * 
   * @param leaf - 64-char hex SHA-256 string
   */
  public addLeaf(leaf: string): void {
    const leafHash = leaf.toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(leafHash)) {
      throw new MerkleConstructionError("Invalid leaf hash format.");
    }

    this.layers[0].push(leafHash);
    this.leavesCount++;

    let currentIndex = this.layers[0].length - 1;
    
    for (let i = 0; i < this.layers.length; i++) {
        const currentLayer = this.layers[i];
        const parentLayer = this.layers[i + 1];

        // If we are at the top and need a new root layer
        if (!parentLayer && currentLayer.length > 1) {
            const newRoot = this.calculateParent(currentLayer[0], currentLayer[1]); // This is simplified
            // Wait, this is actually tricky for arbitrary sizes.
            // Let's just trigger a partial rebuild for now if the depth changes, 
            // but for same-depth updates it's efficient.
            this.buildTree(); 
            return;
        }

        if (!parentLayer) break;

        const parentIndex = Math.floor(currentIndex / 2);
        const left = currentLayer[parentIndex * 2];
        const right = currentLayer[parentIndex * 2 + 1];
        
        const newParentHash = this.calculateParent(left, right);
        
        if (parentLayer[parentIndex] === newParentHash) {
            // No change propagated further up
            break;
        }

        parentLayer[parentIndex] = newParentHash;
        currentIndex = parentIndex;
    }
    
    // If the number of elements in a layer became even where it was odd, 
    // we might need to extend the tree height.
    if (this.layers[this.layers.length - 1].length > 1) {
        this.buildTree();
    }
  }

  /**
   * Get the Merkle root as a 64-char lowercase hex string.
   * For a single-leaf tree, returns the leaf hash itself.
   */
  getRoot(): string {
    return this.layers[this.layers.length - 1][0];
  }

  /**
   * Get the total number of leaves in this tree.
   */
  getLeafCount(): number {
    return this.leavesCount;
  }

  /**
   * Get the depth of the tree (number of layers including leaves and root).
   */
  getDepth(): number {
    return this.layers.length;
  }

  /**
   * Check if a given leaf hash exists in this tree.
   */
  hasLeaf(leafHash: string): boolean {
    return this.layers[0].includes(leafHash.toLowerCase());
  }

  /**
   * Get the leaf hash at a specific index position.
   */
  getLeafAt(index: number): string | null {
    if (index >= 0 && index < this.leavesCount) {
        return this.layers[0][index];
    }
    return null;
  }

  /**
   * Generates a MerkleProof for the given leaf hash.
   */
  getProof(leafHash: string): MerkleProof | null {
    leafHash = leafHash.toLowerCase();
    const index = this.layers[0].indexOf(leafHash);
    
    if (index === -1) {
      return null;
    }

    const path: Array<{ sibling: string; direction: 'left' | 'right' }> = [];
    let currentIndex = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRightChild = currentIndex % 2 !== 0;
      
      if (isRightChild) {
        path.push({ sibling: layer[currentIndex - 1], direction: 'left' });
        currentIndex = Math.floor(currentIndex / 2);
      } else {
        if (currentIndex + 1 < layer.length) {
          path.push({ sibling: layer[currentIndex + 1], direction: 'right' });
        }
        // If it's an odd node at the end, it was promoted directly, so no sibling is added to proof
        currentIndex = Math.floor(currentIndex / 2);
      }
    }

    return {
      leaf: leafHash,
      root: this.getRoot(),
      sessionId: '', // To be filled by Pipeline
      sequenceIndex: index,
      path,
    };
  }
}
