/**
 * Escrow Service
 *
 * Handles building deposit transactions for the Word Duel escrow system.
 * Supports both SOL (native) and USDC (SPL token) deposits.
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
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import { getEscrowWallet, getUsdcMint } from '../config/escrow';

// ============================================================
// TYPES
// ============================================================

export type BetCurrency = 'SOL' | 'USDC';

export interface DepositParams {
  playerPublicKey: PublicKey;
  amount: number; // Human-readable amount (e.g., 0.01 SOL or 1.00 USDC)
  currency: BetCurrency;
  gameRoomId: string;
}

export interface DepositResult {
  transaction: Transaction;
  amount: number;
  currency: BetCurrency;
}

// ============================================================
// DEPOSIT TRANSACTION BUILDERS
// ============================================================

/**
 * Build a deposit transaction for SOL (native Solana token).
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
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  // Build the transaction
  const transaction = new Transaction();
  transaction.add(transferInstruction);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = playerPublicKey;

  return transaction;
}

/**
 * Build a deposit transaction for USDC (SPL token).
 *
 * USDC is a token on Solana, so we need to:
 * 1. Find the player's USDC token account
 * 2. Find the escrow's USDC token account
 * 3. Create a token transfer instruction
 *
 * @param connection - Solana RPC connection
 * @param params - Deposit parameters
 * @returns Transaction ready to be signed
 */
export async function buildUsdcDepositTransaction(
  connection: Connection,
  params: DepositParams
): Promise<Transaction> {
  const { playerPublicKey, amount } = params;
  const escrowWallet = getEscrowWallet();
  const usdcMint = getUsdcMint();

  // USDC has 6 decimal places (1 USDC = 1,000,000 smallest units)
  const usdcAmount = Math.round(amount * 1_000_000);

  console.log(`[Escrow] Building USDC deposit: ${amount} USDC (${usdcAmount} units)`);
  console.log(`[Escrow] From: ${playerPublicKey.toString()}`);
  console.log(`[Escrow] To: ${escrowWallet.toString()}`);

  // Get the player's USDC token account (Associated Token Account)
  const playerTokenAccount = await getAssociatedTokenAddress(
    usdcMint,
    playerPublicKey
  );

  // Get the escrow's USDC token account
  const escrowTokenAccount = await getAssociatedTokenAddress(
    usdcMint,
    escrowWallet
  );

  console.log(`[Escrow] Player token account: ${playerTokenAccount.toString()}`);
  console.log(`[Escrow] Escrow token account: ${escrowTokenAccount.toString()}`);

  // Create the SPL token transfer instruction
  const transferInstruction = createTransferInstruction(
    playerTokenAccount, // source
    escrowTokenAccount, // destination
    playerPublicKey, // owner of source account
    usdcAmount, // amount in smallest units
    [], // no multisig signers
    TOKEN_PROGRAM_ID
  );

  // Get the latest blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Build the transaction
  const transaction = new Transaction();
  transaction.add(transferInstruction);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = playerPublicKey;

  return transaction;
}

/**
 * Build the appropriate deposit transaction based on currency.
 *
 * This is the main function to use - it automatically selects
 * the right builder based on the currency type.
 *
 * @param connection - Solana RPC connection
 * @param params - Deposit parameters
 * @returns Transaction ready to be signed
 */
export async function buildDepositTransaction(
  connection: Connection,
  params: DepositParams
): Promise<DepositResult> {
  let transaction: Transaction;

  if (params.currency === 'SOL') {
    transaction = await buildSolDepositTransaction(connection, params);
  } else {
    transaction = await buildUsdcDepositTransaction(connection, params);
  }

  return {
    transaction,
    amount: params.amount,
    currency: params.currency,
  };
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
 * Convert USDC amount to smallest units (6 decimals).
 */
export function usdcToUnits(usdc: number): number {
  return Math.round(usdc * 1_000_000);
}

/**
 * Convert USDC smallest units to human-readable.
 */
export function unitsToUsdc(units: number): number {
  return units / 1_000_000;
}

/**
 * Format an amount for display based on currency.
 */
export function formatAmount(amount: number, currency: BetCurrency): string {
  if (currency === 'SOL') {
    return `${amount.toFixed(4)} SOL`;
  } else {
    return `${amount.toFixed(2)} USDC`;
  }
}
