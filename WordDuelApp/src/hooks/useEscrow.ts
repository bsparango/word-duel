/**
 * Escrow Hook
 *
 * Provides easy access to escrow operations in React components.
 * Handles the complete deposit flow including:
 * - Building the transaction
 * - Getting user signature via wallet
 * - Verifying the deposit with the backend
 *
 * Usage:
 *   const { deposit, status, error } = useEscrow();
 *   const success = await deposit(gameRoomId, 0.01, 'SOL');
 */

import { useState, useCallback } from 'react';
import functions from '@react-native-firebase/functions';

import { useWallet, CONNECTION } from './useWallet';
import { buildSolDepositTransaction } from '../services/escrow';

// ============================================================
// TYPES
// ============================================================

/**
 * Status of the escrow deposit process.
 * Each step in the flow has its own status.
 */
export type EscrowStatus =
  | 'idle' // No deposit in progress
  | 'building_tx' // Building the transaction
  | 'awaiting_signature' // Waiting for user to sign in wallet
  | 'sending' // Transaction sent, waiting for confirmation
  | 'verifying' // Verifying deposit with backend
  | 'complete' // Deposit successful
  | 'error'; // Something went wrong

/**
 * What the useEscrow hook provides.
 */
export interface UseEscrowResult {
  // Current status of the deposit process
  status: EscrowStatus;

  // Error message if something went wrong
  error: string | null;

  // Transaction signature (once sent)
  txSignature: string | null;

  // The game room ID used for the last deposit (needed for cancellation/refund)
  lastGameRoomId: string | null;

  // Human-readable status message for UI
  statusMessage: string;

  // Actions
  deposit: (gameRoomId: string, amount?: number) => Promise<boolean>;
  cancelDeposit: () => Promise<boolean>;
  reset: () => void;
}

// ============================================================
// STATUS MESSAGES
// ============================================================

/**
 * Human-readable messages for each status.
 * These are shown to the user during the deposit process.
 */
const STATUS_MESSAGES: Record<EscrowStatus, string> = {
  idle: '',
  building_tx: 'Preparing transaction...',
  awaiting_signature: 'Please confirm in your wallet',
  sending: 'Sending transaction...',
  verifying: 'Verifying deposit...',
  complete: 'Deposit confirmed!',
  error: 'Deposit failed',
};

// ============================================================
// HOOK IMPLEMENTATION
// ============================================================

export function useEscrow(): UseEscrowResult {
  // Get wallet functions
  const { publicKey, signAndSendTransaction, isConnected } = useWallet();

  // Local state
  const [status, setStatus] = useState<EscrowStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [lastGameRoomId, setLastGameRoomId] = useState<string | null>(null);

  /**
   * Execute a SOL deposit to the escrow wallet.
   *
   * This handles the complete flow:
   * 1. Build the SOL transaction
   * 2. Send to wallet for user signature
   * 3. Wait for blockchain confirmation
   * 4. Verify with Firebase backend
   *
   * @param gameRoomId - The game room to deposit for
   * @param amount - Amount to deposit in SOL (default 0.01)
   * @returns true if successful, false if failed
   */
  const deposit = useCallback(
    async (gameRoomId: string, amount: number = 0.01): Promise<boolean> => {
      // Validate wallet connection
      if (!isConnected || !publicKey) {
        setError('Wallet not connected');
        setStatus('error');
        return false;
      }

      try {
        // Reset state
        setError(null);
        setTxSignature(null);
        setLastGameRoomId(gameRoomId);

        // Step 1: Build the SOL transaction
        setStatus('building_tx');
        console.log(`[useEscrow] Building SOL deposit for ${amount}`);

        const transaction = await buildSolDepositTransaction(CONNECTION, {
          playerPublicKey: publicKey,
          amount,
          currency: 'SOL',
          gameRoomId,
        });

        // Step 2: Get user signature and send
        setStatus('awaiting_signature');
        console.log('[useEscrow] Requesting wallet signature...');

        const signature = await signAndSendTransaction(transaction);
        setTxSignature(signature);
        console.log(`[useEscrow] Transaction sent: ${signature}`);

        // Step 3: Transaction is confirmed (signAndSendTransaction waits for confirmation)
        setStatus('sending');

        // Step 4: Verify with Firebase backend
        setStatus('verifying');
        console.log('[useEscrow] Verifying deposit with backend...');

        const verifyDeposit = functions().httpsCallable('verifyDeposit');
        const result = await verifyDeposit({
          gameRoomId,
          playerId: publicKey.toString(),
          txSignature: signature,
          currency: 'SOL',
        });

        const resultData = result.data as { success: boolean; error?: string };

        if (!resultData.success) {
          throw new Error(resultData.error || 'Verification failed');
        }

        // Success!
        setStatus('complete');
        console.log('[useEscrow] Deposit verified successfully!');
        return true;
      } catch (err: any) {
        console.error('[useEscrow] Deposit error:', err);

        // Provide user-friendly error messages
        let errorMessage = err.message || 'Deposit failed';

        if (errorMessage.includes('rejected')) {
          errorMessage = 'Transaction was cancelled';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance';
        } else if (errorMessage.includes('timeout')) {
          errorMessage = 'Transaction timed out';
        }

        setError(errorMessage);
        setStatus('error');
        return false;
      }
    },
    [publicKey, isConnected, signAndSendTransaction]
  );

  /**
   * Cancel the deposit and request a refund.
   * This calls the Firebase cancelMatchmaking function to refund the escrow.
   *
   * @returns true if refund was successful, false otherwise
   */
  const cancelDeposit = useCallback(async (): Promise<boolean> => {
    if (!lastGameRoomId || !publicKey) {
      console.log('[useEscrow] No deposit to cancel - missing gameRoomId or publicKey');
      console.log(`[useEscrow] lastGameRoomId: ${lastGameRoomId}, publicKey: ${publicKey?.toString()}`);
      return true; // Nothing to cancel
    }

    try {
      console.log(`[useEscrow] Cancelling deposit for game ${lastGameRoomId}, player ${publicKey.toString()}`);

      const cancelMatchmaking = functions().httpsCallable('cancelMatchmaking');
      const result = await cancelMatchmaking({
        gameRoomId: lastGameRoomId,
        playerId: publicKey.toString(),
      });

      const resultData = result.data as { success: boolean; error?: string; refundSignature?: string };

      if (!resultData.success && resultData.error !== 'Game not found, nothing to refund') {
        console.error('[useEscrow] Cancel failed:', resultData.error);
        return false;
      }

      if (resultData.refundSignature) {
        console.log(`[useEscrow] Refund sent: ${resultData.refundSignature}`);
      }

      return true;
    } catch (err: any) {
      console.error('[useEscrow] Cancel error:', err);
      return false;
    }
  }, [lastGameRoomId, publicKey]);

  /**
   * Reset the escrow state.
   * Call this to clear errors and start fresh.
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setTxSignature(null);
    setLastGameRoomId(null);
  }, []);

  // Return the hook interface
  return {
    status,
    error,
    txSignature,
    lastGameRoomId,
    statusMessage: error || STATUS_MESSAGES[status],
    deposit,
    cancelDeposit,
    reset,
  };
}

// ============================================================
// HELPER HOOK - For listening to escrow status in Firebase
// ============================================================

/**
 * Listen to escrow status updates for a game.
 * Useful for showing when both players have deposited.
 */
export function useEscrowStatus(gameRoomId: string | null) {
  // This would use Firebase realtime database listener
  // For now, the game room already includes escrow status
  // which is synced via the existing multiplayer subscription
  return null;
}
