// ── Types & Errors ────────────────────────────────────────────────────────────
export * from './types';
export * from './errors';

// ── Core ──────────────────────────────────────────────────────────────────────
export * from './core/Pipeline';
export * from './core/PipelinePool';
export * from './core/PipelineSession';
export * from './core/EventStore';
export * from './core/EventFilter';
export * from './core/SessionMetrics';
export * from './core/PipelineMiddleware';
export * from './core/AuditTrailBundle';
export * from './core/PersistenceAdapters';
export * from './core/PipelineHealth';

// ── Dashboard (Phase 6 — managed analytics & proof utilities) ───────────────
export * from './dashboard';

// ── Lineage (Phase 7 — cross-session provenance) ────────────────────────────
export * from './lineage';

// ── Crypto ────────────────────────────────────────────────────────────────────
export * from './crypto/eventHasher';
export * from './crypto/MerkleTree';
export * from './crypto/IncrementalMerkleTree';
export * from './crypto/proofVerifier';
export * from './crypto/HashChain';
export * from './crypto/canonicalizer';
export * from './crypto/commitment';
export * from './crypto/ContentAddressableStore';
export * from './crypto/SaltedEventHasher';
export * from './crypto/MerkleAggregate';
export * from './crypto/zk';

// ── Anchoring ─────────────────────────────────────────────────────────────────
export * from './anchoring/BaseAnchor';
export * from './anchoring/SipHeronAnchor';
export * from './anchoring/SolanaAnchor';
export { buildExplorerUrl } from './anchoring/AnchorResult';
