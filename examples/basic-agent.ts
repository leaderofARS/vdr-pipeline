/**
 * @sipheron/vdr-pipeline — Basic Agent Example
 *
 * Demonstrates the simplest possible usage:
 * 1. Create a Pipeline with an API key
 * 2. Log AI agent events (prompt, retrieval, generation)
 * 3. Finalize and anchor to Solana
 * 4. Generate and verify a Merkle proof for any event
 */
import { Pipeline } from '../src';

async function main() {
  // 1. Create a Pipeline instance in managed mode
  const pipeline = Pipeline.withApiKey(process.env.SIPHERON_API_KEY!, {
    pipelineName: 'basic-agent-example'
  });

  console.log('Pipeline created:', pipeline.getPipelineId());

  // 2. Log a user prompt
  const promptHash = await pipeline.logPrompt({
    role: 'user',
    content: 'What are the key risks in this contract?'
  });
  console.log('Prompt hash:', promptHash);

  // 3. Log a retrieval step (RAG)
  await pipeline.logRetrieval({
    query: 'contract risks penalties termination',
    resultCount: 5,
    sourceIds: ['chunk_001', 'chunk_002', 'chunk_003', 'chunk_004', 'chunk_005'],
    retrieverName: 'pinecone'
  });

  // 4. Log the LLM generation
  await pipeline.logGeneration(
    {
      content: 'The key risks include: 1) Auto-renewal clause at section 4.2...',
      model: 'gpt-4o',
      finishReason: 'stop',
      usage: { promptTokens: 1200, completionTokens: 340, totalTokens: 1540 }
    },
    { latencyMs: 1820 }
  );

  console.log('Events logged:', pipeline.getEventCount());

  // 5. Finalize and anchor to Solana
  const result = await pipeline.finalizeAndAnchor();

  console.log('=== Anchor Result ===');
  console.log('Mode:', result.mode);
  console.log('TX:', result.transactionSignature);
  console.log('Merkle Root:', result.merkleRoot);
  console.log('Events:', result.eventCount);
  console.log('Explorer:', result.explorerUrl);

  // 6. Generate a proof for the original prompt
  const proof = pipeline.getProof(promptHash);
  console.log('\n=== Merkle Proof for Prompt ===');
  console.log('Leaf:', proof?.leaf);
  console.log('Root:', proof?.root);
  console.log('Path depth:', proof?.path.length);
  console.log('Valid:', proof ? pipeline.verifyProof(proof) : 'N/A');

  // 7. Export the full session for archival
  const session = pipeline.exportSession();
  console.log('\n=== Session Snapshot ===');
  console.log('Session ID:', session.sessionId);
  console.log('Status:', session.status);
  console.log('Events:', session.events.length);
  console.log('Finalized at:', new Date(session.finalizedAt!).toISOString());
}

main().catch(console.error);
