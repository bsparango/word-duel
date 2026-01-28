/**
 * Escrow Configuration
 *
 * Contains the escrow wallet addresses for different networks.
 * The escrow wallet holds player deposits during games and
 * releases funds to the winner when the game ends.
 */

import { PublicKey } from '@solana/web3.js';

// Escrow wallet public keys (safe to include in app)
export const ESCROW_CONFIG = {
  // Devnet escrow wallet - for testing
  devnet: {
    escrowWallet: new PublicKey('EcBm5gSKBXFA3MAHJvcRBZc2zvwj1nJLHenN8EYGs7vW'),
  },

  // Mainnet escrow wallet - for production (set this before mainnet launch)
  mainnet: {
    escrowWallet: new PublicKey('11111111111111111111111111111111'), // Placeholder
  },
};

// USDC token mint addresses
export const USDC_MINT = {
  // Devnet USDC (test token)
  devnet: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),

  // Mainnet USDC (real token)
  mainnet: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};

// Current network (change this when deploying to mainnet)
export const CURRENT_NETWORK: 'devnet' | 'mainnet' = 'devnet';

// Get current escrow config based on network
export const getEscrowWallet = () => ESCROW_CONFIG[CURRENT_NETWORK].escrowWallet;
export const getUsdcMint = () => USDC_MINT[CURRENT_NETWORK];
