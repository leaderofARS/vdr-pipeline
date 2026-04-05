import { SipHeronAnchor } from '../../src/anchoring/SipHeronAnchor';
import { SolanaAnchor } from '../../src/anchoring/SolanaAnchor';
import { AnchorTransactionError, SipHeronAPIError } from '../../src/errors';
import { PipelineSession } from '../../src/types';
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@sipheron/vdr-core', () => {
    return {
        SipHeron: jest.fn().mockImplementation(() => ({
            network: 'devnet',
            anchor: jest.fn<() => Promise<any>>().mockResolvedValue({
                transactionSignature: 'sig_managed',
                id: 'sipheron_123'
            })
        })),
        anchorToSolana: jest.fn<() => Promise<any>>().mockResolvedValue({
            transactionSignature: 'sig_direct'
        })
    };
});

describe('Dual-Mode Anchoring', () => {
    const dummySession: PipelineSession = {
        sessionId: 'test-session',
        pipelineId: 'test-pipeline',
        status: 'finalized',
        events: [] as any,
        merkleRoot: 'a'.repeat(64),
        merkleLeaves: [],
        createdAt: Date.now()
    };
    dummySession.events.length = 5;

    it('SipHeronAnchor should handle managed anchoring', async () => {
        const anchor = new SipHeronAnchor({ pipelineName: 'x', apiKey: 'test-key', network: 'devnet' });
        const result = await anchor.anchor(dummySession);
        
        expect(result.mode).toBe('managed');
        expect(result.transactionSignature).toBe('sig_managed');
        expect(result.sipheronAnchorId).toBe('sipheron_123');
        expect(result.explorerUrl).toContain('sig_managed');
        expect(result.explorerUrl).toContain('devnet');
    });

    it('SolanaAnchor should handle direct anchoring', async () => {
        const { Keypair } = require('@solana/web3.js');
        const anchor = new SolanaAnchor({ pipelineName: 'x', solanaSecretKey: Keypair.generate().secretKey, network: 'devnet' });
        const result = await anchor.anchor(dummySession);

        expect(result.mode).toBe('direct');
        expect(result.transactionSignature).toBe('sig_direct');
        expect(result.explorerUrl).toContain('sig_direct');
        expect(result.explorerUrl).toContain('devnet');
    });

    it('SipHeronAnchor should throw SipHeronAPIError on failure', async () => {
        const { SipHeron } = require('@sipheron/vdr-core');
        SipHeron.mockImplementationOnce(() => ({
            network: 'devnet',
            anchor: jest.fn<() => Promise<any>>().mockRejectedValue(new Error('API rate limit exceeded'))
        }));

        const anchor = new SipHeronAnchor({ pipelineName: 'x', apiKey: 'test-key', network: 'devnet' });
        await expect(anchor.anchor(dummySession)).rejects.toThrow(SipHeronAPIError);
    }, 30000);

    it('SolanaAnchor should throw AnchorTransactionError after all retries', async () => {
        const { anchorToSolana } = require('@sipheron/vdr-core');
        anchorToSolana.mockRejectedValue(new Error('RPC timeout'));

        const { Keypair } = require('@solana/web3.js');
        const anchor = new SolanaAnchor({ pipelineName: 'x', solanaSecretKey: Keypair.generate().secretKey, network: 'devnet' });
        
        await expect(anchor.anchor(dummySession)).rejects.toThrow(AnchorTransactionError);
    }, 30000);

    it('AnchorResult should contain valid explorer URL for mainnet', async () => {
        // Reset mock to default success
        const { anchorToSolana } = require('@sipheron/vdr-core');
        anchorToSolana.mockResolvedValue({ transactionSignature: 'sig_main' });

        const { Keypair } = require('@solana/web3.js');
        const anchor = new SolanaAnchor({ pipelineName: 'x', solanaSecretKey: Keypair.generate().secretKey, network: 'mainnet-beta' });
        const result = await anchor.anchor(dummySession);

        expect(result.explorerUrl).toBe('https://explorer.solana.com/tx/sig_main');
        expect(result.explorerUrl).not.toContain('devnet');
    });
});
