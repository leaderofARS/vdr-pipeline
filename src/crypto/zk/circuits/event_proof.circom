pragma circom 2.0.0;

import "node_modules/circomlib/circuits/sha256/sha256.circom";
import "node_modules/circomlib/circuits/merkle/merkle.circom";
import "node_modules/circomlib/circuits/comparators.circom";

/**
 * VDR Circuit: Merkle Inclusion + Event Property Proof
 * Proves: 
 * 1. The event hash is part of the anchored Merkle Root.
 * 2. The event payload, when hashed, matches the event hash.
 * 3. A numeric property of the payload (e.g., tokenCount) is less than a threshold.
 * 
 * Public Inputs: merkleRoot, eventHash, threshold
 * Private Inputs: payloadBits, pathElements, pathIndices
 */
template ProveEventIntegrity(nLevels) {
    // ── Public Inputs ──────────────────────────────────────────────────────────
    signal input merkleRoot;
    signal input eventHash;
    signal input threshold;

    // ── Private Inputs ─────────────────────────────────────────────────────────
    signal input payloadBits[256]; // SHA-256 takes 256 bits for simplicity here
    signal input pathElements[nLevels];
    signal input pathIndices[nLevels];

    // ── Constant ───────────────────────────────────────────────────────────────

    // 1. Verify Event Hash matches Payload
    // In a real circuit, we would handle arbitrary string payloads via bytes2bits
    component hasher = Sha256(256);
    for (var i = 0; i < 256; i++) {
        hasher.in[i] <== payloadBits[i];
    }
    hasher.out === eventHash;

    // 2. Verify Merkle Path Inclusion
    component tree = MerkleTree(nLevels);
    tree.leaf <== eventHash;
    for (var i = 0; i < nLevels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === merkleRoot;

    // 3. Verify Property (Selective Disclosure)
    // Example: Proving the first 32 bits of the payload (the token count) 
    // is less than the public threshold
    var tokenCount = 0;
    for (var i = 0; i < 32; i++) {
        tokenCount += payloadBits[i] * (2**i);
    }

    component lt = LessThan(32);
    lt.in[0] <== tokenCount;
    lt.in[1] <== threshold;
    lt.out === 1; // 1 means true
}

component main {public [merkleRoot, eventHash, threshold]} = ProveEventIntegrity(10);
