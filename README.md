# @sipheron/vdr-pipeline

[![npm version](https://img.shields.io/npm/v/@sipheron/vdr-pipeline)](https://www.npmjs.com/package/@sipheron/vdr-pipeline)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)]()
[![Solana](https://img.shields.io/badge/anchor-Solana-purple)]()

**The Cryptographic Trust & Governance Engine for Autonomous AI.**

`vdr-pipeline` provides enterprise developers with a lightweight, composable SDK to cryptographically prove every step of an AI reasoning chain. From the initial prompt to tool execution and final generation, every event is hashed, batched, and anchored to an immutable ledger. 

Stop relying on ephemeral logs. Treat your AI workflows as verifiable, tamper-evident document trails ready for SOC 2, HIPAA, and EU AI Act compliance.

---

## Key Capabilities

*   **Zero-Trust Payload Privacy**: Only cryptographic hashes (SHA-256) leave your infrastructure. Raw prompts, PII, and responses always remain in your environment.
*   **One-Transaction Merkle Anchoring**: Anchor hundreds of agent steps in a single Solana transaction to minimize latency and blockchain fees.
*   **Zero-Knowledge Selective Disclosure**: Prove specific properties of an AI event (e.g., "The model used was `gpt-4o`" or "Output token count < 500") to third parties using SnarkJS without revealing the actual payload content.
*   **Immutable Audit Trails (W3C Aligned)**: One-click export of highly structured, standalone cryptographic bundles for compliance auditors.
*   **Seamless Framework Integrations**: Drop-in adapters for **LangChain**, **LlamaIndex**, and the **OpenAI SDK**. Zero manual instrumentation required.

---

## Installation

```bash
npm install @sipheron/vdr-pipeline @solana/web3.js
```

*Note: `@sipheron/vdr-core` is required as a peer dependency.*

---

## Quick Start

### 1. Initialize the Pipeline
You can run the pipeline in **Managed Mode** (via SipHeron's API) or **Direct Mode** (using your own Solana keypair).

```typescript
import { Pipeline } from '@sipheron/vdr-pipeline';

// Example: Managed Mode using SipHeron infrastructure
const pipeline = Pipeline.withApiKey(process.env.SIPHERON_API_KEY!, {
  pipelineName: 'onboarding-agent'
});
```

### 2. Log AI Events
Use the strongly-typed event loggers to track the deterministic state of your agent's reasoning trace.

```typescript
await pipeline.logPrompt({ role: 'user', content: 'Process application 8492.' });
await pipeline.logRetrieval({ query: 'App 8492 data', resultCount: 2 });
await pipeline.logGeneration({ content: 'Application approved.', model: 'gpt-4o' });
```

### 3. Anchor & Export
Finalize the session to freeze the cryptographic state and anchor the Merkle root to the blockchain.

```typescript
const result = await pipeline.finalizeAndAnchor();

console.log(`✅ Session anchored successfully!`);
console.log(`🔗 Verification URL: ${result.explorerUrl}`);
console.log(`🌳 Merkle Root: ${result.merkleRoot}`);
```

---

## Framework Integrations

Stop writing boilerplate. Use our official adapters to instantly make your existing AI frameworks compliance-ready.

### LangChain
```typescript
import { PipelineCallbackHandler } from '@sipheron/vdr-pipeline/langchain';

const handler = new PipelineCallbackHandler(pipeline);
const agent = new AgentExecutor({ agent: myAgent, tools: myTools });

await agent.invoke({ input: "Analyze data" }, { callbacks: [handler] });
```

### LlamaIndex
```typescript
import { PipelineEventListener } from '@sipheron/vdr-pipeline/llamaindex';
import { Settings } from 'llamaindex';

const listener = new PipelineEventListener(pipeline);
Settings.callbackManager.on('retrieve', listener.onRetrieve);
// Fully orchestrates trace collection under the hood.
```

### OpenAI Native
```typescript
import { wrapOpenAI } from '@sipheron/vdr-pipeline/openai';
import OpenAI from 'openai';

const openai = wrapOpenAI(new OpenAI(), pipeline);

// Generates, logs, and tracks latency automatically
await openai.chat.completions.create({ model: 'gpt-4o', messages: [...] });
```

---

## Enterprise Governance

`vdr-pipeline` shifts AI engineering from mere logging to **proactive governance**.

### Lineage & Agent Swarms
Trace causation across complex multi-agent swarms. Child sessions cryptographically bind themselves to their parent's specific event trigger and state root.
```typescript
const childPipeline = await orchestrator.createChild('Reviewer-Agent');
// Child provenance is permanently paired to the Parent's timeline.
```

### Privacy-Preserving Proofs (Phase 8 ZK)
Prove an AI agent didn't exceed constraints without leaking intellectual property using Zero-Knowledge proofs.
```typescript
import { SnarkJsProvider } from '@sipheron/vdr-pipeline/crypto/zk';

const pipeline = new Pipeline({ 
  pipelineName: 'audit-agent', 
  zkProvider: new SnarkJsProvider({ wasmPath: '...', zkeyPath: '...' })
});

// Prove the response was under 500 tokens using Groth16 Snarks
const zkProof = await pipeline.generateZKProof(eventHash, "tokenCount < 500");
const isValid = await pipeline.verifyZKProof(zkProof);
```

### Exportable Compliance Bundles
Generate a complete, verifiable JSON artifact that a 3rd-party auditor can use to cryptographically replay your AI's reasoning chain.
```typescript
import { AuditTrailBundle } from '@sipheron/vdr-pipeline';

const bundle = AuditTrailBundle.fromSession(pipeline.exportSession());
fs.writeFileSync('compliance_audit_log.json', bundle.toString());
```

---

## Documentation

For deep-dives into the architecture, security posture, and advanced implementations, refer to the [VDR-Pipeline Master Plan](./PLAN.md).

## Community & Open Source

*   [Contributing Guidelines](./CONTRIBUTING.md)
*   [Code of Conduct](./CODE_OF_CONDUCT.md)
*   [Security Policy](./SECURITY.md)

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for more information.
