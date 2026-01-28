/**
 * Dictionary Utility
 *
 * Handles word validation - checking if a word is a real English word.
 * Uses a comprehensive dictionary of ~275,000 English words.
 */

// Import the comprehensive English word list
import words from 'an-array-of-english-words';

// ============================================================
// WORD SET
// ============================================================

/**
 * A Set of valid English words for O(1) lookup time.
 * Contains approximately 275,000 words including:
 * - Common words (the, and, is, etc.)
 * - Past tenses (paired, walked, jumped)
 * - Plurals (cats, dogs, houses)
 * - Proper English words of all kinds
 */
const VALID_WORDS: Set<string> = new Set(words);

// ============================================================
// PUBLIC FUNCTIONS
// ============================================================

/**
 * Checks if a word is valid (exists in the dictionary).
 *
 * @param word - The word to check (case-insensitive)
 * @returns true if the word is valid, false otherwise
 *
 * Example:
 *   isValidWord('HELLO') // returns true
 *   isValidWord('PAIRED') // returns true
 *   isValidWord('xyz123') // returns false
 */
export function isValidWord(word: string): boolean {
  // Convert to lowercase for comparison
  const lowercaseWord = word.toLowerCase();

  // Minimum 3 letters for game purposes
  if (lowercaseWord.length < 3) {
    return false;
  }

  // Check if it's in our dictionary
  return VALID_WORDS.has(lowercaseWord);
}

/**
 * Gets all valid words that can be formed from a set of letters.
 * Useful for testing or showing possible words after a game.
 *
 * @param letters - Available letters (can contain duplicates)
 * @returns Array of valid words that can be formed
 */
export function findPossibleWords(letters: string[]): string[] {
  const availableLetters = letters.map((l) => l.toLowerCase());
  const possibleWords: string[] = [];

  // Check each word in our dictionary
  VALID_WORDS.forEach((word) => {
    // Only check words that could fit (3+ letters, not longer than available)
    if (word.length >= 3 && word.length <= availableLetters.length) {
      if (canFormWord(word, [...availableLetters])) {
        possibleWords.push(word);
      }
    }
  });

  // Sort by length (longest first) then alphabetically
  return possibleWords.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.localeCompare(b);
  });
}

/**
 * Helper: Checks if a word can be formed from available letters.
 *
 * @param word - The word to check
 * @param available - Available letters (will be modified)
 * @returns true if the word can be formed
 */
function canFormWord(word: string, available: string[]): boolean {
  for (const char of word) {
    const index = available.indexOf(char);
    if (index === -1) {
      return false;
    }
    // Remove the used letter
    available.splice(index, 1);
  }
  return true;
}

/**
 * Gets the total number of words in the dictionary.
 * Useful for displaying stats.
 */
export function getDictionarySize(): number {
  return VALID_WORDS.size;
}
