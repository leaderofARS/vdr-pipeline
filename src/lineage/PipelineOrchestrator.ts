import * as crypto from 'crypto';
import { Pipeline } from '../core/Pipeline';
import { MerkleTree } from '../crypto/MerkleTree';
import { EmptySessionError, LineageError, SessionFinalizedError } from '../errors';
import type {
  LineageAnchorResult,
  PipelineConfig,
  PipelineSession,
  PipelineSessionLineageMeta
} from '../types';
import { SessionLineageGraph } from './SessionLineageGraph';
import { buildLineageLeaves } from './lineageMerkle';

export interface PipelineOrchestratorOptions {
  /** Orchestrator (parent) pipeline — must have an active session with anchor credentials. */
  parent: Pipeline;
  /**
   * Merged into each child `Pipeline` (must include the same `apiKey` / `solanaSecretKey` / `network` as the parent).
   */
  childDefaults: Omit<PipelineConfig, 'pipelineName' | 'parentSessionId'>;
}

/**
 * Coordinates a parent pipeline and N child pipelines, tracks lineage in a DAG, builds a cross-session
 * Merkle tree over session roots, and anchors a single lineage root using the parent's anchor driver.
 *
 * On-chain: commits the lineage Merkle root via the same anchor path as a normal batch/session root.
 * A dedicated `register_lineage_root` instruction can be adopted later without changing proof layout.
 */
export class PipelineOrchestrator {
  readonly graph = new SessionLineageGraph();
  private readonly parent: Pipeline;
  private readonly childDefaults: Omit<PipelineConfig, 'pipelineName' | 'parentSessionId'>;
  private readonly children: Pipeline[] = [];

  constructor(opts: PipelineOrchestratorOptions) {
    this.parent = opts.parent;
    this.childDefaults = opts.childDefaults;
  }

  /**
   * Create a child pipeline linked to the parent's current session (logs `SPAWN` automatically).
   */
  async createChild(pipelineName: string, options?: { parentEventHash?: string }): Promise<Pipeline> {
    let parentId: string;
    try {
      parentId = this.parent.getSessionId();
    } catch {
      throw new LineageError('Parent pipeline must have started a session before createChild().', {});
    }
    
    // Automatically capture parentEventHash if not provided explicitly, linking it to the last parent event
    const causalHash = options?.parentEventHash ?? this.parent.getLastEventHash();

    const child = await Pipeline.createChildFromParent(this.parent, {
      ...this.childDefaults,
      pipelineName
    }, { parentEventHash: causalHash });
    this.children.push(child);
    this.graph.registerNode(parentId, this.parent.getPipelineId());
    this.graph.registerNode(child.getSessionId(), pipelineName);
    this.graph.registerEdge(parentId, child.getSessionId());
    return child;
  }

  getChildren(): readonly Pipeline[] {
    return this.children;
  }

  /**
   * Finalize all active child sessions, finalize the parent, build the lineage Merkle tree, and anchor its root.
   */
  async finalizeAllAndAnchorLineage(): Promise<{
    lineageAnchor: LineageAnchorResult;
    lineageTree: MerkleTree;
    parentSnapshot: PipelineSession;
    childSnapshots: PipelineSession[];
  }> {
    if (this.parent.getSessionStatus() === 'idle') {
      throw new EmptySessionError('Parent pipeline has no session to finalize.', {});
    }
    if (this.parent.getSessionStatus() === 'finalized') {
      throw new SessionFinalizedError('Parent pipeline is already finalized.', {});
    }

    const childSnapshots: PipelineSession[] = [];
    for (const c of this.children) {
      if (c.getSessionStatus() === 'active') {
        childSnapshots.push(c.finalizeOnly());
      } else if (c.getSessionStatus() === 'finalized') {
        childSnapshots.push(c.exportSession());
      }
    }

    const parentSnapshot = this.parent.finalizeOnly();
    const leaves = buildLineageLeaves(parentSnapshot, childSnapshots);
    const tree = new MerkleTree(leaves);
    const lineageRoot = tree.getRoot();
    const childIds = childSnapshots.map((s) => s.sessionId).sort((a, b) => a.localeCompare(b));

    const lineageMeta: PipelineSessionLineageMeta = {
      parentSessionId: parentSnapshot.sessionId,
      childSessionIds: childIds
    };

    const lineageSession: PipelineSession = {
      sessionId: crypto.randomUUID(),
      pipelineId: `lineage:${parentSnapshot.pipelineId}`,
      status: 'finalized',
      events: [],
      merkleRoot: lineageRoot,
      merkleLeaves: leaves,
      createdAt: Date.now(),
      finalizedAt: Date.now(),
      lineage: lineageMeta
    };

    const base = await this.parent.anchorSessionSnapshot(lineageSession);
    const lineageAnchor: LineageAnchorResult = {
      ...base,
      lineageRoot,
      parentSessionId: parentSnapshot.sessionId,
      childSessionIds: childIds,
      includedSessionRoots: leaves
    };

    return {
      lineageAnchor,
      lineageTree: tree,
      parentSnapshot,
      childSnapshots
    };
  }
}
