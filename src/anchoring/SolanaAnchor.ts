import { BaseAnchor } from './BaseAnchor';
import { buildExplorerUrl } from './AnchorResult';
import { PipelineSession, AnchorResult, PipelineConfig } from '../types';
import { anchorToSolana } from '@sipheron/vdr-core';
import { Keypair } from '@solana/web3.js';
import { AnchorTransactionError } from '../errors';

export class SolanaAnchor extends BaseAnchor {
  private config: PipelineConfig;
  
  constructor(config: PipelineConfig) {
    super();
    if (!config.solanaSecretKey) {
      throw new Error("SolanaAnchor requires a solanaSecretKey");
    }
    this.config = config;
  }

  async anchor(session: PipelineSession): Promise<AnchorResult> {
    if (!session.merkleRoot) {
      throw new Error("Cannot anchor a session with no events (no merkleRoot)");
    }

    const delays = process.env.NODE_ENV === 'test' ? [0, 10, 10, 10] : [0, 1000, 4000, 16000];
    const attempts: Array<{ attempt: number; error: string; timestamp: number }> = [];
    const network = this.config.network || 'mainnet-beta';

    for (let attempt = 1; attempt <= delays.length; attempt++) {
      try {
        if (delays[attempt - 1] > 0) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt - 1]));
        }

        const solanaRes = await anchorToSolana({
          hash: session.merkleRoot!,
          keypair: Keypair.fromSecretKey(this.config.solanaSecretKey!),
          network: network === 'devnet' ? 'devnet' : 'mainnet',
          metadata: `Pipeline Batch Root: ${session.pipelineId}`,
          rpcUrl: this.config.rpcEndpoint
        });

        return {
          mode: 'direct',
          transactionSignature: solanaRes.transactionSignature,
          merkleRoot: session.merkleRoot,
          sessionId: session.sessionId,
          eventCount: session.events.length,
          anchoredAt: Date.now(),
          explorerUrl: buildExplorerUrl(solanaRes.transactionSignature, network)
        };
      } catch (err: any) {
        attempts.push({
          attempt,
          error: err.message,
          timestamp: Date.now()
        });
      }
    }

    throw new AnchorTransactionError(
      `Direct anchor failed after ${delays.length} attempts`,
      { attempts, sessionId: session.sessionId, merkleRoot: session.merkleRoot }
    );
  }
}
