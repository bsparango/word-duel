/**
 * Matchmaking Screen
 *
 * This screen handles the full flow of entering a match:
 * 1. Search for an opponent (no deposit yet)
 * 2. Match found - show opponent info
 * 3. Deposit funds to the REAL game room ID
 * 4. Wait for opponent's deposit
 * 5. Transition to the game
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// Import hooks
import { useMultiplayer } from '../hooks/useMultiplayer';
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

// Overall matchmaking phase - NEW ORDER: search first, then deposit
type MatchmakingPhase = 'searching' | 'matched' | 'depositing' | 'waiting_opponent' | 'starting';

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
  } = route.params || {};

  // Track the current phase of matchmaking
  const [phase, setPhase] = useState<MatchmakingPhase>('searching');
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
  // PHASE 1: SEARCHING - Start searching immediately
  // --------------------------------------------------------

  useEffect(() => {
    // Start searching when screen loads
    if (phase === 'searching' && matchStatus === 'idle' && playerId) {
      console.log('[Matchmaking] Starting search...');
      findMatch(playerId, betAmount);
    }
  }, [phase, matchStatus, playerId, betAmount, findMatch]);

  // --------------------------------------------------------
  // PHASE 2: MATCHED - When opponent found, prompt for deposit
  // --------------------------------------------------------

  useEffect(() => {
    // When match is found, move to matched phase
    if ((matchStatus === 'found' || matchStatus === 'ready') && phase === 'searching') {
      console.log('[Matchmaking] Match found! Moving to deposit phase...');
      setPhase('matched');
    }
  }, [matchStatus, phase]);

  // Auto-start deposit when we have a real game room ID
  useEffect(() => {
    if (phase === 'matched' && gameRoom?.id && !depositComplete && escrowStatus === 'idle') {
      console.log(`[Matchmaking] Starting deposit for game ${gameRoom.id}`);
      setPhase('depositing');
      handleDeposit();
    }
  }, [phase, gameRoom, depositComplete, escrowStatus]);

  // --------------------------------------------------------
  // PHASE 3: DEPOSITING - Make the deposit to real game ID
  // --------------------------------------------------------

  const handleDeposit = useCallback(async () => {
    if (!playerId || !gameRoom?.id) {
      console.error('[Matchmaking] Cannot deposit - missing playerId or gameRoom.id');
      return;
    }

    console.log(`[Matchmaking] Depositing ${betAmount} SOL to game ${gameRoom.id}`);
    const success = await deposit(gameRoom.id, betAmount);

    if (success) {
      setDepositComplete(true);
      setPhase('waiting_opponent');
      // Signal we're ready (deposit complete)
      setReady();
    }
  }, [playerId, gameRoom, betAmount, deposit, setReady]);

  // Handle deposit completion
  useEffect(() => {
    if (escrowStatus === 'complete' && phase === 'depositing' && !depositComplete) {
      setDepositComplete(true);
      setPhase('waiting_opponent');
      setReady();
    }
  }, [escrowStatus, phase, depositComplete, setReady]);

  // --------------------------------------------------------
  // PHASE 4: WAITING FOR OPPONENT'S DEPOSIT
  // --------------------------------------------------------

  useEffect(() => {
    // When game status becomes 'playing', both deposits are in
    if (matchStatus === 'playing') {
      setPhase('starting');
    }
  }, [matchStatus]);

  // --------------------------------------------------------
  // PHASE 5: GAME START
  // --------------------------------------------------------

  useEffect(() => {
    // Navigate to game when it starts
    if (matchStatus === 'playing' && gameRoom && phase === 'starting') {
      navigation.replace('Game', {
        betAmount,
        isPractice: false,
        isMultiplayer: true,
        gameRoomId: gameRoom.id,
        playerId: playerId,
        letters: gameRoom.letters,
        opponentName: opponent?.displayName || 'Opponent',
      });
    }
  }, [matchStatus, gameRoom, phase, navigation, betAmount, playerId, opponent]);

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
    if (depositComplete && gameRoom?.id) {
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
    setPhase('matched'); // Go back to matched phase to retry deposit
  };

  // --------------------------------------------------------
  // RENDER HELPERS
  // --------------------------------------------------------

  // Get the main status message based on phase
  const getStatusMessage = (): string => {
    switch (phase) {
      case 'searching':
        return 'Searching for opponent...';
      case 'matched':
        return opponent
          ? `Matched with ${opponent.displayName}!`
          : 'Match found!';
      case 'depositing':
        return escrowMessage || 'Processing deposit...';
      case 'waiting_opponent':
        return 'Waiting for opponent\'s deposit...';
      case 'starting':
        return 'Starting game...';
      default:
        return 'Preparing...';
    }
  };

  // Check if we should show the spinner
  const showSpinner =
    phase === 'searching' ||
    (phase === 'depositing' && ['building_tx', 'awaiting_signature', 'sending', 'verifying'].includes(escrowStatus)) ||
    phase === 'waiting_opponent' ||
    phase === 'starting';

  // Get current error message
  const errorMessage = escrowError || matchError;

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {phase === 'depositing' ? 'DEPOSIT' : 'MATCHMAKING'}
        </Text>
        <Text style={styles.subtitle}>
          {phase === 'depositing' ? 'Secure your wager' :
           phase === 'searching' ? 'Finding opponent' :
           phase === 'waiting_opponent' ? 'Almost ready' :
           'Get ready to play'}
        </Text>
      </View>

      {/* Bet Amount Display */}
      <View style={styles.betContainer}>
        <Text style={styles.betLabel}>Wager</Text>
        <Text style={styles.betAmount}>
          {betAmount} SOL
        </Text>
        <Text style={styles.betNote}>Winner takes all</Text>
      </View>

      {/* Progress Steps - Updated order */}
      <View style={styles.stepsContainer}>
        {/* Step 1: Match */}
        <View style={styles.step}>
          <View
            style={[
              styles.stepDot,
              phase !== 'searching' && styles.stepDotComplete,
              phase === 'searching' && styles.stepDotActive,
            ]}
          >
            {phase !== 'searching' && <Text style={styles.stepCheck}>✓</Text>}
          </View>
          <Text style={styles.stepLabel}>Match</Text>
        </View>

        <View style={styles.stepLine} />

        {/* Step 2: Deposit */}
        <View style={styles.step}>
          <View
            style={[
              styles.stepDot,
              depositComplete && styles.stepDotComplete,
              (phase === 'matched' || phase === 'depositing') && !depositComplete && styles.stepDotActive,
            ]}
          >
            {depositComplete && <Text style={styles.stepCheck}>✓</Text>}
          </View>
          <Text style={styles.stepLabel}>Deposit</Text>
        </View>

        <View style={styles.stepLine} />

        {/* Step 3: Play */}
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
        {opponent && phase !== 'searching' && (
          <View style={styles.opponentInfo}>
            <Text style={styles.opponentLabel}>Your Opponent</Text>
            <Text style={styles.opponentName}>{opponent.displayName}</Text>
          </View>
        )}

        {/* Game Room ID (for debugging - shows we're using real ID) */}
        {gameRoom?.id && (
          <Text style={styles.gameIdText}>Game: {gameRoom.id.slice(0, 12)}...</Text>
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
            {phase === 'searching' ? 'Cancel Search' :
             phase === 'depositing' ? 'Cancel' :
             'Leave Match'}
          </Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
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
  },
  scrollContent: {
    flexGrow: 1,
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
  gameIdText: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
    fontFamily: 'monospace',
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
    marginTop: 16,
    paddingBottom: 20,
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
