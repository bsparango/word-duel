/**
 * Escrow Configuration
 *
 * Contains the escrow wallet address.
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

// Current network (change this when deploying to mainnet)
export const CURRENT_NETWORK: 'devnet' | 'mainnet' = 'devnet';

// Get current escrow wallet
export const getEscrowWallet = () => ESCROW_CONFIG[CURRENT_NETWORK].escrowWallet;
