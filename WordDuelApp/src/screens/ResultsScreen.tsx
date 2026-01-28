/**
 * Results Screen
 *
 * Shows the final results after a game ends:
 * - Final score
 * - All words found
 * - Win/loss status (in multiplayer)
 * - Prize money earned (when betting is enabled)
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// ============================================================
// TYPES
// ============================================================

type ResultsScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

interface SubmittedWord {
  word: string;
  score: number;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function ResultsScreen({ navigation, route }: ResultsScreenProps) {
  // Get the results data passed from the Game Screen
  const {
    score = 0,
    words = [],
    betAmount = 0,
    isPractice = true,
    // These will be used later for multiplayer
    opponentScore = null,
    didWin = null,
    prizeWon = null,
  } = route.params || {};

  // Sort words by score (highest first)
  const sortedWords = [...(words as SubmittedWord[])].sort(
    (a, b) => b.score - a.score
  );

  // Calculate statistics
  const totalWords = words.length;
  const averageWordLength =
    totalWords > 0
      ? (words.reduce((sum: number, w: SubmittedWord) => sum + w.word.length, 0) / totalWords).toFixed(1)
      : 0;
  const longestWord =
    totalWords > 0
      ? words.reduce((longest: SubmittedWord, w: SubmittedWord) =>
          w.word.length > longest.word.length ? w : longest
        ).word
      : '-';

  // Handle play again button
  const handlePlayAgain = () => {
    navigation.replace('Game', {
      betAmount,
      isPractice,
    });
  };

  // Handle return to home
  const handleGoHome = () => {
    navigation.navigate('Home');
  };

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.gameOverTitle}>
          {isPractice ? 'Practice Complete!' : 'Game Over!'}
        </Text>
      </View>

      {/* Main Score Display */}
      <View style={styles.scoreSection}>
        <Text style={styles.scoreLabel}>Your Score</Text>
        <Text style={styles.scoreValue}>{score}</Text>

        {/* Multiplayer results (will be used later) */}
        {opponentScore !== null && (
          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>vs</Text>
            <Text style={styles.opponentScore}>{opponentScore}</Text>
          </View>
        )}

        {/* Win/Loss indicator */}
        {didWin !== null && (
          <View
            style={[
              styles.resultBadge,
              didWin ? styles.winBadge : styles.loseBadge,
            ]}
          >
            <Text style={styles.resultBadgeText}>
              {didWin ? 'VICTORY!' : 'DEFEAT'}
            </Text>
          </View>
        )}

        {/* Prize display */}
        {prizeWon !== null && prizeWon > 0 && (
          <View style={styles.prizeContainer}>
            <Text style={styles.prizeLabel}>You won</Text>
            <Text style={styles.prizeAmount}>+{prizeWon.toFixed(4)} SOL</Text>
          </View>
        )}
      </View>

      {/* Statistics */}
      <View style={styles.statsSection}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalWords}</Text>
          <Text style={styles.statLabel}>Words</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{averageWordLength}</Text>
          <Text style={styles.statLabel}>Avg Length</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{longestWord.length > 0 ? longestWord.length : '-'}</Text>
          <Text style={styles.statLabel}>Longest</Text>
        </View>
      </View>

      {/* Words List */}
      <View style={styles.wordsSection}>
        <Text style={styles.wordsSectionTitle}>Words Found</Text>
        {sortedWords.length > 0 ? (
          <FlatList
            data={sortedWords}
            keyExtractor={(item, index) => `${item.word}-${index}`}
            numColumns={2}
            columnWrapperStyle={styles.wordsRow}
            renderItem={({ item }) => (
              <View style={styles.wordItem}>
                <Text style={styles.wordText}>{item.word.toUpperCase()}</Text>
                <Text style={styles.wordScore}>+{item.score}</Text>
              </View>
            )}
          />
        ) : (
          <Text style={styles.noWordsText}>No words found</Text>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.button, styles.playAgainButton]}
          onPress={handlePlayAgain}
        >
          <Text style={styles.buttonText}>Play Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.homeButton]}
          onPress={handleGoHome}
        >
          <Text style={styles.buttonText}>Home</Text>
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
    marginBottom: 20,
  },
  gameOverTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },

  // Score section
  scoreSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  scoreLabel: {
    fontSize: 16,
    color: '#9ca3af',
  },
  scoreValue: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  vsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  vsText: {
    fontSize: 18,
    color: '#6b7280',
    marginHorizontal: 16,
  },
  opponentScore: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#ef4444',
  },
  resultBadge: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 20,
  },
  winBadge: {
    backgroundColor: '#166534',
  },
  loseBadge: {
    backgroundColor: '#7f1d1d',
  },
  resultBadgeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  prizeContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  prizeLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  prizeAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fbbf24', // Gold color
  },

  // Statistics
  statsSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#374151',
  },

  // Words section
  wordsSection: {
    flex: 1,
    marginBottom: 20,
  },
  wordsSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 12,
  },
  wordsRow: {
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  wordItem: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '48%',
  },
  wordText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#22d3ee',
  },
  wordScore: {
    fontSize: 14,
    color: '#22c55e',
  },
  noWordsText: {
    color: '#4b5563',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },

  // Action buttons
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  playAgainButton: {
    backgroundColor: '#22c55e',
  },
  homeButton: {
    backgroundColor: '#374151',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});
