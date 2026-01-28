/**
 * Game Logic Utilities
 *
 * This file contains the core game mechanics:
 * - Generating random letter pools
 * - Calculating word scores
 * - Other game-related calculations
 */

// ============================================================
// LETTER DISTRIBUTION
// ============================================================

/**
 * Letter frequencies based on English language usage.
 * More common letters appear more often in the pool.
 *
 * This is similar to Scrabble's letter distribution, but adjusted
 * for a faster-paced game where we want more vowels available.
 */
const LETTER_FREQUENCIES: { [key: string]: number } = {
  // Vowels - more common (players need these!)
  A: 9,
  E: 12,
  I: 9,
  O: 8,
  U: 4,

  // Common consonants
  N: 6,
  R: 6,
  T: 6,
  L: 4,
  S: 4,
  D: 4,

  // Medium frequency consonants
  G: 3,
  B: 2,
  C: 2,
  M: 2,
  P: 2,
  F: 2,
  H: 2,
  V: 2,
  W: 2,
  Y: 2,

  // Less common consonants
  K: 1,
  J: 1,
  X: 1,
  Q: 1,
  Z: 1,
};

/**
 * Creates a "bag" of letters weighted by frequency.
 * Think of this like a Scrabble bag where common letters appear multiple times.
 */
function createLetterBag(): string[] {
  const bag: string[] = [];

  for (const [letter, count] of Object.entries(LETTER_FREQUENCIES)) {
    // Add each letter to the bag 'count' times
    for (let i = 0; i < count; i++) {
      bag.push(letter);
    }
  }

  return bag;
}

/**
 * Shuffles an array randomly (Fisher-Yates algorithm).
 * This is like shuffling a deck of cards.
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]; // Make a copy so we don't modify the original

  for (let i = shuffled.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));
    // Swap elements at positions i and j
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

// ============================================================
// PUBLIC FUNCTIONS
// ============================================================

/**
 * Generates a pool of random letters for a game.
 *
 * @param count - How many letters to generate (default: 16 for a 4x4 grid)
 * @returns An array of random letters
 *
 * Example:
 *   generateLetterPool(16) might return:
 *   ['A', 'E', 'T', 'R', 'S', 'N', 'I', 'O', 'L', 'C', 'D', 'U', 'P', 'M', 'H', 'E']
 */
export function generateLetterPool(count: number = 16): string[] {
  // Create and shuffle the letter bag
  const bag = shuffleArray(createLetterBag());

  // Take the first 'count' letters
  const pool = bag.slice(0, count);

  // Ensure we have at least 2 vowels (for playability)
  const vowels = ['A', 'E', 'I', 'O', 'U'];
  const vowelCount = pool.filter((l) => vowels.includes(l)).length;

  if (vowelCount < 2) {
    // Replace some consonants with vowels
    const vowelsNeeded = 2 - vowelCount;
    let replaced = 0;

    for (let i = 0; i < pool.length && replaced < vowelsNeeded; i++) {
      if (!vowels.includes(pool[i])) {
        // Pick a random vowel
        pool[i] = vowels[Math.floor(Math.random() * vowels.length)];
        replaced++;
      }
    }
  }

  return pool;
}

/**
 * Calculates the score for a word based on its length.
 *
 * Scoring system:
 * - 3 letters = 3 points
 * - 4 letters = 5 points
 * - 5 letters = 8 points
 * - 6 letters = 12 points
 * - 7 letters = 17 points
 * - 8+ letters = 23+ points (keeps increasing)
 *
 * @param word - The word to score
 * @returns The point value of the word
 */
export function calculateScore(word: string): number {
  const length = word.length;

  // Minimum word length is 3
  if (length < 3) return 0;

  // Score lookup table
  const scoreTable: { [key: number]: number } = {
    3: 3,
    4: 5,
    5: 8,
    6: 12,
    7: 17,
    8: 23,
  };

  // For words 8 letters or longer, add 6 points per additional letter
  if (length > 8) {
    return 23 + (length - 8) * 6;
  }

  return scoreTable[length] || 0;
}

/**
 * Generates a seed for a game that can be shared between players.
 * Both players use the same seed to get the same letter pool.
 *
 * @returns A random seed string
 */
export function generateGameSeed(): string {
  // Generate a random 8-character string
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let seed = '';
  for (let i = 0; i < 8; i++) {
    seed += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return seed;
}

/**
 * Generates a letter pool from a seed (for multiplayer consistency).
 * Given the same seed, this always produces the same letters.
 *
 * @param seed - The game seed
 * @param count - How many letters to generate
 * @returns An array of letters
 */
export function generateLetterPoolFromSeed(
  seed: string,
  count: number = 16
): string[] {
  // Simple seeded random number generator
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Use the hash as a seed for pseudo-random generation
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
