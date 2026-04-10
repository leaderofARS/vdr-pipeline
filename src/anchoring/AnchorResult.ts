import { AnchorResult } from '../types';

export type { AnchorResult };

/**
 * Build the Solana Explorer URL for an anchored transaction.
 *
 * @param transactionSignature - Base58 Solana transaction signature
 * @param network - Solana network ('mainnet-beta' | 'devnet')
 * @returns Full Solana Explorer URL
 */
export function buildExplorerUrl(
  transactionSignature: string,
  network: 'mainnet-beta' | 'devnet'
): string {
  const clusterParam = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${transactionSignature}${clusterParam}`;
}

/**
 * Build the SipHeron Verification URL for an anchored session.
 * 
 * @param sipheronAnchorId - The database ID or hash of the anchored record
 * @returns Full SipHeron Verification URL
 */
export function buildVerificationUrl(sipheronAnchorId: string): string {
  return `https://app.sipheron.com/ai/event/verify/${sipheronAnchorId}`;
}
