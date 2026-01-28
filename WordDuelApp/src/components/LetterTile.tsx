/**
 * Letter Tile Component
 *
 * A single letter tile that players tap to form words.
 * Looks like a Scrabble tile with the letter displayed.
 *
 * Props:
 * - letter: The letter to display (e.g., "A", "B", "C")
 * - isUsed: Whether this tile is currently being used in a word
 * - onPress: Function to call when the tile is tapped
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

interface LetterTileProps {
  letter: string;
  isUsed: boolean;
  onPress: () => void;
}

export default function LetterTile({ letter, isUsed, onPress }: LetterTileProps) {
  return (
    <TouchableOpacity
      style={[
        styles.tile,
        isUsed && styles.tileUsed, // Apply "used" styling when selected
      ]}
      onPress={onPress}
      disabled={isUsed} // Can't tap a tile that's already in use
      activeOpacity={0.7} // Slightly dim when pressed
    >
      <Text style={[styles.letter, isUsed && styles.letterUsed]}>
        {letter.toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // The tile container
  tile: {
    width: 64,
    height: 64,
    backgroundColor: '#fbbf24', // Gold/yellow like Scrabble tiles
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    // Add a subtle 3D effect
    borderBottomWidth: 4,
    borderBottomColor: '#d97706',
    borderRightWidth: 2,
    borderRightColor: '#d97706',
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4, // Android shadow
  },

  // Styling when the tile is used
  tileUsed: {
    backgroundColor: '#374151', // Gray when used
    borderBottomColor: '#1f2937',
    borderRightColor: '#1f2937',
    opacity: 0.5,
  },

  // The letter text
  letter: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a1a2e', // Dark color for contrast
  },

  // Letter text when used
  letterUsed: {
    color: '#6b7280',
  },
});
