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
