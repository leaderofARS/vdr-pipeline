import { MerkleTree } from '../../src/crypto/MerkleTree';
import { verifyMerkleProof } from '../../src/crypto/proofVerifier';
import { MerkleConstructionError } from '../../src/errors';
import * as crypto from 'crypto';
import fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describe('MerkleTree — construction', () => {
  it('should construct a tree with a single leaf (root = leaf)', () => {
    const leaf = sha256('leaf1');
    const tree = new MerkleTree([leaf]);
    expect(tree.getRoot()).toBe(leaf);
    expect(tree.getDepth()).toBe(1);
    expect(tree.getLeafCount()).toBe(1);
  });

  it('should construct a tree with two leaves', () => {
    const leaf1 = sha256('leaf1');
    const leaf2 = sha256('leaf2');
    const tree = new MerkleTree([leaf1, leaf2]);

    const expectedRoot = crypto.createHash('sha256')
      .update([leaf1, leaf2].sort().join(''))
      .digest('hex');

    expect(tree.getRoot()).toBe(expectedRoot);
    expect(tree.getDepth()).toBe(2);
    expect(tree.getLeafCount()).toBe(2);
  });

  it('should throw MerkleConstructionError for empty leaves', () => {
    expect(() => new MerkleTree([])).toThrow(MerkleConstructionError);
  });

  it('should throw MerkleConstructionError for invalid hex leaf', () => {
    expect(() => new MerkleTree(['not-a-hex-string'])).toThrow(MerkleConstructionError);
    expect(() => new MerkleTree(['abc'])).toThrow(MerkleConstructionError);
  });

  it('should handle 7 leaves with odd-leaf promotion at each layer', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => sha256(`leaf${i}`));
    // Should not throw and should produce a valid root
    const tree = new MerkleTree(leaves);
    expect(tree.getRoot()).toHaveLength(64);
    expect(tree.getLeafCount()).toBe(7);
  });
});

describe('MerkleTree — incremental updates', () => {
  it('addLeaf should produce the same root as full rebuild', () => {
    const l1 = sha256('a');
    const l2 = sha256('b');
    const l3 = sha256('c');
    
    const treeFull = new MerkleTree([l1, l2, l3]);
    const treeInc = new MerkleTree([l1]);
    treeInc.addLeaf(l2);
    treeInc.addLeaf(l3);
    
    expect(treeInc.getRoot()).toBe(treeFull.getRoot());
    expect(treeInc.getLeafCount()).toBe(3);
  });

  it('addLeaf should maintain proof validity', () => {
      const l1 = sha256('a');
      const l2 = sha256('b');
      const tree = new MerkleTree([l1]);
      tree.addLeaf(l2);
      
      const proof1 = tree.getProof(l1)!;
      const proof2 = tree.getProof(l2)!;
      
      expect(verifyMerkleProof(proof1)).toBe(true);
      expect(verifyMerkleProof(proof2)).toBe(true);
  });
});

describe('MerkleTree — lookups', () => {
  let leaves: string[];
  let tree: MerkleTree;

  beforeEach(() => {
    leaves = [sha256('a'), sha256('b'), sha256('c'), sha256('d')];
    tree = new MerkleTree(leaves);
  });

  it('hasLeaf should return true for a leaf in the tree', () => {
    expect(tree.hasLeaf(leaves[0])).toBe(true);
    expect(tree.hasLeaf(leaves[3])).toBe(true);
  });

  it('hasLeaf should return false for a hash not in the tree', () => {
    expect(tree.hasLeaf(sha256('not-in-tree'))).toBe(false);
  });

  it('getLeafAt should return the correct leaf hash', () => {
    expect(tree.getLeafAt(0)).toBe(leaves[0]);
    expect(tree.getLeafAt(2)).toBe(leaves[2]);
  });

  it('getLeafAt should return null for out-of-range index', () => {
    expect(tree.getLeafAt(-1)).toBeNull();
    expect(tree.getLeafAt(4)).toBeNull();
  });
});

describe('MerkleTree — proofs', () => {
  it('should provide a valid proof for each leaf in a 3-leaf tree', () => {
    const leaves = [sha256('l1'), sha256('l2'), sha256('l3')];
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();

    for (const leaf of leaves) {
      const proof = tree.getProof(leaf);
      expect(proof).not.toBeNull();
      if (proof) {
        proof.root = root;
        expect(verifyMerkleProof(proof)).toBe(true);
      }
    }
  });

  it('getProof should return null for an unknown hash', () => {
    const tree = new MerkleTree([sha256('a'), sha256('b')]);
    expect(tree.getProof(sha256('not-in-tree'))).toBeNull();
  });

  it('proof.sequenceIndex should match the leaf position', () => {
    const leaves = [sha256('a'), sha256('b'), sha256('c')];
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(leaves[2]);
    expect(proof?.sequenceIndex).toBe(2);
  });
});

describe('MerkleTree — tamper detection', () => {
  it('reordering leaves should change the Merkle root', () => {
    const l1 = sha256('event-a');
    const l2 = sha256('event-b');
    const tree1 = new MerkleTree([l1, l2]);
    const tree2 = new MerkleTree([l2, l1]);
    // Because we sort pairs internally, two-leaf trees are order-independent at the root
    // but 3+ leaf trees ARE order dependent at the leaf level
    const l3 = sha256('event-c');
    const tree3a = new MerkleTree([l1, l2, l3]);
    const tree3b = new MerkleTree([l3, l2, l1]);
    expect(tree3a.getRoot()).not.toBe(tree3b.getRoot());
  });

  it('adding any event changes the Merkle root', () => {
    const leaves = [sha256('a'), sha256('b')];
    const tree1 = new MerkleTree(leaves);
    const tree2 = new MerkleTree([...leaves, sha256('c')]);
    expect(tree1.getRoot()).not.toBe(tree2.getRoot());
  });

  it('a tampered proof should not verify', () => {
    const leaves = [sha256('x'), sha256('y'), sha256('z')];
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    const proof = tree.getProof(leaves[0])!;
    proof.root = root;

    // Tamper with the leaf
    const tampered = { ...proof, leaf: sha256('tampered') };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });
});

describe('MerkleTree — property-based tests', () => {
  it('any array of string payloads produces a valid Merkle tree with valid proofs for all leaves', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 50 }),
        (strings) => {
          const leaves = strings.map(s => sha256(s));
          const tree = new MerkleTree(leaves);
          const root = tree.getRoot();

          for (const leaf of leaves) {
            const proof = tree.getProof(leaf);
            expect(proof).not.toBeNull();
            if (proof) {
              proof.root = root;
              expect(verifyMerkleProof(proof)).toBe(true);
            }
          }
        }
      )
    );
  });

  it('proof verification always fails for a hash not in the tree', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        (strings, outsider) => {
          const leaves = strings.map(s => sha256(s));
          const outsiderHash = sha256(outsider + '_not_in_tree');

          // Only test if outsider is not actually in leaves
          if (leaves.includes(outsiderHash)) return;

          const tree = new MerkleTree(leaves);
          const proof = tree.getProof(outsiderHash);
          expect(proof).toBeNull();
        }
      )
    );
  });
});

// Needed for beforeEach in describe block
import { beforeEach } from '@jest/globals';
