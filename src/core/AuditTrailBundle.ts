import * as crypto from 'crypto';
import { PipelineSession, PipelineEvent, MerkleProof } from '../types';
import { MerkleTree } from '../crypto/MerkleTree';
import { verifyMerkleProof } from '../crypto/proofVerifier';

/**
 * AuditTrailBundle produces a W3C-aligned, self-contained cryptographic
 * audit record that can be independently verified by any third party
 * without access to the original SDK or SipHeron platform.
 *
 * ## Structure
 * The bundle is a single JSON object containing:
 * 1. **Envelope** — integrity metadata (version, algorithm, timestamps)
 * 2. **Events** — full event array with hashes
 * 3. **Merkle** — root, leaves, and all proofs
 * 4. **Anchor** — on-chain transaction reference
 * 5. **Integrity** — SHA-256 digest of the canonical bundle
 *
 * ## Compliance Standards
 * - SOC 2 Type II audit trail requirements
 * - GDPR Article 30 processing records
 * - EU AI Act Article 12 record-keeping obligations
 * - W3C Verifiable Credentials data model alignment
 *
 * @example
 * ```typescript
 * const session = pipeline.exportSession();
 * const bundle = AuditTrailBundle.fromSession(session);
 *
 * // Verify the entire bundle
 * const result = bundle.verify();
 * console.log(result.valid);           // true
 * console.log(result.merkleIntegrity); // true
 * console.log(result.chainIntegrity);  // true
 *
 * // Export for compliance storage
 * const json = bundle.toJSON();
 * ```
 */

export interface AuditBundleFormat {
  '@context': string;
  '@type': string;
  version: string;
  generatedAt: string;
  
  envelope: {
    sessionId: string;
    pipelineId: string;
    hashAlgorithm: string;
    merkleAlgorithm: string;
    eventCount: number;
    createdAt: string;
    finalizedAt: string | null;
  };

  events: Array<{
    id: string;
    type: string;
    sequenceIndex: number;
    hash: string;
    timestamp: string;
    payloadDigest: string;
    metadata?: Record<string, any>;
  }>;

  merkle: {
    root: string | null;
    leafCount: number;
    leaves: string[];
    treeDepth: number | null;
    proofs: Record<string, {
      path: Array<{ sibling: string; direction: string }>;
      sequenceIndex: number;
    }>;
  };

  anchor: {
    mode: string | null;
    transactionSignature: string | null;
    explorerUrl: string | null;
    anchoredAt: string | null;
    sipheronAnchorId?: string;
  };

  integrity: {
    bundleDigest: string;
    algorithm: string;
  };
}

export interface VerificationResult {
  valid: boolean;
  merkleIntegrity: boolean;
  proofIntegrity: boolean;
  sequenceIntegrity: boolean;
  hashIntegrity: boolean;
  anchorPresent: boolean;
  errors: string[];
}

export class AuditTrailBundle {
  private bundle: AuditBundleFormat;

  private constructor(bundle: AuditBundleFormat) {
    this.bundle = bundle;
  }

  /**
   * Create an audit bundle from a PipelineSession.
   */
  static fromSession(session: PipelineSession): AuditTrailBundle {
    // Build Merkle proofs for all events
    let tree: MerkleTree | null = null;
    const proofs: Record<string, { path: Array<{ sibling: string; direction: string }>; sequenceIndex: number }> = {};

    if (session.merkleRoot && session.merkleLeaves.length > 0) {
      tree = new MerkleTree(session.merkleLeaves);
      for (const leaf of session.merkleLeaves) {
        const proof = tree.getProof(leaf);
        if (proof) {
          proofs[leaf] = {
            path: proof.path.map(p => ({ sibling: p.sibling, direction: p.direction })),
            sequenceIndex: proof.sequenceIndex,
          };
        }
      }
    }

    // Build event summaries (never include raw payload in bundle — only digest)
    const events = session.events.map(event => ({
      id: event.id,
      type: event.type,
      sequenceIndex: event.sequenceIndex,
      hash: event.hash,
      timestamp: new Date(event.timestamp).toISOString(),
      payloadDigest: crypto
        .createHash('sha256')
        .update(JSON.stringify(event.payload))
        .digest('hex'),
      metadata: event.metadata,
    }));

    const bundleData: Omit<AuditBundleFormat, 'integrity'> = {
      '@context': 'https://w3id.org/security/v2',
      '@type': 'AuditTrailBundle',
      version: '1.0.0',
      generatedAt: new Date().toISOString(),

      envelope: {
        sessionId: session.sessionId,
        pipelineId: session.pipelineId,
        hashAlgorithm: 'SHA-256',
        merkleAlgorithm: 'sorted-pair-sha256',
        eventCount: session.events.length,
        createdAt: new Date(session.createdAt).toISOString(),
        finalizedAt: session.finalizedAt ? new Date(session.finalizedAt).toISOString() : null,
      },

      events,

      merkle: {
        root: session.merkleRoot,
        leafCount: session.merkleLeaves.length,
        leaves: session.merkleLeaves,
        treeDepth: tree ? tree.getDepth() : null,
        proofs,
      },

      anchor: {
        mode: session.anchorResult?.mode ?? null,
        transactionSignature: session.anchorResult?.transactionSignature ?? null,
        explorerUrl: session.anchorResult?.explorerUrl ?? null,
        anchoredAt: session.anchorResult?.anchoredAt
          ? new Date(session.anchorResult.anchoredAt).toISOString()
          : null,
        sipheronAnchorId: session.anchorResult?.sipheronAnchorId,
      },
    };

    // Compute integrity digest over the canonical bundle
    const bundleDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify(bundleData))
      .digest('hex');

    const fullBundle: AuditBundleFormat = {
      ...bundleData,
      integrity: {
        bundleDigest,
        algorithm: 'SHA-256',
      },
    };

    return new AuditTrailBundle(fullBundle);
  }

  /**
   * Verify the integrity of the bundle:
   * 1. Merkle root recomputation from leaves
   * 2. All proofs verify against the root
   * 3. Sequence indices are monotonically increasing
   * 4. Event hashes match leaf order
   * 5. Bundle digest is valid
   */
  verify(): VerificationResult {
    const errors: string[] = [];
    let merkleIntegrity = true;
    let proofIntegrity = true;
    let sequenceIntegrity = true;
    let hashIntegrity = true;

    // 1. Verify sequence indices
    const indices = this.bundle.events.map(e => e.sequenceIndex);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        sequenceIntegrity = false;
        errors.push(`Event at position ${i} has sequenceIndex ${indices[i]}, expected ${i}`);
      }
    }

    // 2. Verify Merkle root from leaves
    if (this.bundle.merkle.root && this.bundle.merkle.leaves.length > 0) {
      try {
        const tree = new MerkleTree(this.bundle.merkle.leaves);
        if (tree.getRoot() !== this.bundle.merkle.root) {
          merkleIntegrity = false;
          errors.push('Merkle root recomputation does not match stored root');
        }
      } catch (err: any) {
        merkleIntegrity = false;
        errors.push(`Merkle tree construction failed: ${err.message}`);
      }
    }

    // 3. Verify all proofs
    if (this.bundle.merkle.root) {
      for (const [leaf, proofData] of Object.entries(this.bundle.merkle.proofs)) {
        const proof: MerkleProof = {
          leaf,
          root: this.bundle.merkle.root,
          sessionId: this.bundle.envelope.sessionId,
          sequenceIndex: proofData.sequenceIndex,
          path: proofData.path.map(p => ({
            sibling: p.sibling,
            direction: p.direction as 'left' | 'right',
          })),
        };

        if (!verifyMerkleProof(proof)) {
          proofIntegrity = false;
          errors.push(`Proof verification failed for leaf ${leaf.slice(0, 12)}...`);
        }
      }
    }

    // 4. Verify event hashes match leaf ordering
    if (this.bundle.merkle.leaves.length > 0) {
      for (let i = 0; i < this.bundle.events.length; i++) {
        if (this.bundle.events[i].hash !== this.bundle.merkle.leaves[i]) {
          hashIntegrity = false;
          errors.push(
            `Event #${i} hash ${this.bundle.events[i].hash.slice(0, 12)}... ` +
            `does not match leaf ${this.bundle.merkle.leaves[i].slice(0, 12)}...`
          );
        }
      }
    }

    // 5. Verify bundle integrity digest
    const { integrity, ...bundleWithoutIntegrity } = this.bundle;
    const recomputedDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify(bundleWithoutIntegrity))
      .digest('hex');

    if (recomputedDigest !== integrity.bundleDigest) {
      errors.push('Bundle integrity digest mismatch — bundle may have been tampered with');
    }

    return {
      valid: merkleIntegrity && proofIntegrity && sequenceIntegrity && hashIntegrity && errors.length === 0,
      merkleIntegrity,
      proofIntegrity,
      sequenceIntegrity,
      hashIntegrity,
      anchorPresent: !!this.bundle.anchor.transactionSignature,
      errors,
    };
  }

  /**
   * Export the bundle as a JSON-serializable object.
   */
  toJSON(): AuditBundleFormat {
    return JSON.parse(JSON.stringify(this.bundle));
  }

  /**
   * Export the bundle as a formatted JSON string.
   */
  toString(): string {
    return JSON.stringify(this.bundle, null, 2);
  }

  /**
   * Restore an AuditTrailBundle from a serialized JSON object.
   */
  static fromJSON(data: AuditBundleFormat): AuditTrailBundle {
    return new AuditTrailBundle(data);
  }

  /**
   * Get the bundle digest (SHA-256 of the canonical bundle body).
   */
  getDigest(): string {
    return this.bundle.integrity.bundleDigest;
  }

  /**
   * Get the Merkle root.
   */
  getMerkleRoot(): string | null {
    return this.bundle.merkle.root;
  }

  /**
   * Get the anchor transaction signature.
   */
  getTransactionSignature(): string | null {
    return this.bundle.anchor.transactionSignature;
  }

  /**
   * Get the event count.
   */
  getEventCount(): number {
    return this.bundle.envelope.eventCount;
  }
}
