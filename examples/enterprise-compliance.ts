/**
 * @sipheron/vdr-pipeline — Enterprise Compliance Example
 *
 * Demonstrates the full range of industry-standard features:
 * 1. PII Redaction (via Middleware)
 * 2. Session Persistence (via FileSystemAdapter)
 * 3. Provable Timestamps (via HMAC Commitment)
 * 4. Audit Trail Bundles (W3C-aligned)
 * 5. Advanced Analytics (via SessionMetrics)
 */
import { 
  Pipeline, 
  PipelineMiddleware, 
  createPIIRedactionMiddleware,
  FileSystemPersistenceAdapter,
  AuditTrailBundle,
  HMACCommitment
} from '../src';

async function main() {
  console.log('--- 1. Setup ---');
  
  // Create middleware stack with PII redaction
  const middleware = new PipelineMiddleware();
  middleware.use(createPIIRedactionMiddleware().fn, 'pii-redactor');
  
  // Use file system persistence
  const persistencePath = './vdr-storage';
  const adapter = new FileSystemPersistenceAdapter(persistencePath);
  
  // Initialize Pipeline with middleware and persistence
  const pipeline = Pipeline.withApiKey(process.env.SIPHERON_API_KEY || 'mock-key', {
    pipelineName: 'compliance-agent-001',
    middleware,
    persistenceAdapter: adapter
  });

  console.log('Pipeline active:', pipeline.getPipelineId());

  console.log('\n--- 2. Interaction ---');
  
  // Log event with PII — it will be automatically redacted before hashing
  const promptHash = await pipeline.logPrompt({
    role: 'user',
    content: 'My credit card number is 4444-5555-6666-7777 and my phone is 555-0199.'
  });

  // Log a retrieval
  await pipeline.logRetrieval({
    query: 'financial summary q4',
    resultCount: 3,
    sourceIds: ['fin_01', 'fin_02', 'fin_03']
  });

  console.log('Events logged:', pipeline.getEventCount());

  console.log('\n--- 3. Provable Timestamp (Commit/Reveal) ---');
  
  // Create a commitment to prove the prompt existed at this time
  const commitment = HMACCommitment.commit(promptHash);
  console.log('Commitment Hash:', commitment.commitment);
  console.log('Commitment Secret:', commitment.secret);
  
  // ... sometime later ...
  const isCorrect = HMACCommitment.reveal(promptHash, commitment.secret, commitment.commitment);
  console.log('Verification of commitment:', isCorrect ? '✅ Valid' : '❌ Tampered');

  console.log('\n--- 4. Analytics ---');
  
  // Get real-time metrics
  const metrics = pipeline.getMetrics();
  console.log(metrics.summary());

  console.log('\n--- 5. Finalization & Auditing ---');
  
  // Finalize the session
  const session = pipeline.finalizeOnly();
  console.log('Merkle Root:', session.merkleRoot);

  // Generate a self-contained W3C-aligned Audit Bundle
  const bundle = AuditTrailBundle.fromSession(session);
  
  // Verify the entire bundle
  const audit = bundle.verify();
  console.log('Audit Integrity:', audit.valid ? '✅ Perfect' : '❌ Compromised');
  
  if (audit.valid) {
    // Export bundle for archival or regulators
    console.log('\nAudit Bundle (First 200 chars):');
    console.log(bundle.toString().slice(0, 200) + '...');
  }
}

main().catch(console.error);
