import { BaseAnchor } from './BaseAnchor';
import { buildExplorerUrl, buildVerificationUrl } from './AnchorResult';
import { PipelineSession, AnchorResult, PipelineConfig } from '../types';
import { SipHeron } from '@sipheron/vdr-core';
import { SipHeronAPIError } from '../errors';

export class SipHeronAnchor extends BaseAnchor {
  private client: SipHeron;
  private network: 'mainnet-beta' | 'devnet';
  
  constructor(config: PipelineConfig) {
    super();
    if (!config.apiKey) {
      throw new Error("SipHeronAnchor requires an apiKey");
    }
    
    this.network = config.network || 'mainnet-beta';

    this.client = new SipHeron({
      apiKey: config.apiKey,
      network: this.network === 'devnet' ? 'devnet' : 'mainnet',
      ...(config.apiBaseUrl ? { baseUrl: config.apiBaseUrl } : {})
    });
  }

  async anchor(session: PipelineSession): Promise<AnchorResult> {
    if (!session.merkleRoot) {
      throw new Error("Cannot anchor a session with no events (no merkleRoot)");
    }

    try {
      const crypto = require('crypto');
      const event_id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substr(2));

      const baseMeta: Record<string, any> = {
        isBatchRoot: true,
        eventCount: session.events.length
      };
      
      if (session.lineage) {
        baseMeta.isLineageRoot = true;
        baseMeta.lineageParentSessionId = session.lineage.parentSessionId;
        const joined = session.lineage.childSessionIds.join(',');
        baseMeta.lineageChildSessionIds = joined.length > 500 ? joined.slice(0, 497) + '...' : joined;
      }

      // ── Construct Compliant Evidence Envelope ─────────────────────────────
      // The backend enforces this schema for all verifiable events.
      const envelope = {
        schema_version: '1.1.0',
        event_id,
        session_id: session.sessionId,
        tenant_id: 'managed', // Overwritten by backend
        occurred_at: new Date().toISOString(),
        actor: {
          id: 'vdr-pipeline-sdk',
          type: 'system'
        },
        model: {
          id: session.pipelineId,
          name: session.pipelineId,
          provider: 'vdr-pipeline'
        },
        input: {
          merkleRoot: session.merkleRoot,
          merkleLeaves: session.merkleLeaves,
          ...baseMeta
        },
        output: {
          status: 'finalized',
          metrics: (session as any).metrics || undefined
        },
        policy: {
          pii_detected: false,
          compliance: []
        },
        links: {
          event_type: 'custom',
          parent_id: session.lineage?.parentSessionId || undefined
        }
      };

      const sipheronAnchorRes = await (this.client as any).request('POST', '/api/pipeline/events', {
        envelope,
        pipelineId: session.pipelineId,
        sessionId: session.sessionId,
        eventType: 'custom',
        stepName: 'finalize_session'
      });

      // The backend returns the anchored event.
      const event = sipheronAnchorRes;

      return {
        mode: 'managed',
        transactionSignature: event.txSignature,
        merkleRoot: session.merkleRoot,
        sessionId: session.sessionId,
        eventCount: session.events.length,
        anchoredAt: Date.now(),
        sipheronAnchorId: event.id,
        explorerUrl: buildExplorerUrl(event.txSignature, this.network),
        verificationUrl: buildVerificationUrl(event.id)
      };
    } catch (err: any) {
      throw new SipHeronAPIError(
        `Managed anchor failed: ${err.message}`,
        {
          statusCode: err.statusCode || 500,
          body: err.body || err.message,
          sessionId: session.sessionId
        }
      );
    }
  }
}
