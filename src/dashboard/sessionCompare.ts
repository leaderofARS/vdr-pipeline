import { PipelineEvent, PipelineSession } from '../types';

export interface SessionDiffEventRef {
  sequenceIndex: number;
  type: string;
  hash: string;
}

export interface PipelineSessionDiff {
  /** Same pipeline name / id on both sessions */
  samePipeline: boolean;
  merkleRootsMatch: boolean;
  eventCountDelta: number;
  /** Event hashes present in A but not in B (by hash) */
  hashesOnlyInA: string[];
  hashesOnlyInB: string[];
  /** Per-type counts: type -> delta (A count minus B count) */
  typeCountDelta: Record<string, number>;
}

function countByType(events: PipelineEvent[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of events) {
    m[e.type] = (m[e.type] || 0) + 1;
  }
  return m;
}

/**
 * Compare two exported `PipelineSession` snapshots (e.g. two runs of the same agent).
 * Uses hashes and types only — suitable for audit / dashboard diff views.
 */
export function comparePipelineSessions(a: PipelineSession, b: PipelineSession): PipelineSessionDiff {
  const setA = new Set(a.merkleLeaves);
  const setB = new Set(b.merkleLeaves);
  const hashesOnlyInA = a.merkleLeaves.filter((h) => !setB.has(h));
  const hashesOnlyInB = b.merkleLeaves.filter((h) => !setA.has(h));

  const ca = countByType(a.events);
  const cb = countByType(b.events);
  const types = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  const typeCountDelta: Record<string, number> = {};
  for (const t of types) {
    typeCountDelta[t] = (ca[t] || 0) - (cb[t] || 0);
  }

  const rootA = a.merkleRoot || '';
  const rootB = b.merkleRoot || '';

  return {
    samePipeline: a.pipelineId === b.pipelineId,
    merkleRootsMatch: Boolean(rootA && rootB && rootA === rootB),
    eventCountDelta: a.events.length - b.events.length,
    hashesOnlyInA,
    hashesOnlyInB,
    typeCountDelta
  };
}
