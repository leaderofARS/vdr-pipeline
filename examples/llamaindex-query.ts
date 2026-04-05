/**
 * @sipheron/vdr-pipeline — LlamaIndex Query Example
 *
 * Demonstrates provenance for a LlamaIndex query engine:
 * 1. Create a Pipeline + PipelineEventListener
 * 2. Register the listener with LlamaIndex's callback system
 * 3. Run a query — events are auto-logged
 * 4. Finalize and anchor
 *
 * Requirements:
 *   npm install llamaindex
 */
import { Pipeline } from '../src';
import { PipelineEventListener } from '../src/integrations/llamaindex';

// import { Settings } from 'llamaindex';

async function main() {
  // 1. Create a Pipeline in managed mode
  const pipeline = Pipeline.withApiKey(process.env.SIPHERON_API_KEY!, {
    pipelineName: 'document-qa'
  });

  // 2. Create the event listener
  const listener = new PipelineEventListener(pipeline);

  /*
   * 3. Register with LlamaIndex
   *
   * // Register for all event types
   * Settings.callbackManager.on('retrieve', listener.onRetrieve);
   * Settings.callbackManager.on('query_start', listener.onQueryStart);
   * Settings.callbackManager.on('synthesize', listener.onSynthesize);
   * Settings.callbackManager.on('query_end', listener.onQueryEnd);
   *
   * // Or use the universal handler
   * Settings.callbackManager.on('retrieve', listener);
   *
   * const queryEngine = index.asQueryEngine();
   * const response = await queryEngine.query({
   *   query: 'What is the termination clause?'
   * });
   */

  // Simulate LlamaIndex events for demonstration:
  await listener.onQueryStart({ query: 'What is the termination clause?' });

  await listener.onRetrieve({
    query: 'termination clause',
    nodes: [
      { node: { nodeId: 'doc_section_14' } },
      { node: { nodeId: 'doc_section_22' } },
      { node: { nodeId: 'appendix_b' } }
    ]
  });

  await listener.onSynthesize({
    response: 'The termination clause in Section 14.2 allows either party...'
  });

  await listener.onQueryEnd({});

  // 4. Finalize and anchor
  const result = await pipeline.finalizeAndAnchor();

  console.log('=== LlamaIndex Session Anchored ===');
  console.log('Events:', result.eventCount);
  console.log('Merkle Root:', result.merkleRoot);
  console.log('TX:', result.transactionSignature);
  console.log('Explorer:', result.explorerUrl);

  // 5. Demonstrate proof for the retrieval step
  const session = pipeline.exportSession();
  const retrievalEvent = session.events.find(e => e.type === 'RETRIEVAL');
  if (retrievalEvent) {
    const proof = pipeline.getProof(retrievalEvent.hash);
    console.log('\nRetrieval proof valid:', proof ? pipeline.verifyProof(proof) : 'N/A');
  }
}

main().catch(console.error);
