import { BaseAnchor } from './BaseAnchor';
import { buildExplorerUrl } from './AnchorResult';
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
    
    const delays = process.env.NODE_ENV === 'test' ? [0, 10, 10, 10] : [0, 1000, 4000, 16000];
    const attempts: Array<{ attempt: number; error: string; timestamp: number }> = [];

    for (let attempt = 1; attempt <= delays.length; attempt++) {
      try {
        if (delays[attempt - 1] > 0) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt - 1]));
        }

        const baseMeta: Record<string, string> = {
          pipeline: session.pipelineId,
          sessionId: session.sessionId,
          isBatchRoot: 'true',
          eventCount: String(session.events.length)
        };
        if (session.lineage) {
          baseMeta.isLineageRoot = 'true';
          baseMeta.lineageParentSessionId = session.lineage.parentSessionId;
          baseMeta.lineageChildSessionIds = session.lineage.childSessionIds.join(',');
        }

        const sipheronAnchorRes = await this.client.anchor({
          hash: session.merkleRoot,
          metadata: baseMeta
        });

        return {
          mode: 'managed',
          transactionSignature: sipheronAnchorRes.transactionSignature,
          merkleRoot: session.merkleRoot,
          sessionId: session.sessionId,
          eventCount: session.events.length,
          anchoredAt: Date.now(),
          sipheronAnchorId: sipheronAnchorRes.id,
          explorerUrl: buildExplorerUrl(sipheronAnchorRes.transactionSignature, this.network)
        };
      } catch (err: any) {
        attempts.push({
          attempt,
          error: err.message,
          timestamp: Date.now()
        });
      }
    }

    const lastError = attempts[attempts.length - 1];
    throw new SipHeronAPIError(
      `Managed anchor failed after ${delays.length} attempts: ${lastError.error}`,
      {
        statusCode: (lastError as any).statusCode || 500,
        body: lastError.error,
        sessionId: session.sessionId,
        attempts
      }
    );
  }
}
