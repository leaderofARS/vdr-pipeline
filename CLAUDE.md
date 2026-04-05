# vdr-pipeline SDK: AI Agent Guidelines

## Build & Test Commands

*   **Type Checking:** `npx tsc --noEmit` (Crucial before resolving any task)
*   **Run All Tests:** `npx jest`
*   **Run Specific Test:** `npx jest tests/unit/anchoring.test.ts`
*   **Publishing (Future):** Ensure all tests pass. Package is compiled via `tsc` to `dist/`.

## Project Architecture & Structure

*   **`src/types.ts`:** Domain models, payload schemas (Prompt, Generation, etc.), and `PipelineEvent` interfaces.
*   **`src/errors.ts`:** Strongly typed error hierarchy extending `VDRPipelineError`.
*   **`src/core/`:** Contains `Pipeline.ts` (state machine) and `EventStore.ts` (event logging loop).
*   **`src/crypto/`:** 
    *   `eventHasher.ts`: Deterministic JSON replacer and pre-image builder.
    *   `MerkleTree.ts`: In-memory sorted-pair hashing and odd-leaf promotion for session finalization.
*   **`src/anchoring/`:** Dual-mode hooks interacting with `@sipheron/vdr-core`.
    *   `SipHeronAnchor`: API-driven managed Mode.
    *   `SolanaAnchor`: Keypair-driven Direct Mode via RPC.
*   **`src/integrations/`:** (WIP) Native hooks for LangChain and LlamaIndex.

## Core Engineering Principles

1.  **AI-First & Zero-Trust:** The pipeline is designed specifically to capture AI execution steps (retrievals, tool calls, prompts) but **must never transmit raw text or PII over the network**. Only mathematically sorted `SHA-256` hashes and `MerkleRoots` are sent to Solana or SipHeron.
2.  **Strict Cryptographic Dependency:** `vdr-pipeline` heavily imports `@sipheron/vdr-core`. All actual cryptographic operations (e.g., `hashDocument`, `anchorToSolana`, the `SipHeron` client) MUST be invoked from `vdr-core`. Never re-invent Web3/Solana logic locally.
3.  **Monotonic Integrity:** Merkle leaves are constructed with a timestamp and a strict monotonically increasing `sequenceIndex` array tied to the `sessionId`. Reordering or replay attacks are mathematically blocked.

## Style & Writing Guidelines

*   **TypeScript configuration limits tests:** The `tsconfig.json` intentionally excludes the `tests/` directory to prevent shipping dev-only types. When writing JS/TS test files, you **must explicitly import Jest globals**: `import { describe, it, expect } from '@jest/globals';` to prevent IDE red-lines.
*   **Native Node API Preferences:** Use standard Node built-ins. Example: Use `crypto.randomUUID()` instead of installing the `uuid` package. When importing crypto, use `import * as crypto from 'crypto';` to prevent ES module resolution failures.
*   **Anchoring Config Fallbacks:** `solanaSecretKey` maps strictly to `Uint8Array(64)` for Ed25519 interactions in Web3 (`Keypair.fromSecretKey`). 
*   **Async Mocks:** If mocking `vdr-core`, be careful with Typescript inferring `never`. Manually inject `jest.fn<() => Promise<any>>()` inside `mockResolvedValue`.

## Error Handling

*   Never throw generic `Error("string")` in the operational paths.
*   Always utilize or expand `src/errors.ts`. 
*   Anchor-level network requests must catch and push multiple retry-attempt breakdowns into the `context` parameter of `AnchorTransactionError` for deep observability.
