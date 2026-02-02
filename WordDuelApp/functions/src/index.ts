/**
 * Word Duel - Firebase Cloud Functions for Escrow
 *
 * These functions handle the server-side escrow operations:
 * - Verifying player deposits on Solana blockchain
 * - Processing payouts to winners when games end
 * - Handling refunds for ties and forfeits
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as bs58 from 'bs58';

// Initialize Firebase Admin
admin.initializeApp();

// ============================================================
// CONFIGURATION
// ============================================================

// Solana RPC endpoint (devnet for now)
const SOLANA_RPC = 'https://api.devnet.solana.com';

// USDC mint addresses
const USDC_MINT_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

// Initialize Solana connection
const connection = new Connection(SOLANA_RPC, 'confirmed');

/**
 * Load the escrow wallet keypair from environment variables.
 * The private key is stored in .env file (for local) or Firebase secrets (for deployed).
 */
function getEscrowKeypair(): Keypair {
  const privateKey = process.env.ESCROW_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      'Escrow private key not configured. Set ESCROW_PRIVATE_KEY in .env file or Firebase secrets.'
    );
  }

  // Decode the base58 private key
  const secretKey = bs58.decode(privateKey);
  return Keypair.fromSecretKey(secretKey);
}

// ============================================================
// VERIFY DEPOSIT FUNCTION
// ============================================================

interface VerifyDepositData {
  gameRoomId: string;
  playerId: string;
  txSignature: string;
  expectedAmount: number;
  currency: 'SOL' | 'USDC';
}

/**
 * Check if a transaction signature has already been used.
 * Prevents replay attacks where someone reuses an old transaction.
 */
async function isSignatureUsed(txSignature: string): Promise<boolean> {
  const ref = admin.database().ref(`usedSignatures/${txSignature}`);
  const snapshot = await ref.once('value');
  return snapshot.exists();
}

/**
 * Mark a transaction signature as used.
 */
async function markSignatureUsed(txSignature: string, gameRoomId: string, playerId: string): Promise<void> {
  await admin.database().ref(`usedSignatures/${txSignature}`).set({
    gameRoomId,
    playerId,
    usedAt: Date.now(),
  });
}

/**
 * Verify a player's deposit transaction on the Solana blockchain.
 * Called by the mobile app after player signs and sends their deposit.
 *
 * Security checks:
 * 1. Verify transaction signature hasn't been used before (replay protection)
 * 2. Verify the sender matches the claimed playerId
 * 3. Verify it sent the correct amount to the escrow wallet
 * 4. Update Firebase with the verified deposit
 */
export const verifyDeposit = functions.https.onCall(
  async (data: VerifyDepositData, context) => {
    const { gameRoomId, playerId, txSignature, expectedAmount, currency } = data;

    console.log(`[verifyDeposit] Starting verification for game ${gameRoomId}`);
    console.log(`[verifyDeposit] Player: ${playerId}, TX: ${txSignature}`);

    try {
      // SECURITY CHECK 1: Verify signature hasn't been used before (replay protection)
      const alreadyUsed = await isSignatureUsed(txSignature);
      if (alreadyUsed) {
        console.log('[verifyDeposit] REJECTED: Transaction signature already used');
        return { success: false, error: 'Transaction has already been used for a deposit' };
      }

      // Get the escrow keypair to know the expected destination
      const escrowKeypair = getEscrowKeypair();
      const escrowAddress = escrowKeypair.publicKey.toString();

      // Wait a moment for transaction to propagate
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Fetch the transaction from Solana
      const txInfo = await connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!txInfo) {
        console.log('[verifyDeposit] Transaction not found');
        return { success: false, error: 'Transaction not found on Solana' };
      }

      console.log('[verifyDeposit] Transaction found, verifying...');

      // Get account keys from the transaction
      const accountKeys = txInfo.transaction.message.getAccountKeys().staticAccountKeys;

      // SECURITY CHECK 2: Verify the sender (fee payer / first signer) matches the claimed player
      // The fee payer is always the first account in the transaction
      const senderAddress = accountKeys[0].toString();
      if (senderAddress !== playerId) {
        console.log(`[verifyDeposit] REJECTED: Sender mismatch. Expected ${playerId}, got ${senderAddress}`);
        return {
          success: false,
          error: 'Transaction sender does not match claimed player'
        };
      }
      console.log(`[verifyDeposit] Sender verified: ${senderAddress}`);

      // For SOL transfers, check the balance changes
      if (currency === 'SOL') {
        const preBalances = txInfo.meta?.preBalances || [];
        const postBalances = txInfo.meta?.postBalances || [];

        const escrowIndex = accountKeys.findIndex(
          (key) => key.toString() === escrowAddress
        );

        if (escrowIndex === -1) {
          console.log('[verifyDeposit] Escrow wallet not found in transaction');
          return {
            success: false,
            error: 'Transaction did not include escrow wallet',
          };
        }

        // Calculate amount received by escrow
        const amountReceived = postBalances[escrowIndex] - preBalances[escrowIndex];
        const expectedLamports = Math.round(expectedAmount * LAMPORTS_PER_SOL);

        console.log(
          `[verifyDeposit] Amount received: ${amountReceived}, expected: ${expectedLamports}`
        );

        // Allow small variance for rounding
        if (amountReceived < expectedLamports * 0.99) {
          return {
            success: false,
            error: `Insufficient deposit: received ${amountReceived / LAMPORTS_PER_SOL} SOL, expected ${expectedAmount} SOL`,
          };
        }

        // All security checks passed! Mark signature as used and update Firebase
        await markSignatureUsed(txSignature, gameRoomId, playerId);

        await updateDepositInFirebase(
          gameRoomId,
          playerId,
          txSignature,
          amountReceived,
          currency
        );

        console.log('[verifyDeposit] Deposit verified and recorded successfully');
        return { success: true, amountReceived };
      } else {
        // USDC verification (SPL token)
        const preTokenBalances = txInfo.meta?.preTokenBalances || [];
        const postTokenBalances = txInfo.meta?.postTokenBalances || [];

        // Check token balance changes
        const preBalance = preTokenBalances.find(
          (b) => b.owner === escrowAddress
        );
        const postBalance = postTokenBalances.find(
          (b) => b.owner === escrowAddress
        );

        const preAmount = preBalance?.uiTokenAmount?.uiAmount || 0;
        const postAmount = postBalance?.uiTokenAmount?.uiAmount || 0;
        const amountReceived = postAmount - preAmount;

        console.log(
          `[verifyDeposit] USDC received: ${amountReceived}, expected: ${expectedAmount}`
        );

        if (amountReceived < expectedAmount * 0.99) {
          return {
            success: false,
            error: `Insufficient USDC deposit: received ${amountReceived}, expected ${expectedAmount}`,
          };
        }

        // Convert to smallest units (6 decimals for USDC)
        const amountInSmallestUnit = Math.round(amountReceived * 1_000_000);

        // All security checks passed! Mark signature as used and update Firebase
        await markSignatureUsed(txSignature, gameRoomId, playerId);

        await updateDepositInFirebase(
          gameRoomId,
          playerId,
          txSignature,
          amountInSmallestUnit,
          currency
        );

        console.log('[verifyDeposit] USDC deposit verified and recorded successfully');
        return { success: true, amountReceived };
      }
    } catch (error: any) {
      console.error('[verifyDeposit] Error:', error);
      return { success: false, error: error.message };
    }
  }
);

/**
 * Helper: Update Firebase with verified deposit info
 */
async function updateDepositInFirebase(
  gameRoomId: string,
  playerId: string,
  txSignature: string,
  amount: number,
  currency: string
): Promise<void> {
  const gameRef = admin.database().ref(`games/${gameRoomId}`);

  // Determine if this is player1 or player2
  const player1Snapshot = await gameRef.child('player1/odid').once('value');
  const isPlayer1 = player1Snapshot.val() === playerId;
  const playerKey = isPlayer1 ? 'player1Deposit' : 'player2Deposit';

  console.log(`[updateDepositInFirebase] Updating ${playerKey} for game ${gameRoomId}`);

  // Save the deposit info
  await gameRef.child(`escrow/${playerKey}`).set({
    txSignature,
    amount,
    currency,
    confirmedAt: Date.now(),
  });

  // Check if both players have deposited
  const escrowSnapshot = await gameRef.child('escrow').once('value');
  const escrowData = escrowSnapshot.val();

  if (escrowData?.player1Deposit && escrowData?.player2Deposit) {
    // Both deposited - mark escrow as locked
    console.log(`[updateDepositInFirebase] Both deposits confirmed, locking escrow`);
    await gameRef.child('escrow/status').set('locked');
  } else {
    await gameRef.child('escrow/status').set('pending_deposits');
  }
}

// ============================================================
// PROCESS GAME PAYOUT FUNCTION
// ============================================================

/**
 * Automatically process payout when a game finishes.
 * This is triggered by Firebase when game.status changes to 'finished'.
 *
 * Logic:
 * - If there's a winner: send all escrow funds to winner
 * - If it's a tie: refund each player their deposit
 */
export const processGamePayout = functions.database
  .ref('/games/{gameId}/status')
  .onUpdate(async (change, context) => {
    const newStatus = change.after.val();
    const previousStatus = change.before.val();
    const gameId = context.params.gameId;

    // Only process when status changes TO 'finished'
    if (newStatus !== 'finished' || previousStatus === 'finished') {
      return null;
    }

    console.log(`[processGamePayout] Game ${gameId} finished, processing payout...`);

    // Get full game data
    const gameSnapshot = await admin.database().ref(`games/${gameId}`).once('value');
    const game = gameSnapshot.val();

    if (!game) {
      console.log('[processGamePayout] Game not found');
      return null;
    }

    // Check if already processed
    if (game.escrow?.status === 'paid_out' || game.escrow?.status === 'refunded') {
      console.log('[processGamePayout] Already processed');
      return null;
    }

    // Check if escrow was locked (both deposited)
    if (game.escrow?.status !== 'locked') {
      console.log('[processGamePayout] Escrow not locked, skipping payout');
      return null;
    }

    try {
      const escrowKeypair = getEscrowKeypair();
      const winner = game.winner;
      const player1 = game.player1;
      const player2 = game.player2;
      const currency = game.betCurrency || 'SOL';

      // Get deposit amounts
      const player1Deposit = game.escrow?.player1Deposit?.amount || 0;
      const player2Deposit = game.escrow?.player2Deposit?.amount || 0;
      const totalPot = player1Deposit + player2Deposit;

      console.log(`[processGamePayout] Total pot: ${totalPot}, Winner: ${winner || 'TIE'}`);

      if (totalPot === 0) {
        console.log('[processGamePayout] No deposits to pay out');
        return null;
      }

      // Handle tie (no winner)
      if (!winner) {
        console.log('[processGamePayout] Tie game - refunding both players');

        let player1RefundTx: string | null = null;
        let player2RefundTx: string | null = null;

        // Refund player 1 (wrap in try-catch so player 2 can still be refunded if this fails)
        if (player1Deposit > 0) {
          try {
            player1RefundTx = await sendPayout(
              escrowKeypair,
              player1.odid,
              player1Deposit,
              currency
            );
            console.log(`[processGamePayout] Player 1 refund complete: ${player1RefundTx}`);
          } catch (err: any) {
            console.error(`[processGamePayout] Player 1 refund failed: ${err.message}`);
          }
        }

        // Refund player 2 (wrap in try-catch so we can still update Firebase even if this fails)
        if (player2Deposit > 0) {
          try {
            player2RefundTx = await sendPayout(
              escrowKeypair,
              player2.odid,
              player2Deposit,
              currency
            );
            console.log(`[processGamePayout] Player 2 refund complete: ${player2RefundTx}`);
          } catch (err: any) {
            console.error(`[processGamePayout] Player 2 refund failed: ${err.message}`);
          }
        }

        // Update Firebase
        await admin.database().ref(`games/${gameId}/escrow`).update({
          status: 'refunded',
          refundedAt: Date.now(),
          player1RefundTx,
          player2RefundTx,
        });

        console.log('[processGamePayout] Refunds complete');
        return { refunded: true, player1RefundTx, player2RefundTx };
      }

      // Pay the winner (100% - no platform fee for now)
      const winnerAddress = winner;
      const payoutAmount = totalPot;

      console.log(`[processGamePayout] Sending ${payoutAmount} to winner ${winnerAddress}`);

      const payoutSignature = await sendPayout(
        escrowKeypair,
        winnerAddress,
        payoutAmount,
        currency
      );

      // Update Firebase
      await admin.database().ref(`games/${gameId}/escrow`).update({
        status: 'paid_out',
        payoutTx: payoutSignature,
        paidOutAt: Date.now(),
        winnerPayout: payoutAmount,
      });

      console.log(`[processGamePayout] Payout complete: ${payoutSignature}`);
      return { success: true, signature: payoutSignature };
    } catch (error: any) {
      console.error('[processGamePayout] Error:', error);

      // Log the error but don't crash - we can retry manually
      await admin.database().ref(`games/${gameId}/escrow`).update({
        payoutError: error.message,
        payoutAttemptedAt: Date.now(),
      });

      return { success: false, error: error.message };
    }
  });

/**
 * Helper: Send SOL or USDC payout from escrow to a player
 */
async function sendPayout(
  escrowKeypair: Keypair,
  recipientAddress: string,
  amount: number,
  currency: string
): Promise<string> {
  const recipientPublicKey = new PublicKey(recipientAddress);

  if (currency === 'SOL') {
    // SOL transfer
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: recipientPublicKey,
        lamports: amount,
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
      escrowKeypair,
    ]);

    console.log(`[sendPayout] SOL transfer complete: ${signature}`);
    return signature;
  } else {
    // USDC transfer
    const escrowTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT_DEVNET,
      escrowKeypair.publicKey
    );

    const recipientTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT_DEVNET,
      recipientPublicKey
    );

    const transaction = new Transaction().add(
      createTransferInstruction(
        escrowTokenAccount,
        recipientTokenAccount,
        escrowKeypair.publicKey,
        amount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
      escrowKeypair,
    ]);

    console.log(`[sendPayout] USDC transfer complete: ${signature}`);
    return signature;
  }
}

// ============================================================
// PROCESS FORFEIT FUNCTION
// ============================================================

interface ProcessForfeitData {
  gameRoomId: string;
  forfeitingPlayerId: string;
}

/**
 * Handle a player forfeiting mid-game.
 * The opponent wins and receives the entire pot.
 */
export const processForfeit = functions.https.onCall(
  async (data: ProcessForfeitData, context) => {
    const { gameRoomId, forfeitingPlayerId } = data;

    console.log(
      `[processForfeit] Player ${forfeitingPlayerId} forfeiting game ${gameRoomId}`
    );

    try {
      const gameRef = admin.database().ref(`games/${gameRoomId}`);
      const gameSnapshot = await gameRef.once('value');
      const game = gameSnapshot.val();

      if (!game) {
        return { success: false, error: 'Game not found' };
      }

      // Check if game is in a state where forfeit makes sense
      if (game.status === 'finished') {
        return { success: false, error: 'Game already finished' };
      }

      // Determine winner (opponent of forfeiting player)
      const winner =
        game.player1.odid === forfeitingPlayerId
          ? game.player2?.odid
          : game.player1.odid;

      if (!winner) {
        return { success: false, error: 'Could not determine winner' };
      }

      // Update game status to finished with winner
      // This will trigger the processGamePayout function
      await gameRef.update({
        status: 'finished',
        winner,
        endedAt: Date.now(),
        forfeitedBy: forfeitingPlayerId,
      });

      console.log(`[processForfeit] Game forfeited, winner: ${winner}`);
      return { success: true, winner };
    } catch (error: any) {
      console.error('[processForfeit] Error:', error);
      return { success: false, error: error.message };
    }
  }
);

// ============================================================
// CANCEL MATCHMAKING (REFUND SINGLE DEPOSIT)
// ============================================================

interface CancelMatchmakingData {
  gameRoomId: string;
  playerId: string;
}

/**
 * Cancel matchmaking and refund a player's deposit.
 * Used when a player leaves the queue before being matched.
 */
export const cancelMatchmaking = functions.https.onCall(
  async (data: CancelMatchmakingData, context) => {
    const { gameRoomId, playerId } = data;

    console.log(
      `[cancelMatchmaking] Player ${playerId} canceling game ${gameRoomId}`
    );

    try {
      const gameRef = admin.database().ref(`games/${gameRoomId}`);
      const gameSnapshot = await gameRef.once('value');
      const game = gameSnapshot.val();

      if (!game) {
        // Game might have been cleaned up already
        return { success: true, message: 'Game not found, nothing to refund' };
      }

      // Only allow cancellation if game hasn't started
      if (game.status === 'playing' || game.status === 'finished') {
        return { success: false, error: 'Cannot cancel - game in progress' };
      }

      // Find this player's deposit
      // For pending games, check both deposit slots since player1/player2 may not be set
      const isPlayer1 = game.player1?.odid === playerId;
      let deposit = isPlayer1
        ? game.escrow?.player1Deposit
        : game.escrow?.player2Deposit;

      // If not found, also check the other slot (for pending games where player roles aren't set)
      if (!deposit || deposit.amount === 0) {
        deposit = isPlayer1
          ? game.escrow?.player2Deposit
          : game.escrow?.player1Deposit;
      }

      if (!deposit || deposit.amount === 0) {
        return { success: true, message: 'No deposit to refund' };
      }

      // Process refund - use currency from deposit object (more reliable than game.betCurrency)
      const escrowKeypair = getEscrowKeypair();
      const currency = deposit.currency || game.betCurrency || 'SOL';

      const refundSignature = await sendPayout(
        escrowKeypair,
        playerId,
        deposit.amount,
        currency
      );

      // Update Firebase
      await gameRef.update({
        status: 'cancelled',
        cancelledBy: playerId,
        cancelledAt: Date.now(),
        'escrow/status': 'refunded',
        'escrow/refundTx': refundSignature,
      });

      console.log(`[cancelMatchmaking] Refund complete: ${refundSignature}`);
      return { success: true, refundSignature };
    } catch (error: any) {
      console.error('[cancelMatchmaking] Error:', error);
      return { success: false, error: error.message };
    }
  }
);
