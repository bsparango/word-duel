/**
 * Escrow Service
 *
 * Handles building SOL deposit transactions for the Word Duel escrow system.
 *
 * The flow is:
 * 1. App builds a deposit transaction using this service
 * 2. User signs the transaction via their wallet
 * 3. Transaction is sent to Solana blockchain
 * 4. Firebase Function verifies the deposit on-chain
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

import { getEscrowWallet } from '../config/escrow';

// ============================================================
// TYPES
// ============================================================

export interface DepositParams {
  playerPublicKey: PublicKey;
  amount: number; // Amount in SOL (e.g., 0.01)
  currency: 'SOL';
  gameRoomId: string;
}

// ============================================================
// DEPOSIT TRANSACTION BUILDER
// ============================================================

/**
 * Build a deposit transaction for SOL.
 *
 * This creates a simple transfer from the player's wallet to the escrow wallet.
 *
 * @param connection - Solana RPC connection
 * @param params - Deposit parameters
 * @returns Transaction ready to be signed
 */
export async function buildSolDepositTransaction(
  connection: Connection,
  params: DepositParams
): Promise<Transaction> {
  const { playerPublicKey, amount } = params;
  const escrowWallet = getEscrowWallet();

  // Convert SOL to lamports (1 SOL = 1,000,000,000 lamports)
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);

  console.log(`[Escrow] Building SOL deposit: ${amount} SOL (${lamports} lamports)`);
  console.log(`[Escrow] From: ${playerPublicKey.toString()}`);
  console.log(`[Escrow] To: ${escrowWallet.toString()}`);

  // Create the transfer instruction
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: playerPublicKey,
    toPubkey: escrowWallet,
    lamports,
  });

  // Get the latest blockhash (required for transaction validity)
  const { blockhash } = await connection.getLatestBlockhash();

  // Build the transaction
  const transaction = new Transaction();
  transaction.add(transferInstruction);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = playerPublicKey;

  return transaction;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Convert SOL amount to lamports.
 */
export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL.
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Format a SOL amount for display.
 */
export function formatAmount(amount: number): string {
  return `${amount.toFixed(4)} SOL`;
}
