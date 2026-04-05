import { PipelinePool } from '../../src/core/PipelinePool';
import { Pipeline } from '../../src/core/Pipeline';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the anchoring drivers so we don't need real keys or network
jest.mock('@sipheron/vdr-core', () => ({
  SipHeron: jest.fn().mockImplementation(() => ({
    network: 'devnet',
    anchor: jest.fn<() => Promise<any>>().mockResolvedValue({
      transactionSignature: 'mock_tx_sig',
      id: 'mock_anchor_id'
    })
  })),
  anchorToSolana: jest.fn<() => Promise<any>>().mockResolvedValue({
    transactionSignature: 'mock_direct_sig'
  }),
  // hashDocument must be included so eventHasher.ts still works
  hashDocument: jest.fn().mockImplementation(async (...args: any[]) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(args[0]).digest('hex');
  })
}));

describe('PipelinePool', () => {
  let pool: PipelinePool;

  beforeEach(() => {
    pool = new PipelinePool({ apiKey: 'test-key' });
  });

  describe('getOrCreate', () => {
    it('should create a new Pipeline instance for a new key', () => {
      const pipeline = pool.getOrCreate('session-1', 'my-agent');
      expect(pipeline).toBeInstanceOf(Pipeline);
      expect(pool.size()).toBe(1);
    });

    it('should return the same Pipeline instance for the same key', () => {
      const p1 = pool.getOrCreate('session-1', 'my-agent');
      const p2 = pool.getOrCreate('session-1', 'my-agent');
      expect(p1).toBe(p2);
      expect(pool.size()).toBe(1);
    });

    it('should create independent instances for different keys', () => {
      const p1 = pool.getOrCreate('session-1', 'agent-a');
      const p2 = pool.getOrCreate('session-2', 'agent-b');
      expect(p1).not.toBe(p2);
      expect(pool.size()).toBe(2);
    });

    it('created Pipeline should have pipelineName set correctly', () => {
      const pipeline = pool.getOrCreate('session-x', 'my-rag-agent');
      expect(pipeline.getPipelineId()).toBe('my-rag-agent');
    });
  });

  describe('get / has', () => {
    it('has should return false for unknown key', () => {
      expect(pool.has('unknown')).toBe(false);
    });

    it('has should return true after getOrCreate', () => {
      pool.getOrCreate('key-1', 'agent');
      expect(pool.has('key-1')).toBe(true);
    });

    it('get should return undefined for unknown key', () => {
      expect(pool.get('unknown')).toBeUndefined();
    });

    it('get should return the Pipeline after getOrCreate', () => {
      const p = pool.getOrCreate('key-2', 'agent');
      expect(pool.get('key-2')).toBe(p);
    });
  });

  describe('keys / size', () => {
    it('keys should be empty initially', () => {
      expect(pool.keys()).toEqual([]);
      expect(pool.size()).toBe(0);
    });

    it('keys should list all session keys', () => {
      pool.getOrCreate('a', 'ag');
      pool.getOrCreate('b', 'ag');
      pool.getOrCreate('c', 'ag');
      const keys = pool.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
    });
  });

  describe('remove', () => {
    it('should remove an existing session', () => {
      pool.getOrCreate('to-remove', 'agent');
      expect(pool.has('to-remove')).toBe(true);

      const removed = pool.remove('to-remove');
      expect(removed).toBe(true);
      expect(pool.has('to-remove')).toBe(false);
      expect(pool.size()).toBe(0);
    });

    it('should return false for non-existent session', () => {
      expect(pool.remove('non-existent')).toBe(false);
    });
  });

  describe('finalizeAndAnchor', () => {
    it('should finalize and anchor a session, removing it from the pool', async () => {
      const pipeline = pool.getOrCreate('session-fin', 'test-agent');
      await pipeline.logPrompt({ role: 'user', content: 'Hello' });

      const result = await pool.finalizeAndAnchor('session-fin');

      expect(result.mode).toBe('managed');
      expect(result.transactionSignature).toBe('mock_tx_sig');
      expect(pool.has('session-fin')).toBe(false); // removed after anchor
    });

    it('should throw for an unknown session key', async () => {
      await expect(pool.finalizeAndAnchor('not-in-pool')).rejects.toThrow(
        /No session found in pool/
      );
    });
  });

  describe('finalizeAll', () => {
    it('should finalize all sessions and clear the pool', async () => {
      const p1 = pool.getOrCreate('run-1', 'agent');
      const p2 = pool.getOrCreate('run-2', 'agent');

      await p1.logPrompt({ role: 'user', content: 'A' });
      await p2.logPrompt({ role: 'user', content: 'B' });

      const results = await pool.finalizeAll();

      expect(results.size).toBe(2);
      expect(results.has('run-1')).toBe(true);
      expect(results.has('run-2')).toBe(true);
      expect(pool.size()).toBe(0); // both removed after anchor
    });

    it('should leave failed sessions in the pool for retry', async () => {
      // Mock one anchor to fail
      const { SipHeron } = require('@sipheron/vdr-core');
      let firstCall = true;
      SipHeron.mockImplementation(() => ({
        network: 'devnet',
        anchor: jest.fn<() => Promise<any>>().mockImplementation(() => {
          if (firstCall) {
              firstCall = false;
              return Promise.resolve({ transactionSignature: 'ok_sig', id: 'id1' });
          }
          return Promise.reject(new Error('RPC failure'));
        })
      }));

      const pool2 = new PipelinePool({ apiKey: 'test-key' });
      const p1 = pool2.getOrCreate('ok-session', 'agent');
      const p2 = pool2.getOrCreate('fail-session', 'agent');

      await p1.logPrompt({ role: 'user', content: 'A' });
      await p2.logPrompt({ role: 'user', content: 'B' });

      const results = await pool2.finalizeAll();

      // One succeeded
      expect(results.size).toBe(1);
      // Failed session remains in pool
      expect(pool2.size()).toBe(1);
    }, 30000);
  });
});
