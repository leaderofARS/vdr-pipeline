import { Pipeline } from '../../src/core/Pipeline';
import { MerkleTree } from '../../src/crypto/MerkleTree';
import { verifyMerkleProof } from '../../src/crypto/proofVerifier';
import { hashEvent } from '../../src/crypto/eventHasher';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@sipheron/vdr-core', () => ({
  SipHeron: jest.fn().mockImplementation(() => ({
    network: 'devnet',
    anchor: jest.fn<() => Promise<any>>().mockResolvedValue({
      transactionSignature: 'mock_managed_sig',
      id: 'mock_anchor_id'
    })
  })),
  anchorToSolana: jest.fn<() => Promise<any>>().mockResolvedValue({
    transactionSignature: 'mock_direct_sig'
  }),
  hashDocument: jest.fn().mockImplementation(async (...args: any[]) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(args[0]).digest('hex');
  })
}));

describe('Integration: Managed Mode (SipHeron API)', () => {
  it('should complete a full session lifecycle: log → finalize → anchor', async () => {
    const pipeline = Pipeline.withApiKey('test-api-key', {
      pipelineName: 'integration-test-agent',
      network: 'devnet'
    });

    // Log multiple event types
    const promptHash = await pipeline.logPrompt(
      { role: 'user', content: 'Summarize this contract for risks.' },
      { tags: ['contract-analysis'] }
    );

    await pipeline.logRetrieval({
      query: 'contract risks penalties termination',
      resultCount: 5,
      sourceIds: ['chunk_001', 'chunk_002', 'chunk_003', 'chunk_004', 'chunk_005'],
      retrieverName: 'pinecone'
    });

    await pipeline.logGeneration(
      {
        content: 'The key risks include: 1) Auto-renewal clause...',
        model: 'gpt-4o',
        finishReason: 'stop',
        usage: { promptTokens: 1200, completionTokens: 340, totalTokens: 1540 }
      },
      { latencyMs: 1820 }
    );

    expect(pipeline.getSessionStatus()).toBe('active');
    expect(pipeline.getEventCount()).toBe(3);

    // Finalize and anchor
    const result = await pipeline.finalizeAndAnchor();

    expect(result.mode).toBe('managed');
    expect(result.transactionSignature).toBe('mock_managed_sig');
    expect(result.sipheronAnchorId).toBe('mock_anchor_id');
    expect(result.eventCount).toBe(3);
    expect(result.merkleRoot).toHaveLength(64);
    expect(result.explorerUrl).toContain('mock_managed_sig');

    // Session should be finalized
    expect(pipeline.getSessionStatus()).toBe('finalized');

    // Proofs should be available
    const proof = pipeline.getProof(promptHash);
    expect(proof).not.toBeNull();
    expect(proof!.leaf).toBe(promptHash);
    expect(proof!.sessionId).toBe(pipeline.getSessionId());
    expect(pipeline.verifyProof(proof!)).toBe(true);
  });

  it('should export a complete PipelineSession snapshot', async () => {
    const pipeline = Pipeline.withApiKey('test-api-key', {
      pipelineName: 'export-integration',
      network: 'devnet'
    });

    await pipeline.logPrompt({ role: 'system', content: 'You are a legal analyst.' });
    await pipeline.logPrompt({ role: 'user', content: 'Review clause 3.' });
    await pipeline.logGeneration({ content: 'Clause 3 states...', model: 'claude-sonnet-4-5' });

    const result = await pipeline.finalizeAndAnchor();
    const session = pipeline.exportSession();

    expect(session.sessionId).toBeDefined();
    expect(session.pipelineId).toBe('export-integration');
    expect(session.status).toBe('finalized');
    expect(session.events).toHaveLength(3);
    expect(session.merkleRoot).toHaveLength(64);
    expect(session.merkleLeaves).toHaveLength(3);
    expect(session.anchorResult).toBeDefined();
    expect(session.anchorResult!.transactionSignature).toBe('mock_managed_sig');
    expect(session.finalizedAt).toBeDefined();
    expect(session.createdAt).toBeLessThanOrEqual(session.finalizedAt!);

    // Verify event ordering
    for (let i = 0; i < session.events.length; i++) {
      expect(session.events[i].sequenceIndex).toBe(i);
    }
  });
});

describe('Integration: Direct Mode (Solana RPC)', () => {
  it('should complete a full session lifecycle with direct anchoring', async () => {
    const { Keypair } = require('@solana/web3.js');
    const pipeline = Pipeline.withSolanaKey(Keypair.generate().secretKey, {
      pipelineName: 'direct-mode-test',
      network: 'devnet',
      rpcEndpoint: 'https://api.devnet.solana.com'
    });

    await pipeline.logPrompt({ role: 'user', content: 'What is the interest rate?' });
    await pipeline.logToolCall({
      toolName: 'rate_calculator',
      arguments: { principal: 100000, term: 30 }
    });
    await pipeline.logToolResult({
      toolName: 'rate_calculator',
      result: { rate: 0.065, monthlyPayment: 632.07 }
    });
    await pipeline.logGeneration({ content: 'The interest rate is 6.5%', model: 'gpt-4o' });

    const result = await pipeline.finalizeAndAnchor();

    expect(result.mode).toBe('direct');
    expect(result.transactionSignature).toBe('mock_direct_sig');
    expect(result.eventCount).toBe(4);
    expect(result.explorerUrl).toContain('devnet');
  });
});

describe('Integration: End-to-End Proof Verification', () => {
  it('should generate valid proofs for all events in a session', async () => {
    const pipeline = Pipeline.withApiKey('test-api-key', {
      pipelineName: 'proof-verification-test',
      network: 'devnet'
    });

    const hashes: string[] = [];
    hashes.push(await pipeline.logPrompt({ role: 'user', content: 'Event 1' }));
    hashes.push(await pipeline.logRetrieval({ query: 'Event 2', resultCount: 3 }));
    hashes.push(await pipeline.logGeneration({ content: 'Event 3', model: 'gpt-4o' }));
    hashes.push(await pipeline.logValidation({ passed: true, validatorName: 'toxicity-check' }));
    hashes.push(await pipeline.logRouting({ decision: 'summarizer-agent', reason: 'User asked for summary' }));

    await pipeline.finalizeAndAnchor();

    // Verify every event has a valid proof
    for (const hash of hashes) {
      const proof = pipeline.getProof(hash);
      expect(proof).not.toBeNull();
      expect(proof!.root).toBe(pipeline.getMerkleRoot());
      expect(verifyMerkleProof(proof!)).toBe(true);
    }
  });

  it('should allow offline proof verification from a stored session snapshot', async () => {
    const pipeline = Pipeline.withApiKey('test-api-key', {
      pipelineName: 'offline-proof-test',
      network: 'devnet'
    });

    const hash1 = await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    const hash2 = await pipeline.logGeneration({ content: 'Hi there', model: 'gpt-4o' });
    await pipeline.finalizeAndAnchor();

    // Export session and serialize (simulating storage)
    const snapshot = pipeline.exportSession();
    const serialized = JSON.stringify(snapshot);
    const restored = JSON.parse(serialized);

    // Reconstruct Merkle tree from restored snapshot
    const tree = new MerkleTree(restored.merkleLeaves);
    expect(tree.getRoot()).toBe(restored.merkleRoot);

    // Verify proof from reconstructed tree
    const proof = tree.getProof(hash1)!;
    expect(proof).not.toBeNull();
    const fullProof = { ...proof, root: restored.merkleRoot! };
    expect(verifyMerkleProof(fullProof)).toBe(true);
  });
});

describe('Integration: Event Determinism', () => {
  it('should produce identical hashes for identical events across pipeline instances', async () => {
    // Two separate pipelines with same sessionId and data should produce same hashes
    const hash1 = await hashEvent('PROMPT', { role: 'user', content: 'Test' }, 1000, 'session-x', 0);
    const hash2 = await hashEvent('PROMPT', { role: 'user', content: 'Test' }, 1000, 'session-x', 0);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for same content at different sequenceIndex', async () => {
    const hash1 = await hashEvent('PROMPT', { role: 'user', content: 'Test' }, 1000, 'session-x', 0);
    const hash2 = await hashEvent('PROMPT', { role: 'user', content: 'Test' }, 1000, 'session-x', 1);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hashes for same content in different sessions', async () => {
    const hash1 = await hashEvent('PROMPT', { role: 'user', content: 'Test' }, 1000, 'session-a', 0);
    const hash2 = await hashEvent('PROMPT', { role: 'user', content: 'Test' }, 1000, 'session-b', 0);
    expect(hash1).not.toBe(hash2);
  });
});
