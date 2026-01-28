/**
 * Dictionary Utility
 *
 * Handles word validation - checking if a word is a real English word.
 * Uses a comprehensive dictionary of ~275,000 English words.
 *
 * The dictionary is loaded asynchronously to prevent UI freezes.
 */

// Import the comprehensive English word list
import words from 'an-array-of-english-words';

// ============================================================
// WORD SET (Lazy loaded)
// ============================================================

/**
 * A Set of valid English words for O(1) lookup time.
 * Loaded asynchronously to prevent UI freezes.
 */
let VALID_WORDS: Set<string> | null = null;
let isLoading = false;
let loadPromise: Promise<void> | null = null;

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

  // If dictionary isn't loaded yet, load it synchronously (fallback)
  if (!VALID_WORDS) {
    console.log('[Dictionary] Loading synchronously (not preloaded)');
    VALID_WORDS = new Set(words);
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
  if (!VALID_WORDS) {
    console.log('[Dictionary] Not loaded yet for findPossibleWords');
    return [];
  }

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
  return VALID_WORDS?.size || 0;
}

/**
 * Pre-loads the dictionary into memory using InteractionManager.
 * Call this early (e.g., when app starts or matchmaking screen loads)
 * to avoid a freeze on the first word validation.
 *
 * The dictionary is loaded in chunks to prevent UI blocking.
 *
 * @returns Promise that resolves when dictionary is ready
 */
export function preloadDictionary(): Promise<number> {
  // If already loaded, return immediately
  if (VALID_WORDS) {
    return Promise.resolve(VALID_WORDS.size);
  }

  // If already loading, return the existing promise
  if (loadPromise) {
    return loadPromise.then(() => VALID_WORDS?.size || 0);
  }

  // Start loading
  isLoading = true;
  console.log('[Dictionary] Starting async preload...');

  loadPromise = new Promise((resolve) => {
    // Use requestAnimationFrame to defer loading until after render
    requestAnimationFrame(() => {
      // Load in batches to keep UI responsive
      const batchSize = 50000;
      const tempSet = new Set<string>();
      let index = 0;

      const loadBatch = () => {
        const end = Math.min(index + batchSize, words.length);
        for (let i = index; i < end; i++) {
          tempSet.add(words[i]);
        }
        index = end;

        if (index < words.length) {
          // More batches to load - schedule next batch
          setTimeout(loadBatch, 0);
        } else {
          // Done loading
          VALID_WORDS = tempSet;
          isLoading = false;
          console.log(`[Dictionary] Preloaded ${VALID_WORDS.size} words`);
          resolve();
        }
      };

      loadBatch();
    });
  });

  return loadPromise.then(() => VALID_WORDS?.size || 0);
}
