# @sipheron/vdr-pipeline — Agent Instructions

> Canonical AI-agent playbook for the **VDR-Pipeline** SDK.
> Any AI coding assistant working in this package MUST read this file first.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Package** | `@sipheron/vdr-pipeline` |
| **Version** | `1.0.0` (stable) |
| **Purpose** | SDK for AI pipeline cryptographic provenance — anchor GenAI events on-chain |
| **Runtime** | Node ≥ 16 |
| **Language** | TypeScript 5, compiled to CommonJS ES2022 |
| **Core Dependency** | `@sipheron/vdr-core ^1.0.0` (all crypto primitives) |

## 2. Build & Test Commands

```bash
# Type-check only (no emit)
npx tsc --noEmit

# Full build → dist/
npm run build

# Run entire test suite
npx jest

# Run a specific test file
npx jest tests/unit/anchoring.test.ts

# Run benchmarks
npx jest tests/benchmarks/
```

> **Always run `npx tsc --noEmit` before considering any task complete.**

## 3. Architecture & Module Map

```
src/
├── index.ts                    # Public barrel — all consumer exports
├── types.ts                    # Domain models: PipelineEvent, Prompt, Generation, etc.
├── errors.ts                   # VDRPipelineError hierarchy
│
├── core/
│   ├── Pipeline.ts             # Main state machine for event capture
│   ├── PipelinePool.ts         # Connection pooling for concurrent pipelines
│   ├── PipelineSession.ts      # Session lifecycle management
│   ├── EventStore.ts           # Event logging loop & persistence
│   ├── EventFilter.ts          # Fluent, chainable event filtering engine
│   ├── SessionMetrics.ts       # Token usage, latency, cost analytics
│   ├── PipelineMiddleware.ts   # Middleware hook system
│   ├── AuditTrailBundle.ts     # Compliance audit bundle generation
│   ├── PersistenceAdapters.ts  # Pluggable storage backends
│   └── PipelineHealth.ts       # Health check & diagnostics
│
├── crypto/
│   ├── eventHasher.ts          # Deterministic JSON replacer & pre-image builder
│   ├── MerkleTree.ts           # In-memory sorted-pair hashing, odd-leaf promotion
│   ├── IncrementalMerkleTree.ts # Append-only Merkle for streaming sessions
│   ├── proofVerifier.ts        # Merkle proof verification
│   ├── HashChain.ts            # Tamper-evident sequential hash chains
│   ├── canonicalizer.ts        # RFC 8785 JSON Canonicalization Scheme
│   ├── commitment.ts           # HMAC-SHA256 commitment schemes
│   ├── ContentAddressableStore.ts # Hash-based event deduplication & lookup
│   ├── SaltedEventHasher.ts    # Salted hashing for privacy-preserving proofs
│   └── MerkleAggregate.ts      # Cross-session Merkle aggregation
│
├── anchoring/
│   ├── BaseAnchor.ts           # Abstract anchor interface
│   ├── SipHeronAnchor.ts       # API-driven managed mode (requires API key)
│   ├── SolanaAnchor.ts         # Keypair-driven direct mode via Solana RPC
│   └── AnchorResult.ts         # Result types & explorer URL builder
│
└── integrations/
    ├── langchain/              # LangChain callback handler
    ├── openai/                 # OpenAI client wrapper
    └── llamaindex/             # LlamaIndex integration
```

### Subpath Exports

| Import Path | Module |
|---|---|
| `@sipheron/vdr-pipeline` | Full SDK |
| `@sipheron/vdr-pipeline/crypto` | Crypto primitives only |
| `@sipheron/vdr-pipeline/errors` | Error hierarchy only |
| `@sipheron/vdr-pipeline/types` | TypeScript types only |
| `@sipheron/vdr-pipeline/langchain` | LangChain integration |
| `@sipheron/vdr-pipeline/openai` | OpenAI integration |
| `@sipheron/vdr-pipeline/llamaindex` | LlamaIndex integration |

## 4. Core Engineering Principles

1.  **AI-First & Zero-Trust:** The pipeline captures AI execution steps (prompts, retrievals, tool calls, generations) but **must never transmit raw text or PII** over the network. Only SHA-256 hashes and Merkle roots are sent to Solana or the SipHeron API.
2.  **Strict Cryptographic Dependency:** All actual cryptographic operations (`hashDocument`, `anchorToSolana`, the `SipHeron` client) **MUST** be invoked from `@sipheron/vdr-core`. Never re-implement Web3/Solana logic locally.
3.  **Monotonic Integrity:** Merkle leaves include a timestamp and a strictly monotonically increasing `sequenceIndex` tied to the `sessionId`. Reordering or replay attacks are mathematically blocked.
4.  **Deterministic Hashing:** Event payloads are canonicalized via RFC 8785 (JCS) before hashing. The deterministic JSON replacer ensures identical payloads always produce identical hashes regardless of key ordering.

## 5. Coding Conventions

### Error Handling
- **Never** throw raw `Error("string")` in operational code.
- Always use or extend `VDRPipelineError` from `src/errors.ts`.
- Anchor-level network requests must catch failures and push retry-attempt breakdowns into the `context` parameter of `AnchorTransactionError`.

### TypeScript
- `tsconfig.json` excludes `tests/` — test files **must** explicitly import Jest globals:
  ```typescript
  import { describe, it, expect } from '@jest/globals';
  ```
- Use standard Node built-ins: `crypto.randomUUID()` not `uuid`, `import * as crypto from 'crypto'` not default import.
- `solanaSecretKey` maps to `Uint8Array(64)` for Ed25519 (`Keypair.fromSecretKey`).

### Async Mocking
- When mocking `vdr-core`, manually inject `jest.fn<() => Promise<any>>()` to prevent TypeScript inferring `never` inside `mockResolvedValue`.

## 6. Test Structure

```
tests/
├── unit/           # Fast, isolated unit tests (mocked dependencies)
├── integration/    # End-to-end flows (may use devnet or local validator)
└── benchmarks/     # Performance & throughput benchmarks
```

- Unit tests mock all `@sipheron/vdr-core` imports and network calls.
- Never make real Solana RPC calls in unit tests.
- Integration tests may connect to devnet but must be idempotent.

## 7. Files You Should Never Modify Without Explicit Instruction

| File | Reason |
|---|---|
| `src/index.ts` | Public API surface — adding/removing exports is a breaking change |
| `package.json` → `exports` | Subpath export map consumed by framework integrations |
| `src/types.ts` | Domain model contracts shared across all modules |
| `src/crypto/canonicalizer.ts` | RFC 8785 compliance — changes break hash determinism |
