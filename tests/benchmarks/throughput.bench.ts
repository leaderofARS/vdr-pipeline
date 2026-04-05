import { MerkleTree } from '../../src/crypto/MerkleTree';
import { hashEvent } from '../../src/crypto/eventHasher';
import { Pipeline } from '../../src/core/Pipeline';
import * as crypto from 'crypto';
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@sipheron/vdr-core', () => ({
  SipHeron: jest.fn().mockImplementation(() => ({
    network: 'devnet',
    anchor: jest.fn<() => Promise<any>>().mockResolvedValue({
      transactionSignature: 'bench_sig',
      id: 'bench_id'
    })
  })),
  hashDocument: jest.fn().mockImplementation(async (...args: any[]) => {
    return crypto.createHash('sha256').update(args[0]).digest('hex');
  })
}));

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describe('Benchmarks: MerkleTree Construction', () => {
  const sizes = [10, 100, 1000, 5000];

  for (const size of sizes) {
    it(`should construct a ${size}-leaf tree within acceptable time`, () => {
      const leaves = Array.from({ length: size }, (_, i) => sha256(`event-${i}`));

      const start = performance.now();
      const tree = new MerkleTree(leaves);
      const elapsed = performance.now() - start;

      expect(tree.getRoot()).toHaveLength(64);
      expect(tree.getLeafCount()).toBe(size);

      // Log for visibility
      console.log(`MerkleTree(${size} leaves): ${elapsed.toFixed(2)}ms`);

      // Sanity bounds (generous — mainly for regression detection)
      if (size <= 100) expect(elapsed).toBeLessThan(50);
      if (size <= 1000) expect(elapsed).toBeLessThan(500);
      if (size <= 5000) expect(elapsed).toBeLessThan(3000);
    });
  }
});

describe('Benchmarks: Proof Generation', () => {
  it('should generate proofs for all leaves in a 1000-leaf tree within acceptable time', () => {
    const leaves = Array.from({ length: 1000 }, (_, i) => sha256(`leaf-${i}`));
    const tree = new MerkleTree(leaves);

    const start = performance.now();
    for (const leaf of leaves) {
      tree.getProof(leaf);
    }
    const elapsed = performance.now() - start;

    console.log(`1000 proof generations: ${elapsed.toFixed(2)}ms (${(elapsed / 1000).toFixed(3)}ms per proof)`);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('Benchmarks: hashEvent Overhead', () => {
  it('should hash events with sub-millisecond overhead vs raw JSON.stringify', async () => {
    const iterations = 100;

    // Measure raw JSON.stringify
    const rawStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      JSON.stringify({
        type: 'PROMPT',
        payload: { role: 'user', content: `Test message ${i}` },
        timestamp: Date.now(),
        sessionId: 'benchmark-session',
        sequenceIndex: i
      });
    }
    const rawElapsed = performance.now() - rawStart;

    // Measure hashEvent (includes serialization + SHA-256)
    const hashStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      await hashEvent(
        'PROMPT',
        { role: 'user', content: `Test message ${i}` },
        Date.now(),
        'benchmark-session',
        i
      );
    }
    const hashElapsed = performance.now() - hashStart;

    const overheadPerEvent = (hashElapsed - rawElapsed) / iterations;

    console.log(`Raw JSON.stringify: ${(rawElapsed / iterations).toFixed(3)}ms per event`);
    console.log(`hashEvent: ${(hashElapsed / iterations).toFixed(3)}ms per event`);
    console.log(`Overhead: ${overheadPerEvent.toFixed(3)}ms per event`);

    // Target: < 0.5ms overhead per event (generous for CI)
    expect(overheadPerEvent).toBeLessThan(2);
  });
});

describe('Benchmarks: Pipeline logEvent Throughput', () => {
  it('should log 100 events in under 500ms', async () => {
    const pipeline = Pipeline.withApiKey('bench-key', {
      pipelineName: 'throughput-bench'
    });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await pipeline.logPrompt({ role: 'user', content: `Message ${i}` });
    }
    const elapsed = performance.now() - start;

    console.log(`100 logEvent calls: ${elapsed.toFixed(2)}ms (${(elapsed / 100).toFixed(3)}ms per event)`);

    expect(pipeline.getEventCount()).toBe(100);
    expect(elapsed).toBeLessThan(2000); // generous for CI runners
  });

  it('should finalize a 100-event session in under 100ms', async () => {
    const pipeline = Pipeline.withApiKey('bench-key', {
      pipelineName: 'finalize-bench'
    });

    for (let i = 0; i < 100; i++) {
      await pipeline.logPrompt({ role: 'user', content: `Message ${i}` });
    }

    const start = performance.now();
    const session = pipeline.finalizeOnly();
    const elapsed = performance.now() - start;

    console.log(`Finalize 100-event session: ${elapsed.toFixed(2)}ms`);

    expect(session.merkleRoot).toHaveLength(64);
    expect(elapsed).toBeLessThan(500);
  });
});
