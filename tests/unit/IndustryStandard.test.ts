import { Pipeline } from '../../src/core/Pipeline';
import { PipelineMiddleware, createPIIRedactionMiddleware } from '../../src/core/PipelineMiddleware';
import { FileSystemPersistenceAdapter } from '../../src/core/PersistenceAdapters';
import { AuditTrailBundle } from '../../src/core/AuditTrailBundle';
import { HashChain } from '../../src/crypto/HashChain';
import { HMACCommitment } from '../../src/crypto/commitment';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Industry Standard Features Integration', () => {
    const TEST_DIR = path.join(__dirname, 'test-sessions');
    
    beforeAll(async () => {
        await fs.mkdir(TEST_DIR, { recursive: true });
    });
    
    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it('should run a full industry-standard workflow with middleware, persistence, and audit bundles', async () => {
        // 1. Setup Middleware (PII Redaction)
        const middleware = new PipelineMiddleware();
        const { fn: piiRedactor } = createPIIRedactionMiddleware();
        middleware.use(piiRedactor, 'pii-redactor');
        
        // 2. Setup Persistence
        const adapter = new FileSystemPersistenceAdapter(TEST_DIR);
        
        // 3. Initialize Pipeline
        const pipeline = new Pipeline({
            pipelineName: 'enterprise-agent',
            apiKey: 'mock-key',
            persistenceAdapter: adapter,
            middleware
        });
        
        const sessionId = pipeline.startSession();
        
        // 4. Log event with PII (should be redacted)
        const promptHash = await pipeline.logPrompt({
            role: 'user',
            content: 'My SSN is 123-45-6789 and my email is test@example.com'
        });
        
        // 5. Verify redaction happened via event storage
        const session = pipeline.exportSession();
        const loggedEvent = session.events[0];
        expect(loggedEvent.payload.content).toContain('[SSN-REDACTED]');
        expect(loggedEvent.payload.content).toContain('[EMAIL-REDACTED]');
        
        // 6. Demonstrate HashChain (Ordering Integrity)
        const chain = new HashChain();
        for(const event of session.events) {
            chain.append(event.hash);
        }
        expect(chain.verify()).toBe(true);
        expect(chain.length()).toBe(1);
        
        // 7. Demonstrate Commit/Reveal (Provable Timestamp)
        const commitment = HMACCommitment.commit(promptHash);
        expect(HMACCommitment.reveal(promptHash, commitment.secret, commitment.commitment)).toBe(true);
        
        // 8. Demonstrate Session Resume from Persistence (Before Finalization)
        const newPipeline = new Pipeline({
            pipelineName: 'enterprise-agent',
            apiKey: 'mock-key',
            persistenceAdapter: adapter
        });
        
        const resumed = await newPipeline.resumeSession(sessionId);
        expect(resumed).toBe(true);
        expect(newPipeline.getEventCount()).toBe(1);

        // 9. Finalize and generate Audit Bundle
        pipeline.finalizeOnly();
        const bundle = AuditTrailBundle.fromSession(pipeline.exportSession());
        const verification = bundle.verify();
        
        expect(verification.valid).toBe(true);
        expect(bundle.getEventCount()).toBe(1);
        
        // 10. Check Metrics
        const metrics = pipeline.getMetrics();
        expect(metrics.eventCount).toBe(1);
        expect(metrics.eventDistribution['PROMPT']).toBe(1);
    });
});
