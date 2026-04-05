import { Pipeline } from '../../src/core/Pipeline';
import { SessionFinalizedError, EmptySessionError, AnchorConfigError } from '../../src/errors';
import { verifyMerkleProof } from '../../src/crypto/proofVerifier';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

describe('Pipeline Session State Machine', () => {
  it('should start in idle and transition to active automatically', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test-agent' });
    expect(pipeline.getSessionStatus()).toBe('idle');

    await pipeline.logPrompt({ role: 'user', content: 'test' });

    expect(pipeline.getSessionStatus()).toBe('active');
    expect(pipeline.getEventCount()).toBe(1);
    expect(pipeline.getSessionId()).toBeDefined();
  });

  it('should throw AnchorConfigError if neither apiKey nor solanaSecretKey provided', () => {
    expect(() => new Pipeline({ pipelineName: 'test' })).toThrow(AnchorConfigError);
  });

  it('should throw EmptySessionError if finalizing with no events', () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test-agent' });
    pipeline.startSession();
    expect(() => pipeline.finalizeOnly()).toThrow(EmptySessionError);
  });

  it('should transition to finalized on finalizeOnly', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test-agent' });
    await pipeline.logPrompt({ role: 'user', content: 'test' });
    const session = pipeline.finalizeOnly();

    expect(pipeline.getSessionStatus()).toBe('finalized');
    expect(session.status).toBe('finalized');
    expect(session.events.length).toBe(1);
    expect(session.merkleRoot).toBeDefined();
    expect(session.merkleRoot).toHaveLength(64);
    expect(session.finalizedAt).toBeDefined();
  });

  it('should throw SessionFinalizedError when logging after finalization', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test-agent' });
    await pipeline.logPrompt({ role: 'user', content: 'test 1' });
    pipeline.finalizeOnly();

    await expect(pipeline.logPrompt({ role: 'user', content: 'test 2' })).rejects.toThrow(SessionFinalizedError);
  });

  it('getPipelineId should return pipelineName from config', () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'my-agent-v2' });
    expect(pipeline.getPipelineId()).toBe('my-agent-v2');
  });

  it('startSession should be idempotent (called twice returns same sessionId)', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    const id1 = pipeline.startSession();
    const id2 = pipeline.startSession();
    expect(id1).toBe(id2);
  });

  it('getSessionId should throw before session is started', () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    expect(() => pipeline.getSessionId()).toThrow();
  });
});

describe('Pipeline Event Logging', () => {
  it('should return a 64-char hex hash from logEvent', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    const hash = await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should accumulate events with monotonically increasing sequenceIndex', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    await pipeline.logPrompt({ role: 'user', content: 'A' });
    await pipeline.logGeneration({ content: 'B', model: 'gpt-4o' });
    await pipeline.logRetrieval({ query: 'C', resultCount: 1 });

    const session = pipeline.finalizeOnly();
    expect(session.events.length).toBe(3);
    expect(session.events[0].sequenceIndex).toBe(0);
    expect(session.events[1].sequenceIndex).toBe(1);
    expect(session.events[2].sequenceIndex).toBe(2);
    expect(session.events[0].type).toBe('PROMPT');
    expect(session.events[1].type).toBe('GENERATION');
    expect(session.events[2].type).toBe('RETRIEVAL');
  });

  it('logCustom should embed subtype in payload', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    await pipeline.logCustom('MY_STEP', { value: 42 });
    const session = pipeline.finalizeOnly();
    expect(session.events[0].type).toBe('CUSTOM');
    expect(session.events[0].payload.subtype).toBe('MY_STEP');
    expect(session.events[0].payload.value).toBe(42);
  });
});

describe('Pipeline Merkle Utilities', () => {
  it('getMerkleRoot should return null before any events', () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    expect(pipeline.getMerkleRoot()).toBeNull();
  });

  it('getMerkleRoot should return null before finalization', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    expect(pipeline.getMerkleRoot()).toBeNull();
  });

  it('getMerkleRoot should return 64-char hex after finalization', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    pipeline.finalizeOnly();
    expect(pipeline.getMerkleRoot()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('getProof should return null before finalization', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    const hash = await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    expect(pipeline.getProof(hash)).toBeNull();
  });

  it('getProof should return a valid proof after finalization', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    const hash1 = await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    const hash2 = await pipeline.logGeneration({ content: 'Hi', model: 'gpt-4o' });
    pipeline.finalizeOnly();

    const proof1 = pipeline.getProof(hash1);
    const proof2 = pipeline.getProof(hash2);

    expect(proof1).not.toBeNull();
    expect(proof2).not.toBeNull();
    expect(proof1!.leaf).toBe(hash1);
    expect(proof1!.root).toHaveLength(64);
    expect(proof1!.sessionId).toBe(pipeline.getSessionId());
  });

  it('verifyProof should return true for a valid proof', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    const hash = await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    await pipeline.logGeneration({ content: 'Hi', model: 'gpt-4o' });
    await pipeline.logRetrieval({ query: 'docs', resultCount: 3 });
    pipeline.finalizeOnly();

    const proof = pipeline.getProof(hash)!;
    expect(pipeline.verifyProof(proof)).toBe(true);
  });

  it('verifyProof should return false for a tampered proof', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    const hash = await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    pipeline.finalizeOnly();

    const proof = pipeline.getProof(hash)!;
    // Tamper with the leaf
    const tamperedProof = { ...proof, leaf: 'a'.repeat(64) };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it('getProof should return null for unknown hash', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    pipeline.finalizeOnly();

    expect(pipeline.getProof('a'.repeat(64))).toBeNull();
  });
});

describe('Pipeline.exportSession', () => {
  it('should include all events, merkleRoot, merkleLeaves, and timestamps', async () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'export-test' });
    await pipeline.logPrompt({ role: 'user', content: 'A' });
    await pipeline.logGeneration({ content: 'B', model: 'gpt-4o' });
    const session = pipeline.finalizeOnly();
    const exported = pipeline.exportSession();

    expect(exported.sessionId).toBe(session.sessionId);
    expect(exported.pipelineId).toBe('export-test');
    expect(exported.status).toBe('finalized');
    expect(exported.events).toHaveLength(2);
    expect(exported.merkleRoot).not.toBeNull();
    expect(exported.merkleLeaves).toHaveLength(2);
    expect(exported.createdAt).toBeGreaterThan(0);
    expect(exported.finalizedAt).toBeGreaterThan(0);
  });

  it('should throw EmptySessionError when exporting an idle session', () => {
    const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'test' });
    expect(() => pipeline.exportSession()).toThrow(EmptySessionError);
  });
});

describe('Pipeline constructor: dual-config warning', () => {
  it('should emit a warning when both apiKey and solanaSecretKey are provided', () => {
    const { Keypair } = require('@solana/web3.js');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const pipeline = new Pipeline({
      pipelineName: 'test',
      apiKey: 'fake-key',
      solanaSecretKey: Keypair.generate().secretKey
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Both apiKey and solanaSecretKey'));
    warnSpy.mockRestore();

    // Managed mode should still be active (no error)
    expect(pipeline.getPipelineId()).toBe('test');
  });
});

describe('Pipeline: custom logger', () => {
  it('should call custom logger instead of console', async () => {
    const logMessages: Array<{ msg: string; level: string }> = [];

    const pipeline = Pipeline.withApiKey('fake-key', {
      pipelineName: 'logger-test',
      logger: (msg, level) => logMessages.push({ msg, level })
    });

    await pipeline.logPrompt({ role: 'user', content: 'Hello' });
    pipeline.finalizeOnly();

    const infoLogs = logMessages.filter(l => l.level === 'info');
    const debugLogs = logMessages.filter(l => l.level === 'debug');

    // Session start is 'info', hash computation is 'debug'
    expect(infoLogs.length).toBeGreaterThan(0);
    expect(infoLogs[0].msg).toContain('Session started');
    expect(debugLogs.length).toBeGreaterThan(0);
  });
});

describe('Pipeline Checkpointing', () => {
    it('should anchor intermediate root without finalizing', async () => {
        const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'checkpoint-test' });
        
        // Mock the anchor driver
        const mockAnchor = jest.fn<any>().mockResolvedValue({
            transactionSignature: 'checkpoint-tx',
            id: 'checkpoint-id'
        });
        (pipeline as any).anchorDriver = { anchor: mockAnchor };

        await pipeline.logPrompt({ role: 'user', content: 'Step 1' });
        
        const result = await pipeline.checkpointAndAnchor();
        
        expect(result.transactionSignature).toBe('checkpoint-tx');
        expect(pipeline.getSessionStatus()).toBe('active');
        expect(mockAnchor).toHaveBeenCalled();
        
        // Should be able to log more after checkpoint
        await pipeline.logGeneration({ content: 'Step 2', model: 'gpt-4' });
        expect(pipeline.getEventCount()).toBe(2);
        
        // Finalize should still work
        pipeline.finalizeOnly();
        expect(pipeline.getSessionStatus()).toBe('finalized');
    });

    it('should throw when checkpointing empty session', async () => {
        const pipeline = Pipeline.withApiKey('fake-key', { pipelineName: 'empty-test' });
        await expect(pipeline.checkpointAndAnchor()).rejects.toThrow(EmptySessionError);
    });
});
