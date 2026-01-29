/**
 * Matchmaking Screen
 *
 * This screen handles the full flow of entering a match:
 * 1. Deposit funds to escrow (user confirms in wallet)
 * 2. Search for an opponent
 * 3. Wait for both players to be ready
 * 4. Transition to the game
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// Import hooks
import { useMultiplayer, BetCurrency } from '../hooks/useMultiplayer';
import { useEscrow, EscrowStatus } from '../hooks/useEscrow';

// Preload dictionary while waiting for match
import { preloadDictionary } from '../utils/dictionary';

// ============================================================
// TYPES
// ============================================================

type MatchmakingScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

// Overall matchmaking phase
type MatchmakingPhase = 'deposit' | 'searching' | 'matched' | 'starting';

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MatchmakingScreen({
  navigation,
  route,
}: MatchmakingScreenProps) {
  // Get parameters passed from Home Screen
  const {
    playerId,
    betAmount = 0.01,
    betCurrency = 'SOL' as BetCurrency,
  } = route.params || {};

  // Track the current phase of matchmaking
  const [phase, setPhase] = useState<MatchmakingPhase>('deposit');
  const [depositComplete, setDepositComplete] = useState(false);

  // Get escrow functions for depositing
  const {
    status: escrowStatus,
    error: escrowError,
    statusMessage: escrowMessage,
    deposit,
    cancelDeposit,
    reset: resetEscrow,
  } = useEscrow();

  // Get multiplayer state and actions
  const {
    status: matchStatus,
    gameRoom,
    opponent,
    error: matchError,
    findMatch,
    cancelSearch,
    setReady,
  } = useMultiplayer();

  // --------------------------------------------------------
  // PRELOAD DICTIONARY WHILE WAITING
  // --------------------------------------------------------

  useEffect(() => {
    preloadDictionary();
  }, []);

  // --------------------------------------------------------
  // DEPOSIT PHASE
  // --------------------------------------------------------

  // Start deposit when screen loads
  useEffect(() => {
    if (phase === 'deposit' && escrowStatus === 'idle' && playerId && !depositComplete) {
      // Auto-start deposit (will prompt wallet)
      handleDeposit();
    }
  }, [phase, escrowStatus, playerId, depositComplete]);

  // Handle deposit completion
  useEffect(() => {
    if (escrowStatus === 'complete' && !depositComplete) {
      setDepositComplete(true);
      setPhase('searching');
    }
  }, [escrowStatus, depositComplete]);

  // Handle deposit
  const handleDeposit = useCallback(async () => {
    if (!playerId) return;

    // For now, we'll create a "pending" game room ID
    // In production, you'd create the game room first, then deposit
    const tempGameId = `pending_${playerId}_${Date.now()}`;

    const success = await deposit(tempGameId, betAmount, betCurrency);

    if (success) {
      setDepositComplete(true);
      setPhase('searching');
    }
  }, [playerId, betAmount, betCurrency, deposit]);

  // --------------------------------------------------------
  // SEARCHING PHASE
  // --------------------------------------------------------

  useEffect(() => {
    // Start searching after deposit is complete
    if (phase === 'searching' && depositComplete && matchStatus === 'idle') {
      findMatch(playerId, betAmount, betCurrency);
    }
  }, [phase, depositComplete, matchStatus, playerId, betAmount, betCurrency, findMatch]);

  // Update phase based on match status
  useEffect(() => {
    if (matchStatus === 'found' || matchStatus === 'ready') {
      setPhase('matched');
    } else if (matchStatus === 'playing') {
      setPhase('starting');
    }
  }, [matchStatus]);

  // --------------------------------------------------------
  // READY PHASE
  // --------------------------------------------------------

  useEffect(() => {
    // Auto-ready when match is found
    if (matchStatus === 'ready' && gameRoom) {
      setReady();
    }
  }, [matchStatus, gameRoom, setReady]);

  // --------------------------------------------------------
  // GAME START
  // --------------------------------------------------------

  useEffect(() => {
    // Navigate to game when it starts
    if (matchStatus === 'playing' && gameRoom) {
      navigation.replace('Game', {
        betAmount,
        betCurrency,
        isPractice: false,
        isMultiplayer: true,
        gameRoomId: gameRoom.id,
        playerId: playerId,
        letters: gameRoom.letters,
        opponentName: opponent?.displayName || 'Opponent',
      });
    }
  }, [matchStatus, gameRoom, navigation, betAmount, betCurrency, playerId, opponent]);

  // --------------------------------------------------------
  // HANDLERS
  // --------------------------------------------------------

  // Cancel and go back home
  const handleCancel = async () => {
    // Cancel matchmaking if in progress
    if (matchStatus !== 'idle') {
      await cancelSearch();
    }

    // If deposit was made, request a refund
    if (depositComplete) {
      console.log('[MatchmakingScreen] Requesting refund for deposit...');
      const refundSuccess = await cancelDeposit();
      if (refundSuccess) {
        console.log('[MatchmakingScreen] Refund processed successfully');
      } else {
        console.error('[MatchmakingScreen] Refund may have failed - check escrow');
      }
    }

    navigation.goBack();
  };

  // Retry deposit if it failed
  const handleRetryDeposit = () => {
    resetEscrow();
    setPhase('deposit');
  };

  // --------------------------------------------------------
  // RENDER HELPERS
  // --------------------------------------------------------

  // Get the main status message based on phase
  const getStatusMessage = (): string => {
    if (phase === 'deposit') {
      return escrowMessage || 'Preparing deposit...';
    }

    switch (matchStatus) {
      case 'searching':
        return 'Searching for opponent...';
      case 'found':
        return 'Match found!';
      case 'ready':
        return opponent
          ? `Matched with ${opponent.displayName}!\nWaiting for game to start...`
          : 'Waiting for opponent...';
      case 'playing':
        return 'Starting game...';
      default:
        return 'Preparing...';
    }
  };

  // Check if we should show the spinner
  const showSpinner =
    (phase === 'deposit' && ['building_tx', 'awaiting_signature', 'sending', 'verifying'].includes(escrowStatus)) ||
    (phase === 'searching' && matchStatus === 'searching') ||
    (phase === 'matched' && ['found', 'ready'].includes(matchStatus)) ||
    phase === 'starting';

  // Get current error message
  const errorMessage = escrowError || matchError;

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {phase === 'deposit' ? 'DEPOSIT' : 'MATCHMAKING'}
        </Text>
        <Text style={styles.subtitle}>
          {phase === 'deposit' ? 'Secure your wager' : 'Find your opponent'}
        </Text>
      </View>

      {/* Bet Amount Display */}
      <View style={styles.betContainer}>
        <Text style={styles.betLabel}>Wager</Text>
        <Text style={styles.betAmount}>
          {betAmount} {betCurrency}
        </Text>
        <Text style={styles.betNote}>Winner takes all</Text>
      </View>

      {/* Progress Steps */}
      <View style={styles.stepsContainer}>
        <View style={styles.step}>
          <View
            style={[
              styles.stepDot,
              (depositComplete || phase !== 'deposit') && styles.stepDotComplete,
              phase === 'deposit' && !depositComplete && styles.stepDotActive,
            ]}
          >
            {depositComplete && <Text style={styles.stepCheck}>✓</Text>}
          </View>
          <Text style={styles.stepLabel}>Deposit</Text>
        </View>

        <View style={styles.stepLine} />

        <View style={styles.step}>
          <View
            style={[
              styles.stepDot,
              phase === 'matched' || phase === 'starting' ? styles.stepDotComplete : null,
              phase === 'searching' && styles.stepDotActive,
            ]}
          >
            {(phase === 'matched' || phase === 'starting') && (
              <Text style={styles.stepCheck}>✓</Text>
            )}
          </View>
          <Text style={styles.stepLabel}>Match</Text>
        </View>

        <View style={styles.stepLine} />

        <View style={styles.step}>
          <View
            style={[
              styles.stepDot,
              phase === 'starting' && styles.stepDotActive,
            ]}
          />
          <Text style={styles.stepLabel}>Play</Text>
        </View>
      </View>

      {/* Status Section */}
      <View style={styles.statusSection}>
        {/* Loading Spinner */}
        {showSpinner && (
          <ActivityIndicator
            size="large"
            color="#7c3aed"
            style={styles.spinner}
          />
        )}

        {/* Status Message */}
        <Text style={styles.statusText}>{getStatusMessage()}</Text>

        {/* Opponent Info (when matched) */}
        {opponent && (
          <View style={styles.opponentInfo}>
            <Text style={styles.opponentLabel}>Your Opponent</Text>
            <Text style={styles.opponentName}>{opponent.displayName}</Text>
          </View>
        )}

        {/* Error Message */}
        {errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            {escrowError && (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetryDeposit}
              >
                <Text style={styles.retryButtonText}>Retry Deposit</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Tips Section */}
      <View style={styles.tipsSection}>
        <Text style={styles.tipsTitle}>Game Rules</Text>
        <Text style={styles.tipText}>• Find as many words as you can</Text>
        <Text style={styles.tipText}>• Longer words = more points</Text>
        <Text style={styles.tipText}>• Same letters for both players</Text>
        <Text style={styles.tipText}>• 60 seconds to score big!</Text>
      </View>

      {/* Cancel Button */}
      <View style={styles.bottomSection}>
        <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
          <Text style={styles.cancelButtonText}>
            {phase === 'deposit' ? 'Cancel' : 'Cancel Search'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 20,
  },

  // Header
  header: {
    alignItems: 'center',
    marginTop: 0,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 8,
  },

  // Bet display
  betContainer: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  betLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 4,
  },
  betAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  betNote: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
  },

  // Progress steps
  stepsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  step: {
    alignItems: 'center',
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepDotActive: {
    backgroundColor: '#7c3aed',
  },
  stepDotComplete: {
    backgroundColor: '#22c55e',
  },
  stepCheck: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stepLabel: {
    color: '#9ca3af',
    fontSize: 12,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: '#374151',
    marginHorizontal: 8,
    marginBottom: 20,
  },

  // Status section
  statusSection: {
    alignItems: 'center',
    marginBottom: 20,
    minHeight: 120,
  },
  spinner: {
    marginBottom: 20,
  },
  statusText: {
    fontSize: 18,
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 26,
  },
  opponentInfo: {
    marginTop: 20,
    alignItems: 'center',
    backgroundColor: '#374151',
    padding: 16,
    borderRadius: 12,
  },
  opponentLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  opponentName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#22d3ee',
    fontFamily: 'monospace',
  },
  errorContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },

  // Tips section
  tipsSection: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  tipText: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 6,
  },

  // Bottom section
  bottomSection: {
    marginTop: 'auto',
    paddingBottom: 10,
  },
  cancelButton: {
    backgroundColor: '#7f1d1d',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
