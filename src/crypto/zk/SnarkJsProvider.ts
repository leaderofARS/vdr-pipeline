// @ts-ignore: snarkjs might not be in dev environment yet
import * as snarkjs from 'snarkjs';
import { PipelineEvent, MerkleProof, ZKProof, ZKProofProvider } from '../../types';
import { ZKProofError } from '../../errors';

export interface SnarkJsConfig {
  /** Path to the compiled circuit .wasm file */
  wasmPath: string;
  /** Path to the circuit proving key .zkey file */
  zkeyPath: string;
  /** Path to the verification key .json file (for verification side) */
  vkeyPath?: string;
  /** Optional verification key object (if vkeyPath is not provided) */
  vkey?: any;
}

/**
 * A real Zero-Knowledge provider using SnarkJS and Groth16.
 * Implements Phase 8 by bridging the SDK to audited Circom circuits.
 */
export class SnarkJsProvider implements ZKProofProvider {
  readonly name = 'SnarkJsProvider';
  private config: SnarkJsConfig;

  constructor(config: SnarkJsConfig) {
    this.config = config;
  }

  /**
   * Generates a real Groth16 ZK-SNARK proof that a claim about an event is true
   * and that the event is part of a verified Merkle root — without revealing the event content.
   */
  async prove(params: {
    event: PipelineEvent;
    merkleProof: MerkleProof;
    claim: string;
    merkleRoot: string;
  }): Promise<ZKProof> {
    
    // 1. Prepare private and public inputs for the circuit
    // Private: The event payload + sibling hashes (merkle path)
    // Public: Merkle Root, Event Hash, Claim threshold
    const inputs = this.prepareCircuitInputs(params);

    try {
      // 2. Compute witness and generate proof using SnarkJS
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        inputs,
        this.config.wasmPath,
        this.config.zkeyPath
      );

      return {
        format: 'groth16',
        claim: params.claim,
        merkleRoot: params.merkleRoot,
        eventHash: params.event.hash,
        publicInputs: publicSignals,
        proof: proof
      };
    } catch (err: any) {
      throw new ZKProofError(`SnarkJs proving failed: ${err.message}`, {
        eventName: params.event.type,
        claim: params.claim
      });
    }
  }

  /**
   * Verifies a SnarkJS proof against the public signals.
   */
  async verify(proof: ZKProof): Promise<boolean> {
    if (proof.format !== 'groth16') {
      throw new ZKProofError(`Invalid proof format: expected groth16, got ${proof.format}`);
    }

    let vkey = this.config.vkey;
    if (!vkey && this.config.vkeyPath) {
        // In Node.js environments, we'd require('fs').readFileSync(vkeyPath)
        // For the SDK, we expect the user to have loaded the vkey into the config
        throw new ZKProofError('Verification key (vkey) not loaded in SnarkJsProvider config.');
    }

    try {
      return await snarkjs.groth16.verify(vkey, proof.publicInputs, proof.proof);
    } catch (err: any) {
       throw new ZKProofError(`SnarkJs verification error: ${err.message}`);
    }
  }

  /**
   * Maps a high-level SDK event and claim to the numeric inputs required by a Circom circuit.
   * Field elements in Circom must be < Prime (usually BN128).
   */
  private prepareCircuitInputs(params: {
    event: PipelineEvent;
    merkleProof: MerkleProof;
    claim: string;
    merkleRoot: string;
  }): Record<string, any> {
    
    // Map claim string (e.g. "tokenCount < 500") to numeric parameters
    let threshold = 0;
    if (params.claim.includes('<')) {
        threshold = parseInt(params.claim.split('<')[1]) || 0;
    }

    return {
        // Public Inputs
        root: params.merkleRoot,
        eventHash: params.event.hash,
        threshold: threshold,
        
        // Private Inputs (The "Secret")
        // The circuit will verify SHA256(payload) == eventHash internally
        payload: JSON.stringify(params.event.payload), 
        
        // Merkle Path inclusion proof inputs
        pathElements: params.merkleProof.path.map(p => p.sibling),
        pathIndices: params.merkleProof.path.map(p => p.direction === 'right' ? 1 : 0)
    };
  }
}
