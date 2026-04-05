import { describe, it, expect } from '@jest/globals';
import { comparePipelineSessions } from '../../src/dashboard/sessionCompare';
import { proofToExplorerBundle, verifyProofForExplorer } from '../../src/dashboard/proofExplorer';
import type { PipelineSession, MerkleProof } from '../../src/types';

describe('comparePipelineSessions', () => {
  it('computes hash and type deltas', () => {
    const a: PipelineSession = {
      sessionId: 's1',
      pipelineId: 'p',
      status: 'finalized',
      events: [
        {
          id: '1',
          sessionId: 's1',
          sequenceIndex: 0,
          type: 'PROMPT',
          payload: {},
          hash: 'aa'.repeat(32),
          timestamp: 1
        },
        {
          id: '2',
          sessionId: 's1',
          sequenceIndex: 1,
          type: 'GENERATION',
          payload: {},
          hash: 'bb'.repeat(32),
          timestamp: 2
        }
      ],
      merkleRoot: 'cc'.repeat(32),
      merkleLeaves: ['aa'.repeat(32), 'bb'.repeat(32)],
      createdAt: 0
    };
    const b: PipelineSession = {
      ...a,
      sessionId: 's2',
      events: [a.events[0]],
      merkleLeaves: ['aa'.repeat(32)],
      merkleRoot: 'dd'.repeat(32)
    };
    const d = comparePipelineSessions(a, b);
    expect(d.samePipeline).toBe(true);
    expect(d.merkleRootsMatch).toBe(false);
    expect(d.eventCountDelta).toBe(1);
    expect(d.hashesOnlyInA).toEqual(['bb'.repeat(32)]);
    expect(d.typeCountDelta.GENERATION).toBe(1);
  });
});

describe('proofExplorer', () => {
  it('builds explorer bundle and verifies', () => {
    const proof: MerkleProof = {
      leaf: 'aa'.repeat(32),
      root: 'aa'.repeat(32),
      sessionId: 's',
      sequenceIndex: 0,
      path: []
    };
    const bundle = proofToExplorerBundle(proof);
    expect(bundle.kind).toBe('vdr-pipeline-merkle-proof');
    expect(bundle.pathDepth).toBe(0);
    expect(verifyProofForExplorer(proof)).toBe(true);
  });
});
