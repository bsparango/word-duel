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
  amount: number;           // Amount in lamports (SOL) or smallest units (USDC)
  currency: 'SOL' | 'USDC';
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
  betAmount: number;        // Amount bet by each player
  betCurrency: 'SOL' | 'USDC'; // Currency used for betting
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
  betCurrency: 'SOL' | 'USDC';
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
    betAmount: number,
    betCurrency: 'SOL' | 'USDC' = 'SOL',
    onMatchFound: MatchFoundCallback
  ): Promise<() => void> {
    const displayName = this.shortenAddress(playerId);
    const queueRef = database().ref('matchmaking/queue');

    console.log('[Matchmaking] Player joining queue:', playerId, 'bet:', betAmount, betCurrency);

    // First, check if there's already a player waiting with the same bet amount
    const snapshot = await queueRef
      .orderByChild('betAmount')
      .equalTo(betAmount)
      .limitToFirst(1)
      .once('value');

    console.log('[Matchmaking] Queue check - exists:', snapshot.exists());

    if (snapshot.exists()) {
      // Found a waiting player - create a game!
      const entries = snapshot.val();
      console.log('[Matchmaking] Found entries in queue:', JSON.stringify(entries));
      const opponentKey = Object.keys(entries)[0];
      const opponent = entries[opponentKey] as QueueEntry;

      console.log('[Matchmaking] Potential opponent:', opponent.odid);

      // Don't match with yourself
      if (opponent.odid !== playerId) {
        console.log('[Matchmaking] MATCH FOUND! Creating game...');
        // Remove opponent from queue
        await queueRef.child(opponentKey).remove();

        // Create a new game room
        const gameId = await this.createGameRoom(opponent, {
          odid: playerId,
          displayName,
          betAmount,
          betCurrency,
          joinedAt: Date.now(),
        });

        console.log('[Matchmaking] Game created:', gameId);
        onMatchFound(gameId);
        return () => {}; // No cleanup needed - game already created
      } else {
        console.log('[Matchmaking] Found self in queue, ignoring');
      }
    }

    // No opponent found - add to queue and wait
    console.log('[Matchmaking] No opponent found, adding to queue...');
    const myQueueRef = queueRef.push();
    const queueEntry: QueueEntry = {
      odid: playerId,
      displayName,
      betAmount,
      betCurrency,
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
      // Both ready - start the game!
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
   * Submit a word and update the player's score.
   * Uses Firebase transactions to prevent race conditions when submitting
   * multiple words quickly.
   *
   * @param gameId - The game room ID
   * @param playerId - The player's wallet address
   * @param word - The word that was submitted
   * @param score - Points earned for this word
   */
  async submitWord(
    gameId: string,
    playerId: string,
    word: string,
    score: number
  ): Promise<void> {
    const t0 = Date.now();
    console.log('[TIMING] submitWord START');

    const gameRef = database().ref(`games/${gameId}`);

    // First, determine which player key to use
    const snapshot = await gameRef.once('value');
    if (!snapshot.exists()) {
      console.log('submitWord: Game not found:', gameId);
      return;
    }

    const game = snapshot.val() as GameRoom;
    const playerKey = game.player1?.odid === playerId ? 'player1' : 'player2';

    // Use a transaction to atomically update score and words
    // This prevents race conditions when submitting words quickly
    const playerRef = gameRef.child(playerKey);

    try {
      await playerRef.transaction((currentData) => {
        if (currentData === null) {
          // Player data doesn't exist yet (shouldn't happen in normal flow)
          return currentData;
        }

        // Atomically update the player's state
        return {
          ...currentData,
          score: (currentData.score || 0) + score,
          wordsFound: [...(currentData.wordsFound || []), word],
          lastActivity: Date.now(),
        };
      });

      console.log('[TIMING] submitWord END (transaction):', Date.now() - t0, 'ms');
    } catch (error) {
      console.error('[submitWord] Transaction failed:', error);
      // Transaction failed - the word submission was lost
      // In production, you might want to retry or notify the user
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
