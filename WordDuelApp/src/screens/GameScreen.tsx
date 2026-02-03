/**
 * Game Screen
 *
 * This is where the word game happens! Players see:
 * - A timer counting down from 60 seconds
 * - A pool of letter tiles to tap
 * - Their current word being formed
 * - A list of words they've already made
 * - Their score (and opponent's score in multiplayer)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Vibration,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// Import our utility functions
import { generateLetterPool, generateRandomLetters, calculateScore } from '../utils/gameLogic';
import { isValidWord, preloadDictionary } from '../utils/dictionary';
import LetterTile from '../components/LetterTile';

// Import multiplayer service for real-time sync
import {
  multiplayerService,
  GameRoom,
  PlayerState,
} from '../services/multiplayer';

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
  // Get parameters passed from the Home/Matchmaking Screen
  const {
    betAmount = 0,
    isPractice = true,
    isMultiplayer = false,
    gameRoomId = null,
    playerId = null,
    letters: sharedLetters = null,
    opponentName = 'Opponent',
  } = route.params || {};

  // --------------------------------------------------------
  // MULTIPLAYER STATE
  // --------------------------------------------------------

  // Opponent's score (updated in real-time from Firebase)
  const [opponentState, setOpponentState] = useState<PlayerState | null>(null);

  // Cleanup function for Firebase listener
  const gameCleanupRef = useRef<(() => void) | null>(null);

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

  // Track if we've already ended the game (to prevent double-ending)
  const gameEndedRef = useRef(false);

  // --------------------------------------------------------
  // PRELOAD DICTIONARY - Load word list before user can submit
  // --------------------------------------------------------

  useEffect(() => {
    // Preload the dictionary immediately when game screen mounts
    // This prevents a 3-second freeze on first word submission
    preloadDictionary();
  }, []);

  // --------------------------------------------------------
  // INITIALIZE GAME - Set up letters when screen loads
  // --------------------------------------------------------

  useEffect(() => {
    // In multiplayer mode, use the shared letters from Firebase
    // In practice mode, generate random letters locally
    const letters = isMultiplayer && sharedLetters
      ? sharedLetters
      : generateLetterPool(16);

    // Convert to our PoolLetter format with IDs
    const poolWithIds: PoolLetter[] = letters.map((letter: string, index: number) => ({
      id: `letter-${index}`,
      letter: letter,
      isUsed: false,
    }));

    setLetterPool(poolWithIds);
  }, [isMultiplayer, sharedLetters]);

  // --------------------------------------------------------
  // MULTIPLAYER SYNC - Subscribe to opponent's score updates
  // --------------------------------------------------------

  // Store game start time for synchronized timer
  const gameStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isMultiplayer || !gameRoomId || !playerId) return;

    // Subscribe to game room updates
    const cleanup = multiplayerService.joinGame(
      gameRoomId,
      playerId,
      (game: GameRoom) => {
        // Store game start time for timer sync
        if (game.startedAt && !gameStartTimeRef.current) {
          gameStartTimeRef.current = game.startedAt;
        }

        // Find the opponent's state (the player that isn't us)
        const isPlayer1 = game.player1?.odid === playerId;
        const opponent = isPlayer1 ? game.player2 : game.player1;
        if (opponent) {
          setOpponentState(opponent);
        }
      }
    );

    gameCleanupRef.current = cleanup;

    // Cleanup on unmount
    return () => {
      if (gameCleanupRef.current) {
        gameCleanupRef.current();
        gameCleanupRef.current = null;
      }
    };
  }, [isMultiplayer, gameRoomId, playerId]);

  // --------------------------------------------------------
  // TIMER - Count down every second (synchronized for multiplayer)
  // --------------------------------------------------------

  const GAME_DURATION = 60; // seconds

  useEffect(() => {
    if (!isGameActive) return;

    // Set up a timer that ticks every second
    const timer = setInterval(() => {
      if (isMultiplayer && gameStartTimeRef.current) {
        // Multiplayer: Calculate time based on server start time for sync
        const elapsed = Math.floor((Date.now() - gameStartTimeRef.current) / 1000);
        const remaining = Math.max(0, GAME_DURATION - elapsed);
        setTimeLeft(remaining);
      } else {
        // Practice mode: Simple countdown
        setTimeLeft((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    // Clean up the timer when component unmounts
    return () => clearInterval(timer);
  }, [isGameActive, isMultiplayer]);

  // Handle game end when timer reaches 0
  useEffect(() => {
    if (timeLeft > 0 || !isGameActive || gameEndedRef.current) return;

    // Time's up! End the game (only once)
    gameEndedRef.current = true;
    setIsGameActive(false);

    // Handle game end differently for multiplayer vs practice
    const handleGameEnd = async () => {
      if (isMultiplayer && gameRoomId) {
        // End the game in Firebase and get final results
        const finalGame = await multiplayerService.endGame(gameRoomId);

        // Clean up Firebase listener
        if (gameCleanupRef.current) {
          gameCleanupRef.current();
          gameCleanupRef.current = null;
        }

        // Use Firebase data for authoritative scores
        let finalOpponentScore = 0;
        let finalMyScore = totalScore;

        if (finalGame) {
          const isPlayer1 = finalGame.player1?.odid === playerId;
          const myState = isPlayer1 ? finalGame.player1 : finalGame.player2;
          const oppState = isPlayer1 ? finalGame.player2 : finalGame.player1;
          finalMyScore = myState?.score || totalScore;
          finalOpponentScore = oppState?.score || 0;
        }

        const didWin = finalMyScore > finalOpponentScore;
        const isTie = finalMyScore === finalOpponentScore;
        // Prize is the opponent's bet (your profit from winning)
        const prizeWon = didWin ? betAmount : 0;

        // Navigate to results
        setTimeout(() => {
          navigation.replace('Results', {
            score: finalMyScore,
            words: submittedWords,
            betAmount,
            isPractice: false,
            playerId,
            opponentScore: finalOpponentScore,
            opponentName,
            didWin: isTie ? null : didWin,
            prizeWon: isTie ? null : prizeWon,
          });
        }, 1500);
      } else {
        // Practice mode - simple navigation
        setTimeout(() => {
          navigation.replace('Results', {
            score: totalScore,
            words: submittedWords,
            betAmount,
            isPractice: true,
          });
        }, 1500);
      }
    };

    handleGameEnd();
  }, [timeLeft, isGameActive, isMultiplayer, gameRoomId, playerId, totalScore, submittedWords, betAmount, opponentName, navigation]);

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
  const handleSubmit = useCallback(async () => {
    const t0 = Date.now();
    console.log('[TIMING] handleSubmit START');

    // Need at least 3 letters
    if (currentWordLetters.length < 3) {
      setFeedback('Need 3+ letters');
      Vibration.vibrate(100); // Short vibration for feedback
      return;
    }

    // Build the word string
    const word = currentWordLetters.map((l) => l.letter).join('');
    console.log('[TIMING] Word built:', Date.now() - t0, 'ms');

    // Check if already submitted (client-side quick check)
    if (submittedWords.some((w) => w.word === word)) {
      setFeedback('Already used!');
      Vibration.vibrate(100);
      return;
    }
    console.log('[TIMING] Duplicate check:', Date.now() - t0, 'ms');

    // MULTIPLAYER: Server validates everything (anti-cheat)
    if (isMultiplayer && gameRoomId && playerId) {
      console.log('[TIMING] Submitting to server for validation');

      // Call server-side validation
      const result = await multiplayerService.submitWord(gameRoomId, playerId, word);
      console.log('[TIMING] Server response:', Date.now() - t0, 'ms');

      if (!result.success) {
        // Server rejected the word
        setFeedback(result.error || 'Invalid word');
        Vibration.vibrate(100);
        return;
      }

      // Server accepted - use server's score
      const wordScore = result.score || 0;
      setSubmittedWords((prev) => [...prev, { word, score: wordScore }]);
      setTotalScore((prev) => prev + wordScore);
      setFeedback(`+${wordScore} points!`);
      console.log('[TIMING] handleSubmit END (multiplayer):', Date.now() - t0, 'ms');
    } else {
      // PRACTICE MODE: Client-side validation only
      const validStart = Date.now();
      const isValid = isValidWord(word);
      console.log('[TIMING] isValidWord took:', Date.now() - validStart, 'ms');
      if (!isValid) {
        setFeedback('Not a word');
        Vibration.vibrate(100);
        return;
      }
      console.log('[TIMING] After validation:', Date.now() - t0, 'ms');

      // Calculate the score for this word
      const wordScore = calculateScore(word);
      console.log('[TIMING] Score calculated:', Date.now() - t0, 'ms');

      // Add to submitted words
      setSubmittedWords((prev) => [...prev, { word, score: wordScore }]);

      // Update total score
      setTotalScore((prev) => prev + wordScore);
      console.log('[TIMING] State updated:', Date.now() - t0, 'ms');

      // Show success feedback
      setFeedback(`+${wordScore} points!`);
      console.log('[TIMING] handleSubmit END (practice):', Date.now() - t0, 'ms');
    }

    // Get the IDs of letters that were used in this word
    const usedLetterIds = currentWordLetters.map((l) => l.id);

    if (isMultiplayer) {
      // MULTIPLAYER: Keep the board static (don't replace letters)
      // This ensures both players always see the same letters throughout the game.
      // Used letters are "returned" to the pool and can be reused for other words.
      setLetterPool((prev) =>
        prev.map((poolLetter) => ({
          ...poolLetter,
          isUsed: false, // All letters available again
        }))
      );
    } else {
      // PRACTICE MODE: Replace used letters with new random ones
      // This keeps the game interesting for solo practice
      const newLetters = generateRandomLetters(usedLetterIds.length);

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
              isUsed: false,
            };
          }
          return poolLetter;
        })
      );
    }

    // Clear the current word selection
    setCurrentWordLetters([]);

    // Pleasant vibration for success
    Vibration.vibrate([0, 50, 30, 50]);
  }, [currentWordLetters, submittedWords, isMultiplayer, gameRoomId, playerId]);

  // --------------------------------------------------------
  // QUIT GAME
  // --------------------------------------------------------

  const handleQuit = useCallback(() => {
    if (isMultiplayer) {
      // Multiplayer: Warn about forfeiting wager
      Alert.alert(
        'Forfeit Match?',
        `If you quit now, you will forfeit your ${betAmount} SOL wager and your opponent will win.`,
        [
          {
            text: 'Keep Playing',
            style: 'cancel',
          },
          {
            text: 'Forfeit & Quit',
            style: 'destructive',
            onPress: async () => {
              // Call the forfeit function to update game state and trigger payout
              if (gameRoomId && playerId) {
                try {
                  await multiplayerService.forfeitGame(gameRoomId, playerId);
                  console.log('[Forfeit] Successfully forfeited game');
                } catch (err) {
                  console.error('[Forfeit] Error:', err);
                }
              }
              // Clean up Firebase listener
              if (gameCleanupRef.current) {
                gameCleanupRef.current();
                gameCleanupRef.current = null;
              }
              // Navigate back to home
              navigation.replace('Home');
            },
          },
        ]
      );
    } else {
      // Practice mode: Simple confirmation
      Alert.alert(
        'Quit Practice?',
        'Are you sure you want to end this practice game?',
        [
          {
            text: 'Keep Playing',
            style: 'cancel',
          },
          {
            text: 'Quit',
            onPress: () => {
              navigation.replace('Home');
            },
          },
        ]
      );
    }
  }, [isMultiplayer, betAmount, navigation, gameRoomId, playerId]);

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
      {/* Quit button in top-left corner */}
      <TouchableOpacity style={styles.quitButton} onPress={handleQuit}>
        <Text style={styles.quitButtonText}>✕</Text>
      </TouchableOpacity>

      {/* Top bar: Timer and Scores */}
      <View style={styles.topBar}>
        {/* Your Score */}
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreLabel}>You</Text>
          <Text style={styles.score}>{totalScore}</Text>
        </View>

        {/* Timer in the middle */}
        <View style={styles.timerContainer}>
          <Text style={styles.timerLabel}>Time</Text>
          <Text style={[styles.timer, timeLeft <= 10 && styles.timerUrgent]}>
            {formattedTime}
          </Text>
        </View>

        {/* Opponent's Score (only in multiplayer) */}
        {isMultiplayer ? (
          <View style={styles.scoreContainer}>
            <Text style={styles.opponentLabel}>{opponentName.slice(0, 8)}</Text>
            <Text style={styles.opponentScore}>{opponentState?.score || 0}</Text>
          </View>
        ) : (
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreLabel}>Best</Text>
            <Text style={styles.practiceScore}>-</Text>
          </View>
        )}
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

  // Quit button (top-right corner)
  quitButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(127, 29, 29, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  quitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
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
    minWidth: 80,
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
  opponentLabel: {
    color: '#9ca3af',
    fontSize: 14,
  },
  opponentScore: {
    color: '#ef4444',
    fontSize: 36,
    fontWeight: 'bold',
  },
  practiceScore: {
    color: '#6b7280',
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
