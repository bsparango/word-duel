/**
 * Multiplayer Hook
 *
 * React hook that provides easy access to multiplayer functionality.
 * Manages matchmaking state, game synchronization, and real-time updates.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  multiplayerService,
  GameRoom,
  PlayerState,
} from '../services/multiplayer';

// ============================================================
// TYPES
// ============================================================

export type MatchmakingStatus =
  | 'idle'           // Not searching
  | 'searching'      // Looking for opponent
  | 'found'          // Match found, loading game
  | 'ready'          // In game, waiting for both players ready
  | 'playing'        // Game in progress
  | 'finished';      // Game ended

export type BetCurrency = 'SOL' | 'USDC';

export interface UseMultiplayerResult {
  // State
  status: MatchmakingStatus;
  gameRoom: GameRoom | null;
  myPlayer: PlayerState | null;
  opponent: PlayerState | null;
  isHost: boolean;
  error: string | null;

  // Actions
  findMatch: (playerId: string, betAmount: number, betCurrency?: BetCurrency) => Promise<void>;
  cancelSearch: () => Promise<void>;
  setReady: () => Promise<void>;
  submitWord: (word: string, score: number) => Promise<void>;
  endGame: () => Promise<GameRoom | null>;
  leaveGame: () => void;
}

// ============================================================
// HOOK
// ============================================================

export function useMultiplayer(): UseMultiplayerResult {
  // State
  const [status, setStatus] = useState<MatchmakingStatus>('idle');
  const [gameRoom, setGameRoom] = useState<GameRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup functions
  const queueCleanupRef = useRef<(() => void) | null>(null);
  const gameCleanupRef = useRef<(() => void) | null>(null);
  const playerIdRef = useRef<string | null>(null);

  // --------------------------------------------------------
  // DERIVED STATE
  // --------------------------------------------------------

  // Determine if we're player1 (host) or player2
  const isHost = gameRoom?.player1?.odid === playerIdRef.current;

  // Get my player state
  const myPlayer = gameRoom
    ? isHost
      ? gameRoom.player1
      : gameRoom.player2 || null
    : null;

  // Get opponent's player state
  const opponent = gameRoom
    ? isHost
      ? gameRoom.player2 || null
      : gameRoom.player1
    : null;

  // --------------------------------------------------------
  // GAME STATE SYNC
  // --------------------------------------------------------

  // Handle game room updates from Firebase
  const handleGameUpdate = useCallback((game: GameRoom) => {
    setGameRoom(game);

    // Update status based on game state
    switch (game.status) {
      case 'waiting':
        setStatus('ready');
        break;
      case 'playing':
        setStatus('playing');
        break;
      case 'finished':
        setStatus('finished');
        break;
    }
  }, []);

  // --------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------

  /**
   * Start searching for an opponent.
   */
  const findMatch = useCallback(
    async (playerId: string, betAmount: number, betCurrency: BetCurrency = 'SOL') => {
      try {
        setError(null);
        setStatus('searching');
        playerIdRef.current = playerId;

        // Join the matchmaking queue
        const cleanup = await multiplayerService.joinQueue(
          playerId,
          betAmount,
          betCurrency,
          (gameId) => {
            // Match found! Join the game
            setStatus('found');

            // Small delay to show "found" status
            setTimeout(() => {
              const gameCleanup = multiplayerService.joinGame(
                gameId,
                playerId,
                handleGameUpdate
              );
              gameCleanupRef.current = gameCleanup;
            }, 500);
          }
        );

        queueCleanupRef.current = cleanup;
      } catch (err: any) {
        setError(err.message || 'Failed to find match');
        setStatus('idle');
      }
    },
    [handleGameUpdate]
  );

  /**
   * Cancel searching for an opponent.
   */
  const cancelSearch = useCallback(async () => {
    if (queueCleanupRef.current) {
      queueCleanupRef.current();
      queueCleanupRef.current = null;
    }

    if (playerIdRef.current) {
      await multiplayerService.leaveQueue(playerIdRef.current);
    }

    setStatus('idle');
    setError(null);
  }, []);

  /**
   * Signal that the player is ready to start.
   */
  const setReady = useCallback(async () => {
    if (!gameRoom || !playerIdRef.current) return;

    try {
      await multiplayerService.setPlayerReady(gameRoom.id, playerIdRef.current);
    } catch (err: any) {
      setError(err.message || 'Failed to set ready status');
    }
  }, [gameRoom]);

  /**
   * Submit a word during gameplay.
   */
  const submitWord = useCallback(
    async (word: string, score: number) => {
      if (!gameRoom || !playerIdRef.current) return;

      try {
        await multiplayerService.submitWord(
          gameRoom.id,
          playerIdRef.current,
          word,
          score
        );
      } catch (err: any) {
        console.error('Failed to submit word:', err);
      }
    },
    [gameRoom]
  );

  /**
   * End the game (called when timer runs out).
   */
  const endGame = useCallback(async (): Promise<GameRoom | null> => {
    if (!gameRoom) return null;

    try {
      return await multiplayerService.endGame(gameRoom.id);
    } catch (err: any) {
      setError(err.message || 'Failed to end game');
      return null;
    }
  }, [gameRoom]);

  /**
   * Leave the current game and reset state.
   */
  const leaveGame = useCallback(() => {
    if (gameCleanupRef.current) {
      gameCleanupRef.current();
      gameCleanupRef.current = null;
    }

    if (queueCleanupRef.current) {
      queueCleanupRef.current();
      queueCleanupRef.current = null;
    }

    setGameRoom(null);
    setStatus('idle');
    setError(null);
    playerIdRef.current = null;
  }, []);

  // --------------------------------------------------------
  // CLEANUP
  // --------------------------------------------------------

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (gameCleanupRef.current) {
        gameCleanupRef.current();
      }
      if (queueCleanupRef.current) {
        queueCleanupRef.current();
      }
    };
  }, []);

  // --------------------------------------------------------
  // RETURN
  // --------------------------------------------------------

  return {
    status,
    gameRoom,
    myPlayer,
    opponent,
    isHost,
    error,
    findMatch,
    cancelSearch,
    setReady,
    submitWord,
    endGame,
    leaveGame,
  };
}
