/**
 * Test Player Simulator
 *
 * This script simulates a second player for testing multiplayer betting flows.
 * It watches for real players in the matchmaking queue and matches with them.
 *
 * Usage:
 *   npx ts-node src/test-player.ts [outcome]
 *
 * Outcomes:
 *   win    - Test player wins (real player loses)
 *   lose   - Test player loses (real player wins)
 *   tie    - Both players tie (both get refunded)
 *   forfeit - Game stays active so real player can forfeit (test player wins by forfeit)
 *
 * Example:
 *   npx ts-node src/test-player.ts lose     # Real player wins
 *   npx ts-node src/test-player.ts forfeit  # Wait for real player to forfeit
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

// Initialize Firebase Admin
// Try service account first, then fall back to application default credentials
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
const databaseURL = 'https://word-duel-8f176-default-rtdb.firebaseio.com';

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL,
  });
  console.log('✅ Using service account credentials\n');
} else {
  // Use application default credentials (requires `gcloud auth application-default login`)
  // Or use the database URL with no auth for development (if rules allow)
  admin.initializeApp({
    databaseURL,
  });
  console.log('⚠️  No service account found, using default credentials\n');
  console.log('   If this fails, download service-account.json from Firebase Console:');
  console.log('   Project Settings > Service Accounts > Generate New Private Key\n');
}

const db = admin.database();

// Test player configuration
const TEST_PLAYER = {
  odid: 'TEST_PLAYER_' + Date.now(), // Unique test player ID
  displayName: 'TestBot',
  // Use a real devnet address for payout testing (this is just a random valid address)
  walletAddress: '11111111111111111111111111111111', // System program (won't actually receive)
};

// Get outcome from command line args
const outcome = process.argv[2] || 'lose'; // Default: real player wins
console.log(`\n🎮 Test Player Simulator`);
console.log(`   Outcome mode: ${outcome}`);
if (outcome === 'forfeit') {
  console.log(`   (waiting for real player to FORFEIT - test player will receive payout)\n`);
} else {
  console.log(`   (real player will ${outcome === 'lose' ? 'WIN' : outcome === 'win' ? 'LOSE' : 'TIE'})\n`);
}

/**
 * Letter frequencies based on English language usage (same as app)
 */
const LETTER_FREQUENCIES: { [key: string]: number } = {
  A: 9, E: 12, I: 9, O: 8, U: 4,
  N: 6, R: 6, T: 6, L: 4, S: 4, D: 4,
  G: 3, B: 2, C: 2, M: 2, P: 2, F: 2, H: 2, V: 2, W: 2, Y: 2,
  K: 1, J: 1, X: 1, Q: 1, Z: 1,
};

/**
 * Creates a weighted letter bag (same as app)
 */
function createLetterBag(): string[] {
  const bag: string[] = [];
  for (const [letter, count] of Object.entries(LETTER_FREQUENCIES)) {
    for (let i = 0; i < count; i++) {
      bag.push(letter);
    }
  }
  return bag;
}

/**
 * Generate letters from a seed (same algorithm as app)
 */
function generateLettersFromSeed(seed: string, count: number = 16): string[] {
  // Simple seeded random number generator
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash = hash & hash;
  }

  const seededRandom = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };

  // Create letter bag and shuffle with seeded random
  const bag = createLetterBag();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }

  return bag.slice(0, count);
}

/**
 * Generate a game seed
 */
function generateGameSeed(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let seed = '';
  for (let i = 0; i < 8; i++) {
    seed += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return seed;
}

/**
 * Watch for players in the matchmaking queue and match with them
 */
async function watchForPlayers() {
  console.log('👀 Watching matchmaking queue for players...\n');

  const queueRef = db.ref('matchmaking/queue');

  queueRef.on('child_added', async (snapshot) => {
    const entry = snapshot.val();
    const queueKey = snapshot.key; // This is the Firebase push ID, not the player's ODID
    const playerOdid = entry.odid;

    // Don't match with ourselves
    if (playerOdid?.startsWith('TEST_PLAYER')) {
      return;
    }

    console.log(`\n🎯 Found player in queue: ${playerOdid}`);
    console.log(`   Queue key: ${queueKey}`);
    console.log(`   Bet: ${entry.betAmount} ${entry.betCurrency}`);

    // Create a match!
    await createMatch(playerOdid, queueKey!, entry);
  });
}

/**
 * Create a match between the real player and test player
 */
async function createMatch(realPlayerOdid: string, queueKey: string, queueEntry: any) {
  // Generate seed and letters (same as real app)
  const seed = generateGameSeed();
  const letters = generateLettersFromSeed(seed, 16);

  // Use Firebase push() to create game with proper ID (like the real app does)
  const gameRef = db.ref('games').push();
  const gameId = gameRef.key!;

  console.log(`\n🎲 Creating game: ${gameId}`);
  console.log(`   Seed: ${seed}`);
  console.log(`   Letters (${letters.length}): ${letters.join(' ')}`);

  // Create the game room - real player is player1 (waiting in queue)
  // Test player is player2 (joining the match)
  const gameData = {
    id: gameId,
    seed: 'TEST_SEED_' + Date.now(),
    letters,
    status: 'waiting',
    betAmount: queueEntry.betAmount,
    betCurrency: queueEntry.betCurrency || 'SOL',
    createdAt: Date.now(),
    player1: {
      odid: realPlayerOdid,
      displayName: queueEntry.displayName || 'Player 1',
      score: 0,
      wordsFound: [],
      isReady: false,
      lastActivity: Date.now(),
    },
    player2: {
      odid: TEST_PLAYER.odid,
      displayName: TEST_PLAYER.displayName,
      score: 0,
      wordsFound: [],
      isReady: false,
      lastActivity: Date.now(),
    },
    escrow: {
      status: 'pending_deposits',
      // Simulate test player's deposit (pretend it's verified)
      player2Deposit: {
        txSignature: 'TEST_DEPOSIT_' + Date.now(),
        amount: Math.round(queueEntry.betAmount * 1e9), // Convert to lamports
        currency: queueEntry.betCurrency || 'SOL',
        confirmedAt: Date.now(),
      },
    },
  };

  // Write the game using set() on the pushed reference
  await gameRef.set(gameData);

  console.log(`✅ Game created with ID: ${gameId}`);
  console.log(`   Real player (${realPlayerOdid}) is player1`);
  console.log(`   The app should detect this game via its listener...`);

  // Remove from queue after game is created
  // (The app's listener should pick up the game and remove the queue entry itself,
  // but we'll also remove it after a delay as backup)
  setTimeout(async () => {
    try {
      await db.ref(`matchmaking/queue/${queueKey}`).remove();
      console.log(`   Removed queue entry: ${queueKey}`);
    } catch (e) {
      // Already removed by the app
    }
  }, 3000);

  // Watch for game state changes
  watchGameState(gameId, realPlayerOdid);
}

/**
 * Watch the game state and respond to changes
 */
function watchGameState(gameId: string, realPlayerOdid: string) {
  const gameRef = db.ref(`games/${gameId}`);
  let gameStartScheduled = false;

  gameRef.on('value', async (snapshot) => {
    const game = snapshot.val();
    if (!game) return;

    console.log(`   [Game state] status=${game.status}, p1Ready=${game.player1?.isReady}, p2Ready=${game.player2?.isReady}`);

    // When real player is ready, mark test player as ready too
    if (game.player1?.isReady && !game.player2?.isReady) {
      console.log(`\n👍 Real player is ready, marking test player ready...`);
      await gameRef.child('player2/isReady').set(true);
      await gameRef.child('player2/lastActivity').set(Date.now());
    }

    // When both ready and still waiting, start the game
    if (game.player1?.isReady && game.player2?.isReady && game.status === 'waiting' && !gameStartScheduled) {
      gameStartScheduled = true;
      console.log(`\n🚀 Both players ready! Starting game...`);
      await gameRef.update({
        status: 'playing',
        startedAt: Date.now(),
      });

      // Also mark escrow as locked (simulating both deposits verified)
      await gameRef.child('escrow/status').set('locked');

      if (outcome === 'forfeit') {
        // In forfeit mode, keep test player active and wait for real player to forfeit
        console.log(`\n⏳ Forfeit mode: Game is now active!`);
        console.log(`   Test player is staying in the game.`);
        console.log(`   Forfeit from your app now - test player will receive the payout.\n`);

        // Keep sending activity updates so test player looks active
        const activityInterval = setInterval(async () => {
          const currentGame = (await gameRef.once('value')).val();
          if (currentGame?.status === 'finished' || currentGame?.status === 'forfeited') {
            clearInterval(activityInterval);
            console.log(`\n✅ Game ended! Status: ${currentGame.status}`);
            if (currentGame.winner) {
              console.log(`   Winner: ${currentGame.winner}`);
            }
            console.log(`\n👋 Test complete! Press Ctrl+C to exit.\n`);
          } else {
            await gameRef.child('player2/lastActivity').set(Date.now());
          }
        }, 2000);
      } else {
        // End game immediately for testing (no race condition with app timer)
        console.log(`   Ending game immediately for testing...`);
        setTimeout(() => endGame(gameId, realPlayerOdid), 500); // End after 0.5 seconds
      }
    }
  });
}

/**
 * End the game with the specified outcome
 */
async function endGame(gameId: string, realPlayerOdid: string) {
  const gameRef = db.ref(`games/${gameId}`);
  const gameSnapshot = await gameRef.once('value');
  const game = gameSnapshot.val();

  if (!game || game.status === 'finished') return;

  console.log(`\n⏱️  Ending game with outcome: ${outcome}`);

  let player1Score: number;
  let player2Score: number;
  let winner: string | null;

  switch (outcome) {
    case 'win':
      // Test player wins
      player1Score = 50;
      player2Score = 100;
      winner = TEST_PLAYER.odid;
      console.log(`   Test player wins (100 vs 50)`);
      break;
    case 'tie':
      // Tie game
      player1Score = 75;
      player2Score = 75;
      winner = null;
      console.log(`   Tie game (75 vs 75)`);
      break;
    case 'lose':
    default:
      // Real player wins
      player1Score = 100;
      player2Score = 50;
      winner = realPlayerOdid;
      console.log(`   Real player wins (100 vs 50)`);
      break;
  }

  // Update game with final scores
  await gameRef.update({
    status: 'finished',
    endedAt: Date.now(),
    winner,
    'player1/score': player1Score,
    'player1/words': ['TEST', 'WORD'],
    'player2/score': player2Score,
    'player2/words': ['BOT', 'PLAY'],
  });

  console.log(`\n✅ Game finished!`);
  console.log(`   Player 1 (real): ${player1Score} points`);
  console.log(`   Player 2 (test): ${player2Score} points`);
  console.log(`   Winner: ${winner || 'TIE'}`);

  if (winner === realPlayerOdid) {
    console.log(`\n💰 The processGamePayout function should now send winnings to the real player's wallet.`);
    console.log(`   Check the Firebase Functions logs and Solana Explorer to verify.`);
  } else if (winner === null) {
    console.log(`\n💰 The processGamePayout function should refund both players.`);
    console.log(`   (Note: Test player refund will fail since it's a fake address)`);
  } else {
    console.log(`\n💰 Test player "won" but has a fake address, so payout will fail.`);
    console.log(`   This is expected for testing - use 'lose' mode to test real payouts.`);
  }

  console.log(`\n👋 Test complete! Press Ctrl+C to exit.\n`);
}

// Start watching
watchForPlayers();

console.log('Press Ctrl+C to stop the test player.\n');
