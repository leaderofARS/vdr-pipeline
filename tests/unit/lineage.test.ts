import { describe, it, expect, jest } from '@jest/globals';
import { Pipeline } from '../../src/core/Pipeline';
import { SessionLineageGraph } from '../../src/lineage/SessionLineageGraph';
import {
  buildLineageLeaves,
  buildLineageMerkleTree,
  getLineageProofForSessionRoot,
  verifyLineageProof
} from '../../src/lineage/lineageMerkle';
import { PipelineOrchestrator } from '../../src/lineage/PipelineOrchestrator';
import { LineageError } from '../../src/errors';

jest.mock('@sipheron/vdr-core', () => ({
  SipHeron: jest.fn().mockImplementation(() => ({
    network: 'devnet',
    anchor: jest.fn<() => Promise<any>>().mockResolvedValue({
      transactionSignature: 'lineage_tx',
      id: 'lineage_anchor_id'
    })
  })),
  anchorToSolana: jest.fn<() => Promise<any>>().mockResolvedValue({
    transactionSignature: 'sig_direct'
  }),
  hashDocument: jest.fn().mockImplementation(async (...args: any[]) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(args[0]).digest('hex');
  })
}));

describe('SessionLineageGraph', () => {
  it('rejects cycles', () => {
    const g = new SessionLineageGraph();
    g.registerEdge('a', 'b');
    expect(() => g.registerEdge('b', 'a')).toThrow(LineageError);
  });

  it('lists children', () => {
    const g = new SessionLineageGraph();
    g.registerEdge('p', 'c1');
    g.registerEdge('p', 'c2');
    expect(g.getChildren('p').sort()).toEqual(['c1', 'c2']);
  });
});

describe('lineageMerkle', () => {
  it('orders child roots by sessionId', () => {
    const parent = {
      sessionId: 'p',
      pipelineId: 'orch',
      status: 'finalized' as const,
      events: [],
      merkleRoot: '11'.repeat(32),
      merkleLeaves: [],
      createdAt: 0
    };
    const cZ = {
      sessionId: 'z',
      pipelineId: 'c',
      status: 'finalized' as const,
      events: [],
      merkleRoot: 'aa'.repeat(32),
      merkleLeaves: [],
      createdAt: 0
    };
    const cA = {
      sessionId: 'a',
      pipelineId: 'c',
      status: 'finalized' as const,
      events: [],
      merkleRoot: 'bb'.repeat(32),
      merkleLeaves: [],
      createdAt: 0
    };
    const leaves = buildLineageLeaves(parent, [cZ, cA]);
    expect(leaves[0]).toBe(parent.merkleRoot);
    expect(leaves[1]).toBe(cA.merkleRoot);
    expect(leaves[2]).toBe(cZ.merkleRoot);
  });

  it('proof verifies for child session root', () => {
    const parent = {
      sessionId: 'p',
      pipelineId: 'o',
      status: 'finalized' as const,
      events: [],
      merkleRoot: '01'.repeat(32),
      merkleLeaves: [],
      createdAt: 0
    };
    const child = {
      sessionId: 'c',
      pipelineId: 'x',
      status: 'finalized' as const,
      events: [],
      merkleRoot: '02'.repeat(32),
      merkleLeaves: [],
      createdAt: 0
    };
    const tree = buildLineageMerkleTree(parent, [child]);
    const root = tree.getRoot();
    const proof = getLineageProofForSessionRoot(tree, child.merkleRoot!);
    expect(proof).not.toBeNull();
    expect(verifyLineageProof(proof!, root)).toBe(true);
  });
});

describe('PipelineOrchestrator', () => {
  it('finalizeAllAndAnchorLineage anchors lineage root with three children', async () => {
    const parent = Pipeline.withApiKey('k', { pipelineName: 'orch' });
    await parent.logPrompt({ role: 'user', content: 'task' });

    const orch = new PipelineOrchestrator({
      parent,
      childDefaults: { apiKey: 'k', network: 'devnet' }
    });

    const c1 = await orch.createChild('sub-1');
    await c1.logPrompt({ role: 'user', content: 's1' });
    const c2 = await orch.createChild('sub-2');
    await c2.logPrompt({ role: 'user', content: 's2' });
    const c3 = await orch.createChild('sub-3');
    await c3.logPrompt({ role: 'user', content: 's3' });

    expect(c1.exportSession().events[0].type).toBe('SPAWN');

    const { lineageAnchor, lineageTree, parentSnapshot, childSnapshots } =
      await orch.finalizeAllAndAnchorLineage();

    expect(childSnapshots).toHaveLength(3);
    expect(parentSnapshot.merkleRoot).toHaveLength(64);
    expect(lineageAnchor.transactionSignature).toBe('lineage_tx');
    expect(lineageAnchor.lineageRoot).toBe(lineageTree.getRoot());
    expect(lineageAnchor.includedSessionRoots.length).toBe(4);

    const proof = getLineageProofForSessionRoot(lineageTree, childSnapshots[0].merkleRoot!);
    expect(proof && verifyLineageProof(proof, lineageAnchor.lineageRoot)).toBe(true);
  });
});

describe('Pipeline.createChildFromParent', () => {
  it('records SPAWN first', async () => {
    const parent = Pipeline.withApiKey('k', { pipelineName: 'p' });
    await parent.logPrompt({ role: 'user', content: 'x' });
    const child = await Pipeline.createChildFromParent(parent, {
      apiKey: 'k',
      pipelineName: 'c',
      network: 'devnet'
    });
    await child.logPrompt({ role: 'user', content: 'y' });
    const s = child.exportSession();
    expect(s.events[0].type).toBe('SPAWN');
    expect(s.events[0].payload.parentSessionId).toBe(parent.getSessionId());
  });
});
