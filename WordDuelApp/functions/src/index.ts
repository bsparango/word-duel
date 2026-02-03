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
import * as bs58 from 'bs58';

// Dictionary for word validation (loaded once at cold start)
import words from 'an-array-of-english-words';
const VALID_WORDS = new Set(words);

// Initialize Firebase Admin
admin.initializeApp();

// ============================================================
// CONFIGURATION
// ============================================================

// Solana RPC endpoint (devnet for now)
const SOLANA_RPC = 'https://api.devnet.solana.com';

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
  expectedAmount?: number; // Deprecated: server now uses game.betAmount instead
  currency: 'SOL';
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
 * 1. Verify game exists and player is part of it
 * 2. Verify deposit amount/currency matches game's configured bet
 * 3. Verify transaction signature hasn't been used before (replay protection)
 * 4. Verify the sender matches the claimed playerId
 * 5. Verify it sent the correct amount to the escrow wallet
 * 6. Update Firebase with the verified deposit
 */
export const verifyDeposit = functions.https.onCall(
  async (data: VerifyDepositData, context) => {
    // Note: expectedAmount is ignored - we use game.betAmount instead for security
    const { gameRoomId, playerId, txSignature, currency } = data;

    console.log(`[verifyDeposit] Starting verification for game ${gameRoomId}`);
    console.log(`[verifyDeposit] Player: ${playerId}, TX: ${txSignature}`);

    try {
      // SECURITY CHECK 1: Fetch game and verify it exists
      const gameSnapshot = await admin.database().ref(`games/${gameRoomId}`).once('value');
      if (!gameSnapshot.exists()) {
        console.log('[verifyDeposit] REJECTED: Game not found');
        return { success: false, error: 'Game not found' };
      }

      const game = gameSnapshot.val();

      // SECURITY CHECK 2: Verify player is part of this game
      const isPlayer1 = game.player1?.odid === playerId;
      const isPlayer2 = game.player2?.odid === playerId;
      if (!isPlayer1 && !isPlayer2) {
        console.log('[verifyDeposit] REJECTED: Player not in this game');
        return { success: false, error: 'Player is not part of this game' };
      }

      // SECURITY CHECK 3: Verify currency matches game's configured currency
      const gameCurrency = game.betCurrency || 'SOL';
      if (currency !== gameCurrency) {
        console.log(`[verifyDeposit] REJECTED: Currency mismatch. Game requires ${gameCurrency}, got ${currency}`);
        return { success: false, error: `Game requires ${gameCurrency} deposits` };
      }

      // SECURITY CHECK 4: Get the expected amount from the GAME, not from the client
      // This prevents clients from claiming a smaller deposit amount
      const gameBetAmount = game.betAmount;
      console.log(`[verifyDeposit] Game bet: ${gameBetAmount} ${gameCurrency}`);

      // SECURITY CHECK 5: Verify signature hasn't been used before (replay protection)
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

      // Verify SOL transfer - check balance changes
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
      // Use game's bet amount, NOT the client-provided expectedAmount
      const requiredLamports = Math.round(gameBetAmount * LAMPORTS_PER_SOL);

      console.log(
        `[verifyDeposit] Amount received: ${amountReceived}, required: ${requiredLamports}`
      );

      // Allow small variance for rounding (0.1%)
      if (amountReceived < requiredLamports * 0.999) {
        return {
          success: false,
          error: `Insufficient deposit: received ${amountReceived / LAMPORTS_PER_SOL} SOL, required ${gameBetAmount} SOL`,
        };
      }

      // All security checks passed! Mark signature as used and update Firebase
      await markSignatureUsed(txSignature, gameRoomId, playerId);

      await updateDepositInFirebase(
        gameRoomId,
        playerId,
        txSignature,
        amountReceived,
        'SOL'
      );

      console.log('[verifyDeposit] Deposit verified and recorded successfully');
      return { success: true, amountReceived };
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
              player1Deposit
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
              player2Deposit
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
        payoutAmount
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
 * Helper: Send SOL payout from escrow to a player
 */
async function sendPayout(
  escrowKeypair: Keypair,
  recipientAddress: string,
  amount: number
): Promise<string> {
  const recipientPublicKey = new PublicKey(recipientAddress);

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

      // Process refund - cap at the game's bet amount to prevent over-refunding
      const escrowKeypair = getEscrowKeypair();
      const gameBetAmount = game.betAmount || 0.01;
      const maxRefundLamports = Math.round(gameBetAmount * LAMPORTS_PER_SOL);

      // Use the smaller of: actual deposit amount or max allowed refund
      const refundAmount = Math.min(deposit.amount, maxRefundLamports);

      console.log(`[cancelMatchmaking] Deposit amount: ${deposit.amount}, Max refund: ${maxRefundLamports}, Refunding: ${refundAmount}`);

      const refundSignature = await sendPayout(
        escrowKeypair,
        playerId,
        refundAmount
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

// ============================================================
// SERVER-SIDE WORD SUBMISSION (ANTI-CHEAT)
// ============================================================

interface SubmitWordData {
  gameId: string;
  playerId: string;
  word: string;
}

/**
 * Calculate the score for a word based on its length.
 * Must match the client-side scoring exactly.
 */
function calculateScore(word: string): number {
  const length = word.length;
  if (length < 3) return 0;

  const scoreTable: { [key: number]: number } = {
    3: 3,
    4: 5,
    5: 8,
    6: 12,
    7: 17,
    8: 23,
  };

  if (length > 8) {
    return 23 + (length - 8) * 6;
  }

  return scoreTable[length] || 0;
}

/**
 * Check if a word can be formed from available letters.
 */
function canFormWord(word: string, availableLetters: string[]): boolean {
  const available = [...availableLetters]; // Make a copy
  for (const char of word.toUpperCase()) {
    const index = available.indexOf(char);
    if (index === -1) {
      return false;
    }
    available.splice(index, 1);
  }
  return true;
}

/**
 * Server-side word submission with full validation.
 * This prevents cheating by validating:
 * 1. Word can be formed from game's letter pool
 * 2. Word is a valid English word
 * 3. Word hasn't already been submitted by this player
 * 4. Score is calculated server-side
 */
export const submitWord = functions.https.onCall(
  async (data: SubmitWordData, context) => {
    const { gameId, playerId, word } = data;

    if (!gameId || !playerId || !word) {
      return { success: false, error: 'Missing required fields' };
    }

    const normalizedWord = word.toUpperCase().trim();
    console.log(`[submitWord] Game: ${gameId}, Player: ${playerId}, Word: ${normalizedWord}`);

    try {
      const gameRef = admin.database().ref(`games/${gameId}`);
      const snapshot = await gameRef.once('value');

      if (!snapshot.exists()) {
        return { success: false, error: 'Game not found' };
      }

      const game = snapshot.val();

      // Verify game is in playing state
      if (game.status !== 'playing') {
        return { success: false, error: 'Game is not in progress' };
      }

      // Determine which player this is
      const isPlayer1 = game.player1?.odid === playerId;
      const isPlayer2 = game.player2?.odid === playerId;

      if (!isPlayer1 && !isPlayer2) {
        return { success: false, error: 'Player not in this game' };
      }

      const playerKey = isPlayer1 ? 'player1' : 'player2';
      const playerData = game[playerKey];

      // VALIDATION 1: Check word length
      if (normalizedWord.length < 3) {
        return { success: false, error: 'Word must be at least 3 letters' };
      }

      // VALIDATION 2: Check if word can be formed from letters
      const gameLetters = game.letters || [];
      if (!canFormWord(normalizedWord, gameLetters)) {
        console.log(`[submitWord] REJECTED: Cannot form "${normalizedWord}" from letters: ${gameLetters.join(',')}`);
        return { success: false, error: 'Word cannot be formed from available letters' };
      }

      // VALIDATION 3: Check if word is valid English
      if (!VALID_WORDS.has(normalizedWord.toLowerCase())) {
        console.log(`[submitWord] REJECTED: "${normalizedWord}" is not a valid word`);
        return { success: false, error: 'Not a valid English word' };
      }

      // VALIDATION 4: Check if word already submitted by this player
      const wordsFound = playerData.wordsFound || [];
      if (wordsFound.includes(normalizedWord)) {
        return { success: false, error: 'Word already submitted' };
      }

      // Calculate score server-side
      const score = calculateScore(normalizedWord);

      // Update Firebase atomically using transaction
      const playerRef = gameRef.child(playerKey);
      await playerRef.transaction((currentData) => {
        if (currentData === null) {
          return currentData;
        }

        // Double-check word hasn't been added (race condition protection)
        const currentWords = currentData.wordsFound || [];
        if (currentWords.includes(normalizedWord)) {
          return currentData; // No change
        }

        return {
          ...currentData,
          score: (currentData.score || 0) + score,
          wordsFound: [...currentWords, normalizedWord],
          lastActivity: Date.now(),
        };
      });

      console.log(`[submitWord] SUCCESS: "${normalizedWord}" = ${score} points`);
      return { success: true, word: normalizedWord, score };
    } catch (error: any) {
      console.error('[submitWord] Error:', error);
      return { success: false, error: error.message };
    }
  }
);
