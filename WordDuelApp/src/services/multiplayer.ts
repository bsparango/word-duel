/**
 * Multiplayer Service
 *
 * Handles all multiplayer functionality using Firebase Realtime Database:
 * - Matchmaking (finding opponents)
 * - Game state synchronization
 * - Real-time score updates
 * - Game lifecycle management
 */

import database from '@react-native-firebase/database';
import functions from '@react-native-firebase/functions';
import { generateLetterPoolFromSeed, generateGameSeed } from '../utils/gameLogic';

// ============================================================
// TYPES
// ============================================================

// Player state during a game
export interface PlayerState {
  odid: string;           // Wallet address (player identifier)
  displayName: string;    // Shortened wallet address or nickname
  score: number;          // Current score
  wordsFound: string[];   // List of words found
  isReady: boolean;       // Has player loaded the game?
  lastActivity: number;   // Timestamp of last action (for disconnect detection)
}

// Escrow deposit tracking
export interface EscrowDeposit {
  txSignature: string;      // Solana transaction signature
  amount: number;           // Amount in lamports
  currency: 'SOL';          // Always SOL (USDC removed for simplicity)
  confirmedAt: number;      // Timestamp when confirmed
}

// Escrow state for a game
export interface EscrowState {
  player1Deposit?: EscrowDeposit;
  player2Deposit?: EscrowDeposit;
  status: 'pending_deposits' | 'locked' | 'paid_out' | 'refunded';
  payoutTx?: string;        // Payout transaction signature
  refundTx?: string;        // Refund transaction (for ties/cancellations)
  payoutError?: string;     // Error message if payout failed
}

// Game room structure in Firebase
export interface GameRoom {
  id: string;
  status: 'waiting' | 'ready' | 'playing' | 'finished' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  seed: string;             // Shared seed for letter generation
  letters: string[];        // The letter pool (generated from seed)
  betAmount: number;        // Amount bet by each player (always 0.01)
  betCurrency: 'SOL';       // Always SOL (USDC removed for simplicity)
  player1: PlayerState;
  player2?: PlayerState;
  winner?: string;          // Player ID of winner
  forfeitedBy?: string;     // Player ID who forfeited (if any)
  escrow?: EscrowState;     // Escrow tracking (deposits and payouts)
}

// Matchmaking queue entry
export interface QueueEntry {
  odid: string;
  displayName: string;
  betAmount: number;
  betCurrency: 'SOL';       // Always SOL
  joinedAt: number;
}

// Callback types
export type GameUpdateCallback = (game: GameRoom) => void;
export type MatchFoundCallback = (gameId: string) => void;

// ============================================================
// MULTIPLAYER SERVICE CLASS
// ============================================================

class MultiplayerService {
  private currentGameId: string | null = null;
  private currentPlayerId: string | null = null;
  private gameListener: (() => void) | null = null;
  private queueListener: (() => void) | null = null;

  // --------------------------------------------------------
  // MATCHMAKING
  // --------------------------------------------------------

  /**
   * Join the matchmaking queue to find an opponent.
   * If another player is waiting with the same bet amount and currency, creates a game.
   * Otherwise, waits in the queue until an opponent joins.
   *
   * @param playerId - The player's wallet address
   * @param betAmount - The amount to bet
   * @param betCurrency - The currency to use (SOL or USDC)
   * @param onMatchFound - Callback when a match is found
   * @returns Cleanup function to leave the queue
   */
  async joinQueue(
    playerId: string,
    betAmount: number = 0.01,
    onMatchFound: MatchFoundCallback
  ): Promise<() => void> {
    const displayName = this.shortenAddress(playerId);
    const queueRef = database().ref('matchmaking/queue');

    console.log('[Matchmaking] Player joining queue:', playerId, 'bet:', betAmount, 'SOL');

    // Check if there's a player waiting with the same bet amount
    const snapshot = await queueRef
      .orderByChild('betAmount')
      .equalTo(betAmount)
      .once('value');

    console.log('[Matchmaking] Queue check - exists:', snapshot.exists());

    if (snapshot.exists()) {
      const entries = snapshot.val();
      console.log('[Matchmaking] Found entries in queue:', JSON.stringify(entries));

      // Find an opponent (not ourselves)
      for (const [opponentKey, entry] of Object.entries(entries)) {
        const opponent = entry as QueueEntry;

        // Skip if it's ourselves
        if (opponent.odid === playerId) {
          console.log('[Matchmaking] Found self in queue, skipping');
          continue;
        }

        // Found a valid match!
        console.log('[Matchmaking] MATCH FOUND! Creating game...');

        // Remove opponent from queue
        await queueRef.child(opponentKey).remove();

        // Create a new game room
        const gameId = await this.createGameRoom(opponent, {
          odid: playerId,
          displayName,
          betAmount,
          betCurrency: 'SOL',
          joinedAt: Date.now(),
        });

        console.log('[Matchmaking] Game created:', gameId);
        onMatchFound(gameId);
        return () => {}; // No cleanup needed - game already created
      }

      console.log('[Matchmaking] No matching opponent found');
    }

    // No opponent found - add to queue and wait
    console.log('[Matchmaking] No opponent found, adding to queue...');
    const myQueueRef = queueRef.push();
    const queueEntry: QueueEntry = {
      odid: playerId,
      displayName,
      betAmount,
      betCurrency: 'SOL',
      joinedAt: Date.now(),
    };

    await myQueueRef.set(queueEntry);
    console.log('[Matchmaking] Added to queue, waiting for opponent...');

    // Listen for someone to create a game with us
    // When we're waiting in queue, we become player1 when matched
    const gamesRef = database().ref('games');
    const queryRef = gamesRef
      .orderByChild('player1/odid')
      .equalTo(playerId)
      .limitToLast(1);

    console.log('[Matchmaking] Setting up listener for games where player1 =', playerId);

    const listener = (snapshot: any) => {
      console.log('[Matchmaking] Game listener triggered!');
      const game = snapshot.val() as GameRoom;
      console.log('[Matchmaking] Game data:', JSON.stringify(game));
      if (game && game.status === 'waiting') {
        // We were added to a game as player1!
        console.log('[Matchmaking] Match found via listener! Game:', snapshot.key);
        myQueueRef.remove(); // Leave the queue
        onMatchFound(snapshot.key!);
      }
    };

    queryRef.on('child_added', listener);

    // Store cleanup function
    this.queueListener = () => queryRef.off('child_added', listener);

    // Return cleanup function
    return () => {
      myQueueRef.remove();
      if (this.queueListener) {
        this.queueListener();
        this.queueListener = null;
      }
    };
  }

  /**
   * Leave the matchmaking queue without finding a match.
   */
  async leaveQueue(playerId: string): Promise<void> {
    const queueRef = database().ref('matchmaking/queue');
    const snapshot = await queueRef
      .orderByChild('odid')
      .equalTo(playerId)
      .once('value');

    if (snapshot.exists()) {
      const entries = snapshot.val();
      for (const key of Object.keys(entries)) {
        await queueRef.child(key).remove();
      }
    }
  }

  // --------------------------------------------------------
  // GAME ROOM MANAGEMENT
  // --------------------------------------------------------

  /**
   * Create a new game room with two players.
   */
  private async createGameRoom(
    player1Entry: QueueEntry,
    player2Entry: QueueEntry
  ): Promise<string> {
    const gameRef = database().ref('games').push();
    const gameId = gameRef.key!;
    const seed = generateGameSeed();
    const letters = generateLetterPoolFromSeed(seed, 16);

    const gameRoom: GameRoom = {
      id: gameId,
      status: 'waiting',
      createdAt: Date.now(),
      seed,
      letters,
      betAmount: player1Entry.betAmount,
      betCurrency: player1Entry.betCurrency || 'SOL',
      player1: {
        odid: player1Entry.odid,
        displayName: player1Entry.displayName,
        score: 0,
        wordsFound: [],
        isReady: false,
        lastActivity: Date.now(),
      },
      player2: {
        odid: player2Entry.odid,
        displayName: player2Entry.displayName,
        score: 0,
        wordsFound: [],
        isReady: false,
        lastActivity: Date.now(),
      },
      escrow: {
        status: 'pending_deposits',
      },
    };

    await gameRef.set(gameRoom);
    return gameId;
  }

  /**
   * Join an existing game room and start listening for updates.
   *
   * @param gameId - The game room ID
   * @param playerId - The player's wallet address
   * @param onGameUpdate - Callback for game state changes
   * @returns Cleanup function
   */
  joinGame(
    gameId: string,
    playerId: string,
    onGameUpdate: GameUpdateCallback
  ): () => void {
    this.currentGameId = gameId;
    this.currentPlayerId = playerId;

    const gameRef = database().ref(`games/${gameId}`);

    // Listen for game updates
    const listener = gameRef.on('value', (snapshot) => {
      if (snapshot.exists()) {
        const game = snapshot.val() as GameRoom;
        game.id = gameId; // Ensure ID is set
        onGameUpdate(game);
      }
    });

    this.gameListener = () => gameRef.off('value', listener);

    return () => {
      if (this.gameListener) {
        this.gameListener();
        this.gameListener = null;
      }
      this.currentGameId = null;
      this.currentPlayerId = null;
    };
  }

  /**
   * Signal that the player is ready to start.
   * Game only starts when both players are ready AND both deposits are locked.
   */
  async setPlayerReady(gameId: string, playerId: string): Promise<void> {
    const gameRef = database().ref(`games/${gameId}`);
    const snapshot = await gameRef.once('value');

    if (!snapshot.exists()) return;

    const game = snapshot.val() as GameRoom;
    const playerKey = game.player1.odid === playerId ? 'player1' : 'player2';

    await gameRef.child(`${playerKey}/isReady`).set(true);
    await gameRef.child(`${playerKey}/lastActivity`).set(Date.now());

    // Check if both players are ready
    const updatedSnapshot = await gameRef.once('value');
    const updatedGame = updatedSnapshot.val() as GameRoom;

    if (updatedGame.player1.isReady && updatedGame.player2?.isReady) {
      // SECURITY: Only start game if escrow is locked (both deposits confirmed)
      if (updatedGame.escrow?.status !== 'locked') {
        console.log('[setPlayerReady] Both ready but escrow not locked, waiting for deposits');
        return;
      }

      // Both ready AND both deposited - start the game!
      await gameRef.update({
        status: 'playing',
        startedAt: Date.now(),
      });
    }
  }

  // --------------------------------------------------------
  // GAME ACTIONS
  // --------------------------------------------------------

  /**
   * Submit a word for validation and scoring.
   * Calls server-side Cloud Function which validates:
   * - Word can be formed from game's letter pool
   * - Word is a valid English word
   * - Word hasn't already been submitted
   * - Score calculated server-side (anti-cheat)
   *
   * @param gameId - The game room ID
   * @param playerId - The player's wallet address
   * @param word - The word to submit
   * @returns Object with success status and score (if successful)
   */
  async submitWord(
    gameId: string,
    playerId: string,
    word: string
  ): Promise<{ success: boolean; score?: number; error?: string }> {
    const t0 = Date.now();
    console.log('[submitWord] Submitting to server:', word);

    try {
      // Call server-side validation function
      const submitWordFn = functions().httpsCallable('submitWord');
      const result = await submitWordFn({
        gameId,
        playerId,
        word: word.toUpperCase(),
      });

      const data = result.data as { success: boolean; score?: number; error?: string };

      console.log('[submitWord] Server response:', data, 'Time:', Date.now() - t0, 'ms');

      if (data.success) {
        return { success: true, score: data.score };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error: any) {
      console.error('[submitWord] Failed:', error);
      return { success: false, error: error.message || 'Failed to submit word' };
    }
  }

  /**
   * Forfeit a game - the forfeiting player loses, opponent wins.
   * This updates the game state and triggers the payout via Firebase function.
   */
  async forfeitGame(gameId: string, forfeitingPlayerId: string): Promise<void> {
    const gameRef = database().ref(`games/${gameId}`);
    const snapshot = await gameRef.once('value');

    if (!snapshot.exists()) {
      console.log('[Forfeit] Game not found:', gameId);
      return;
    }

    const game = snapshot.val() as GameRoom;

    // Determine the winner (the player who didn't forfeit)
    let winner: string;
    if (game.player1.odid === forfeitingPlayerId) {
      winner = game.player2?.odid || '';
    } else {
      winner = game.player1.odid;
    }

    console.log('[Forfeit] Player', forfeitingPlayerId, 'forfeiting, winner:', winner);

    // Update game status
    await gameRef.update({
      status: 'finished',
      endedAt: Date.now(),
      winner,
      forfeitedBy: forfeitingPlayerId,
    });

    console.log('[Forfeit] Game updated, payout should be triggered automatically');
  }

  /**
   * End the game and determine the winner.
   */
  async endGame(gameId: string): Promise<GameRoom | null> {
    const gameRef = database().ref(`games/${gameId}`);
    const snapshot = await gameRef.once('value');

    if (!snapshot.exists()) return null;

    const game = snapshot.val() as GameRoom;

    // Determine winner
    let winner: string | undefined;
    if (game.player2) {
      if (game.player1.score > game.player2.score) {
        winner = game.player1.odid;
      } else if (game.player2.score > game.player1.score) {
        winner = game.player2.odid;
      }
      // If scores are equal, winner is undefined (tie)
    }

    // Update game status
    await gameRef.update({
      status: 'finished',
      endedAt: Date.now(),
      winner,
    });

    // Return final game state
    const finalSnapshot = await gameRef.once('value');
    return { ...finalSnapshot.val(), id: gameId } as GameRoom;
  }

  /**
   * Get the current game state.
   */
  async getGame(gameId: string): Promise<GameRoom | null> {
    const snapshot = await database().ref(`games/${gameId}`).once('value');
    if (!snapshot.exists()) return null;
    return { ...snapshot.val(), id: gameId } as GameRoom;
  }

  // --------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------

  /**
   * Shorten a wallet address for display.
   * Example: "7xKXtg2C..." instead of full address
   */
  private shortenAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  /**
   * Get the current game ID (if in a game).
   */
  getCurrentGameId(): string | null {
    return this.currentGameId;
  }

  /**
   * Get the current player ID (if in a game).
   */
  getCurrentPlayerId(): string | null {
    return this.currentPlayerId;
  }

  /**
   * Clean up old/abandoned games (call periodically).
   */
  async cleanupOldGames(): Promise<void> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const gamesRef = database().ref('games');

    const snapshot = await gamesRef
      .orderByChild('createdAt')
      .endAt(oneHourAgo)
      .once('value');

    if (snapshot.exists()) {
      const updates: { [key: string]: null } = {};
      snapshot.forEach((child) => {
        const game = child.val() as GameRoom;
        if (game.status !== 'finished') {
          updates[child.key!] = null;
        }
        return undefined; // Continue iteration
      });

      if (Object.keys(updates).length > 0) {
        await gamesRef.update(updates);
      }
    }
  }
}

// Export a singleton instance
export const multiplayerService = new MultiplayerService();
