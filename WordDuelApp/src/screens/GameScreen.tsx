/**
 * Game Screen
 *
 * This is where the word game happens! Players see:
 * - A timer counting down from 60 seconds
 * - A pool of letter tiles to tap
 * - Their current word being formed
 * - A list of words they've already made
 * - Their score
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// Import our utility functions
import { generateLetterPool, generateRandomLetters, calculateScore } from '../utils/gameLogic';
import { isValidWord } from '../utils/dictionary';
import LetterTile from '../components/LetterTile';

// ============================================================
// TYPES
// ============================================================

type GameScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

// A letter in the pool with its unique ID and selection state
interface PoolLetter {
  id: string;
  letter: string;
  isUsed: boolean; // Is it currently being used in the word being formed?
}

// A word that has been submitted
interface SubmittedWord {
  word: string;
  score: number;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function GameScreen({ navigation, route }: GameScreenProps) {
  // Get parameters passed from the Home Screen
  const { betAmount = 0, isPractice = true } = route.params || {};

  // --------------------------------------------------------
  // STATE - All the data that can change during the game
  // --------------------------------------------------------

  // Game timer (starts at 60 seconds)
  const [timeLeft, setTimeLeft] = useState(60);

  // Is the game currently running?
  const [isGameActive, setIsGameActive] = useState(true);

  // The pool of available letters
  const [letterPool, setLetterPool] = useState<PoolLetter[]>([]);

  // Letters currently selected to form a word
  const [currentWordLetters, setCurrentWordLetters] = useState<PoolLetter[]>([]);

  // All words the player has successfully submitted
  const [submittedWords, setSubmittedWords] = useState<SubmittedWord[]>([]);

  // Total score
  const [totalScore, setTotalScore] = useState(0);

  // Feedback message (like "Nice!" or "Not a word")
  const [feedback, setFeedback] = useState<string | null>(null);

  // --------------------------------------------------------
  // INITIALIZE GAME - Set up letters when screen loads
  // --------------------------------------------------------

  useEffect(() => {
    // Generate 16 random letters (like Boggle)
    const letters = generateLetterPool(16);

    // Convert to our PoolLetter format with IDs
    const poolWithIds: PoolLetter[] = letters.map((letter, index) => ({
      id: `letter-${index}`,
      letter: letter,
      isUsed: false,
    }));

    setLetterPool(poolWithIds);
  }, []);

  // --------------------------------------------------------
  // TIMER - Count down every second
  // --------------------------------------------------------

  useEffect(() => {
    if (!isGameActive || timeLeft <= 0) {
      if (timeLeft <= 0) {
        // Time's up! End the game
        setIsGameActive(false);

        // Navigate to results after a short delay
        setTimeout(() => {
          navigation.replace('Results', {
            score: totalScore,
            words: submittedWords,
            betAmount,
            isPractice,
          });
        }, 1500);
      }
      return;
    }

    // Set up a timer that ticks every second
    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    // Clean up the timer when component unmounts
    return () => clearInterval(timer);
  }, [isGameActive, timeLeft, navigation, totalScore, submittedWords, betAmount, isPractice]);

  // --------------------------------------------------------
  // GAME ACTIONS
  // --------------------------------------------------------

  // When a letter tile is tapped
  const handleLetterTap = useCallback((tappedLetter: PoolLetter) => {
    if (!isGameActive) return;

    // If it's already used, do nothing
    if (tappedLetter.isUsed) return;

    // Add to current word
    setCurrentWordLetters((prev) => [...prev, tappedLetter]);

    // Mark as used in the pool
    setLetterPool((prev) =>
      prev.map((l) =>
        l.id === tappedLetter.id ? { ...l, isUsed: true } : l
      )
    );

    // Clear any feedback
    setFeedback(null);
  }, [isGameActive]);

  // Remove the last letter from current word (backspace)
  const handleBackspace = useCallback(() => {
    if (currentWordLetters.length === 0) return;

    // Get the last letter
    const lastLetter = currentWordLetters[currentWordLetters.length - 1];

    // Remove it from current word
    setCurrentWordLetters((prev) => prev.slice(0, -1));

    // Mark it as available again in the pool
    setLetterPool((prev) =>
      prev.map((l) =>
        l.id === lastLetter.id ? { ...l, isUsed: false } : l
      )
    );
  }, [currentWordLetters]);

  // Clear the entire current word
  const handleClear = useCallback(() => {
    // Mark all current word letters as available
    const usedIds = currentWordLetters.map((l) => l.id);

    setLetterPool((prev) =>
      prev.map((l) =>
        usedIds.includes(l.id) ? { ...l, isUsed: false } : l
      )
    );

    // Clear the current word
    setCurrentWordLetters([]);
    setFeedback(null);
  }, [currentWordLetters]);

  // Submit the current word
  const handleSubmit = useCallback(() => {
    // Need at least 3 letters
    if (currentWordLetters.length < 3) {
      setFeedback('Need 3+ letters');
      Vibration.vibrate(100); // Short vibration for feedback
      return;
    }

    // Build the word string
    const word = currentWordLetters.map((l) => l.letter).join('');

    // Check if already submitted
    if (submittedWords.some((w) => w.word === word)) {
      setFeedback('Already used!');
      Vibration.vibrate(100);
      return;
    }

    // Check if it's a valid English word
    if (!isValidWord(word)) {
      setFeedback('Not a word');
      Vibration.vibrate(100);
      return;
    }

    // Calculate the score for this word
    const wordScore = calculateScore(word);

    // Add to submitted words
    setSubmittedWords((prev) => [...prev, { word, score: wordScore }]);

    // Update total score
    setTotalScore((prev) => prev + wordScore);

    // Show success feedback
    setFeedback(`+${wordScore} points!`);

    // Get the IDs of letters that were used in this word
    const usedLetterIds = currentWordLetters.map((l) => l.id);

    // Generate new random letters to replace the used ones
    const newLetters = generateRandomLetters(usedLetterIds.length);

    // Replace used letters with new random letters in the pool
    // Each used letter gets replaced with a fresh letter in the same position
    let newLetterIndex = 0;
    setLetterPool((prev) =>
      prev.map((poolLetter) => {
        if (usedLetterIds.includes(poolLetter.id)) {
          // This letter was used - replace it with a new random letter
          const replacementLetter = newLetters[newLetterIndex];
          newLetterIndex++;
          return {
            ...poolLetter,
            letter: replacementLetter,
            isUsed: false, // New letter is available
          };
        }
        return poolLetter;
      })
    );

    // Clear the current word selection
    setCurrentWordLetters([]);

    // Pleasant vibration for success
    Vibration.vibrate([0, 50, 30, 50]);
  }, [currentWordLetters, submittedWords]);

  // --------------------------------------------------------
  // COMPUTED VALUES
  // --------------------------------------------------------

  // The current word as a string
  const currentWord = currentWordLetters.map((l) => l.letter).join('');

  // Format time as MM:SS
  const formattedTime = `${Math.floor(timeLeft / 60)}:${(timeLeft % 60)
    .toString()
    .padStart(2, '0')}`;

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar: Timer and Score */}
      <View style={styles.topBar}>
        <View style={styles.timerContainer}>
          <Text style={styles.timerLabel}>Time</Text>
          <Text style={[styles.timer, timeLeft <= 10 && styles.timerUrgent]}>
            {formattedTime}
          </Text>
        </View>

        <View style={styles.scoreContainer}>
          <Text style={styles.scoreLabel}>Score</Text>
          <Text style={styles.score}>{totalScore}</Text>
        </View>
      </View>

      {/* Current word being formed */}
      <View style={styles.currentWordSection}>
        <View style={styles.currentWordContainer}>
          <Text style={styles.currentWord}>
            {currentWord || 'Tap letters below'}
          </Text>
        </View>
        {feedback && (
          <Text
            style={[
              styles.feedback,
              feedback.includes('+') ? styles.feedbackSuccess : styles.feedbackError,
            ]}
          >
            {feedback}
          </Text>
        )}
      </View>

      {/* Letter Pool - 4x4 grid */}
      <View style={styles.letterPoolContainer}>
        <View style={styles.letterPool}>
          {letterPool.map((item) => (
            <LetterTile
              key={item.id}
              letter={item.letter}
              isUsed={item.isUsed}
              onPress={() => handleLetterTap(item)}
            />
          ))}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backspaceButton} onPress={handleBackspace}>
          <Text style={styles.backspaceButtonText}>←</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.submitButton,
            currentWordLetters.length < 3 && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
        >
          <Text style={styles.submitButtonText}>Submit</Text>
        </TouchableOpacity>
      </View>

      {/* Submitted words list */}
      <View style={styles.wordsListContainer}>
        <Text style={styles.wordsListTitle}>
          Words Found ({submittedWords.length})
        </Text>
        <FlatList
          data={submittedWords}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, index) => `${item.word}-${index}`}
          renderItem={({ item }) => (
            <View style={styles.submittedWordChip}>
              <Text style={styles.submittedWordText}>
                {item.word} (+{item.score})
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyListText}>No words yet</Text>
          }
        />
      </View>

      {/* Game Over Overlay */}
      {!isGameActive && (
        <View style={styles.gameOverOverlay}>
          <Text style={styles.gameOverText}>Time's Up!</Text>
          <Text style={styles.finalScoreText}>Final Score: {totalScore}</Text>
        </View>
      )}
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
    padding: 16,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  timerContainer: {
    alignItems: 'center',
  },
  timerLabel: {
    color: '#9ca3af',
    fontSize: 14,
  },
  timer: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'], // Keeps numbers from jumping around
  },
  timerUrgent: {
    color: '#ef4444', // Red when time is low
  },
  scoreContainer: {
    alignItems: 'center',
  },
  scoreLabel: {
    color: '#9ca3af',
    fontSize: 14,
  },
  score: {
    color: '#22c55e',
    fontSize: 36,
    fontWeight: 'bold',
  },

  // Current word section
  currentWordSection: {
    alignItems: 'center',
    marginBottom: 20,
    minHeight: 80,
  },
  currentWordContainer: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: 200,
    alignItems: 'center',
  },
  currentWord: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  feedback: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  feedbackSuccess: {
    color: '#22c55e',
  },
  feedbackError: {
    color: '#ef4444',
  },

  // Letter pool
  letterPoolContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  letterPool: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280, // 4 tiles * 70px each
    justifyContent: 'center',
    gap: 8,
  },

  // Action buttons
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  clearButton: {
    backgroundColor: '#374151',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  clearButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  backspaceButton: {
    backgroundColor: '#374151',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  backspaceButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  submitButton: {
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#166534',
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Words list
  wordsListContainer: {
    flex: 1,
  },
  wordsListTitle: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 8,
  },
  submittedWordChip: {
    backgroundColor: '#16213e',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8,
  },
  submittedWordText: {
    color: '#22d3ee',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  emptyListText: {
    color: '#4b5563',
    fontStyle: 'italic',
  },

  // Game over overlay
  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gameOverText: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: 'bold',
  },
  finalScoreText: {
    color: '#22c55e',
    fontSize: 24,
    marginTop: 16,
  },
});
