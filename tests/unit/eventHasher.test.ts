import { hashEvent } from '../../src/crypto/eventHasher';
import { PipelineSerializationError } from '../../src/errors';
import { describe, it, expect } from '@jest/globals';

describe('eventHasher', () => {
  it('should hash deterministically with keys sorted alphabetically', async () => {
    const payload1 = { b: 1, a: 2 };
    const payload2 = { a: 2, b: 1 };
    
    const hash1 = await hashEvent('PROMPT', payload1, 1000, 'session-1', 0);
    const hash2 = await hashEvent('PROMPT', payload2, 1000, 'session-1', 0);
    
    expect(hash1).toBe(hash2);
  });

  it('should strip undefined values and maintain determinism', async () => {
    const payload1 = { a: 2 };
    const payload2 = { a: 2, b: undefined };
    
    const hash1 = await hashEvent('PROMPT', payload1, 1000, 'session-1', 0);
    const hash2 = await hashEvent('PROMPT', payload2, 1000, 'session-1', 0);
    
    expect(hash1).toBe(hash2);
  });

  it('should throw PipelineSerializationError for circular references', async () => {
    const payload: any = { a: 1 };
    payload.self = payload;
    
    await expect(hashEvent('PROMPT', payload, 1000, 'session-1', 0))
      .rejects.toThrow(PipelineSerializationError);
  });
});
