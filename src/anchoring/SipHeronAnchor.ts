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
      const baseMeta: Record<string, string> = {
        isBatchRoot: 'true',
        eventCount: String(session.events.length)
      };
      
      if (session.lineage) {
        baseMeta.isLineageRoot = 'true';
        baseMeta.lineageParentSessionId = session.lineage.parentSessionId;
        const joined = session.lineage.childSessionIds.join(',');
        baseMeta.lineageChildSessionIds = joined.length > 500 ? joined.slice(0, 497) + '...' : joined;
      }

      // ── Use Dedicated AI Pipeline Route ────────────────────────────────────
      // This prevents mixing AI provenace events with general document anchors.
      const sipheronAnchorRes = await (this.client as any).request('POST', '/api/pipeline/events', {
        eventType: 'custom',
        stepName: 'finalize_session',
        pipelineId: session.pipelineId,
        sessionId: session.sessionId,
        payload: {
          merkleRoot: session.merkleRoot,
          merkleLeaves: session.merkleLeaves,
          metrics: session.events.length > 0 ? (session as any).metrics : undefined,
          ...baseMeta
        }
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
