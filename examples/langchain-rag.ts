/**
 * @sipheron/vdr-pipeline — LangChain RAG Example
 *
 * Demonstrates zero-effort provenance for a LangChain RAG chain:
 * 1. Create a Pipeline + PipelineCallbackHandler
 * 2. Attach the handler to a LangChain chain
 * 3. All chain steps are auto-logged — no manual logEvent() calls
 * 4. Finalize and anchor after the chain completes
 *
 * Requirements:
 *   npm install @langchain/openai @langchain/core langchain
 */
import { Pipeline } from '../src';
import { PipelineCallbackHandler } from '../src/integrations/langchain';

// import { ChatOpenAI } from '@langchain/openai';
// import { ConversationalRetrievalQAChain } from 'langchain/chains';

async function main() {
  // 1. Create a Pipeline in managed mode
  const pipeline = Pipeline.withApiKey(process.env.SIPHERON_API_KEY!, {
    pipelineName: 'contract-qa-agent',
    network: 'mainnet-beta'
  });

  // 2. Create the callback handler
  const handler = new PipelineCallbackHandler(pipeline);

  console.log('Pipeline ready:', pipeline.getPipelineId());
  console.log('Callback handler: vdr-pipeline');

  /*
   * 3. Attach to your LangChain chain
   *
   * const llm = new ChatOpenAI({ modelName: 'gpt-4o' });
   * const chain = ConversationalRetrievalQAChain.fromLLM(
   *   llm,
   *   vectorStore.asRetriever(),
   *   { callbacks: [handler] }
   * );
   *
   * // Run the chain — all steps are auto-logged
   * const result = await chain.call({
   *   question: 'What are the penalty clauses in this contract?'
   * });
   *
   * console.log('Chain output:', result);
   */

  // Simulate what the handler does for demonstration:
  await pipeline.logPrompt({
    role: 'user',
    content: 'What are the penalty clauses in this contract?'
  });

  await pipeline.logRetrieval({
    query: 'penalty clauses contract',
    resultCount: 4,
    sourceIds: ['clause_7a', 'clause_12b', 'clause_15', 'appendix_c'],
    retrieverName: 'pinecone'
  });

  await pipeline.logGeneration({
    content: 'The contract contains three penalty clauses...',
    model: 'gpt-4o',
    finishReason: 'stop',
    usage: { promptTokens: 2100, completionTokens: 450, totalTokens: 2550 }
  });

  // 4. Finalize and anchor
  const result = await pipeline.finalizeAndAnchor();

  console.log('\n=== Anchored RAG Session ===');
  console.log('Events:', result.eventCount);
  console.log('Merkle Root:', result.merkleRoot);
  console.log('TX:', result.transactionSignature);
  console.log('Explorer:', result.explorerUrl);

  // 5. Export session for compliance records
  const session = pipeline.exportSession();
  console.log('\nSession JSON size:', JSON.stringify(session).length, 'bytes');
}

main().catch(console.error);
