import { LineageError } from '../errors';

/**
 * In-memory DAG of session parent/child links, keyed for queries by `pipelineName` on registered nodes.
 * Stores only public session ids and pipeline labels — no secrets.
 */
export class SessionLineageGraph {
  private readonly children = new Map<string, Set<string>>();
  private readonly pipelineBySession = new Map<string, string>();

  /** Register a node for filtering by pipeline name. */
  registerNode(sessionId: string, pipelineName: string): void {
    this.pipelineBySession.set(sessionId, pipelineName);
  }

  /**
   * Record that `parentSessionId` spawned `childSessionId`. Rejects cycles.
   */
  registerEdge(parentSessionId: string, childSessionId: string): void {
    if (parentSessionId === childSessionId) {
      throw new LineageError('Self-edge is not allowed in lineage graph.', {
        sessionId: childSessionId
      });
    }
    if (this.wouldCreateCycle(parentSessionId, childSessionId)) {
      throw new LineageError('Adding this edge would create a cycle in the lineage graph.', {
        parentSessionId,
        childSessionId
      });
    }
    if (!this.children.has(parentSessionId)) {
      this.children.set(parentSessionId, new Set());
    }
    this.children.get(parentSessionId)!.add(childSessionId);
  }

  private wouldCreateCycle(parentSessionId: string, childSessionId: string): boolean {
    const stack = [...(this.children.get(childSessionId) || [])];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === parentSessionId) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const c of this.children.get(n) || []) stack.push(c);
    }
    return false;
  }

  getChildren(sessionId: string): string[] {
    return Array.from(this.children.get(sessionId) || []);
  }

  /**
   * All registered session ids whose pipeline label matches (exact).
   */
  queryByPipelineName(pipelineName: string): string[] {
    const out: string[] = [];
    for (const [sid, name] of this.pipelineBySession) {
      if (name === pipelineName) out.push(sid);
    }
    return out;
  }
}
