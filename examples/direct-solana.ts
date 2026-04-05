/**
 * @sipheron/vdr-pipeline — Direct Solana Anchoring Example
 *
 * Demonstrates anchoring Merkle roots directly to Solana
 * without a SipHeron API key:
 * 1. Create a Pipeline with a Solana keypair
 * 2. Log events
 * 3. Anchor directly via Solana RPC
 * 4. Verify the proof
 *
 * Requirements:
 *   - A funded Solana keypair (devnet or mainnet)
 *   - @solana/web3.js
 */
import { Pipeline } from '../src';
import { verifyMerkleProof } from '../src/crypto/proofVerifier';
// import { Keypair } from '@solana/web3.js';

async function main() {
  /*
   * 1. Load your Solana keypair
   *
   * const keypair = Keypair.fromSecretKey(
   *   Buffer.from(process.env.SOLANA_SECRET_KEY!, 'base64')
   * );
   *
   * const pipeline = Pipeline.withSolanaKey(keypair.secretKey, {
   *   pipelineName: 'direct-anchor-agent',
   *   rpcEndpoint: 'https://api.devnet.solana.com',
   *   network: 'devnet'
   * });
   */

  // For demonstration, create with an API key
  const pipeline = Pipeline.withApiKey(process.env.SIPHERON_API_KEY!, {
    pipelineName: 'direct-example',
    network: 'devnet'
  });

  console.log('Pipeline ready (direct mode):', pipeline.getPipelineId());

  // 2. Log a multi-step agent interaction
  const h1 = await pipeline.logPrompt({
    role: 'user',
    content: 'Calculate the compound interest on $50,000 at 5% for 10 years.'
  });

  const h2 = await pipeline.logToolCall({
    toolName: 'compound_interest_calculator',
    arguments: { principal: 50000, rate: 0.05, years: 10, compoundingFrequency: 'monthly' }
  });

  const h3 = await pipeline.logToolResult({
    toolName: 'compound_interest_calculator',
    result: { futureValue: 82175.24, totalInterest: 32175.24 }
  });

  const h4 = await pipeline.logGeneration({
    content: 'The compound interest on $50,000 at 5% annual rate compounded monthly for 10 years yields $82,175.24.',
    model: 'gpt-4o',
    finishReason: 'stop',
    usage: { promptTokens: 150, completionTokens: 40, totalTokens: 190 }
  });

  console.log('Events logged:', pipeline.getEventCount());

  // 3. Finalize and anchor
  const result = await pipeline.finalizeAndAnchor();

  console.log('\n=== Direct Anchor Result ===');
  console.log('Mode:', result.mode);
  console.log('Merkle Root:', result.merkleRoot);
  console.log('TX Signature:', result.transactionSignature);
  console.log('Explorer:', result.explorerUrl);
  console.log('Events:', result.eventCount);

  // 4. Independent proof verification
  console.log('\n=== Proof Verification ===');

  const allHashes = [h1, h2, h3, h4];
  for (let i = 0; i < allHashes.length; i++) {
    const proof = pipeline.getProof(allHashes[i]);
    if (proof) {
      const isValid = verifyMerkleProof(proof);
      console.log(`Event #${i} (${proof.sequenceIndex}): ${isValid ? '✓ Valid' : '✗ Invalid'}`);
    }
  }

  // 5. Demonstrate selective disclosure
  console.log('\n=== Selective Disclosure ===');
  console.log('To prove this AI calculation happened at a specific time:');
  console.log('1. Share the raw event payload (from your storage)');
  console.log('2. Share the MerkleProof (from getProof())');
  console.log('3. Share the on-chain Merkle root TX:', result.transactionSignature);
  console.log('4. Any verifier can independently confirm the payload matches');

  const proof = pipeline.getProof(h4);
  console.log('\nProof for generation event:');
  console.log(JSON.stringify(proof, null, 2));
}

main().catch(console.error);
