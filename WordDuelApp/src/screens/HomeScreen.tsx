/**
 * Home Screen
 *
 * This is the main menu of Word Duel. From here, players can:
 * - Connect their Solana wallet
 * - See their SOL balance
 * - Choose bet amount and currency (SOL or USDC)
 * - Start finding a match
 * - Practice solo
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWallet } from '../hooks/useWallet';

// For navigation between screens
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

// Bet currency type
type BetCurrency = 'SOL' | 'USDC';

// Fixed bet amounts for each currency (uniform for all players)
const FIXED_BET_AMOUNTS = {
  SOL: 0.01,
  USDC: 1,
};

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function HomeScreen({ navigation }: HomeScreenProps) {
  // Get wallet information from our wallet hook
  const {
    publicKey,
    isConnected,
    isConnecting,
    balance,
    connect,
    disconnect,
    refreshBalance,
    error,
  } = useWallet();

  // Bet configuration state - fixed amounts for fair matchmaking
  const [betCurrency, setBetCurrency] = useState<BetCurrency>('SOL');
  // Amount is derived from currency selection (no custom amounts)
  const betAmount = FIXED_BET_AMOUNTS[betCurrency];

  // --------------------------------------------------------
  // HELPER FUNCTIONS
  // --------------------------------------------------------

  // Shorten the wallet address for display (it's very long!)
  // Example: "7xKXtg2C..." instead of the full address
  const shortenAddress = (address: string): string => {
    return `${address.slice(0, 8)}...${address.slice(-4)}`;
  };

  // Handle currency change (amount is automatically set based on currency)
  const handleCurrencyChange = (currency: BetCurrency) => {
    setBetCurrency(currency);
  };

  // Handle the "Find Match" button press
  const handleFindMatch = () => {
    // Navigate to matchmaking to find an opponent
    navigation.navigate('Matchmaking', {
      playerId: publicKey?.toString(), // Wallet address as player ID
      betAmount,
      betCurrency,
    });
  };

  // Handle the "Practice" button press
  const handlePractice = () => {
    navigation.navigate('Game', {
      betAmount: 0,
      isPractice: true,
    });
  };

  // --------------------------------------------------------
  // RENDER - What the user sees on screen
  // --------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      {/* App Title */}
      <View style={styles.header}>
        <Text style={styles.title}>WORD DUEL</Text>
        <Text style={styles.subtitle}>Battle with words, win SOL</Text>
      </View>

      {/* Wallet Section */}
      <View style={styles.walletSection}>
        {isConnected ? (
          // Show wallet info when connected
          <View style={styles.walletInfo}>
            <Text style={styles.walletLabel}>Connected Wallet</Text>
            <Text style={styles.walletAddress}>
              {shortenAddress(publicKey!.toString())}
            </Text>

            <View style={styles.balanceContainer}>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text style={styles.balanceAmount}>
                {balance !== null ? `${balance.toFixed(4)} SOL` : 'Loading...'}
              </Text>
            </View>

            {/* Refresh and Disconnect buttons */}
            <View style={styles.walletButtons}>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={refreshBalance}
              >
                <Text style={styles.smallButtonText}>Refresh</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.smallButton, styles.disconnectButton]}
                onPress={disconnect}
              >
                <Text style={styles.smallButtonText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // Show connect button when not connected
          <View style={styles.connectSection}>
            <Text style={styles.connectPrompt}>
              Connect your wallet to start playing
            </Text>

            <TouchableOpacity
              style={styles.connectButton}
              onPress={connect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.connectButtonText}>Connect Wallet</Text>
              )}
            </TouchableOpacity>

            {/* Show any connection errors */}
            {error && <Text style={styles.errorText}>{error}</Text>}
          </View>
        )}
      </View>

      {/* Bet Configuration - only show when connected */}
      {isConnected && (
        <View style={styles.betSection}>
          <Text style={styles.betSectionTitle}>Select Currency</Text>

          {/* Currency Toggle */}
          <View style={styles.currencyToggle}>
            <TouchableOpacity
              style={[
                styles.currencyButton,
                betCurrency === 'SOL' && styles.currencyButtonActive,
              ]}
              onPress={() => handleCurrencyChange('SOL')}
            >
              <Text
                style={[
                  styles.currencyButtonText,
                  betCurrency === 'SOL' && styles.currencyButtonTextActive,
                ]}
              >
                SOL
              </Text>
              <Text
                style={[
                  styles.currencyAmountText,
                  betCurrency === 'SOL' && styles.currencyAmountTextActive,
                ]}
              >
                0.01 SOL
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.currencyButton,
                betCurrency === 'USDC' && styles.currencyButtonActive,
              ]}
              onPress={() => handleCurrencyChange('USDC')}
            >
              <Text
                style={[
                  styles.currencyButtonText,
                  betCurrency === 'USDC' && styles.currencyButtonTextActive,
                ]}
              >
                USDC
              </Text>
              <Text
                style={[
                  styles.currencyAmountText,
                  betCurrency === 'USDC' && styles.currencyAmountTextActive,
                ]}
              >
                $1 USDC
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Game Actions */}
      <View style={styles.actionsSection}>
        {/* Find Match Button - only works when wallet is connected */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.primaryButton,
            !isConnected && styles.disabledButton,
          ]}
          onPress={handleFindMatch}
          disabled={!isConnected}
        >
          <Text style={styles.actionButtonText}>Find Match</Text>
          <Text style={styles.actionButtonSubtext}>
            {betAmount} {betCurrency} entry
          </Text>
        </TouchableOpacity>

        {/* Practice Button - works even without wallet */}
        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton]}
          onPress={handlePractice}
        >
          <Text style={styles.actionButtonText}>Practice</Text>
          <Text style={styles.actionButtonSubtext}>No bet, solo play</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Playing on Solana Devnet</Text>
        <Text style={styles.footerSubtext}>
          Using test SOL (not real money)
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES - How everything looks
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1, // Take up all available space
    backgroundColor: '#1a1a2e', // Dark purple background
    padding: 20,
  },

  // Header styles
  header: {
    alignItems: 'center',
    marginTop: 0,
    marginBottom: 20,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 8,
  },

  // Wallet section styles
  walletSection: {
    backgroundColor: '#16213e', // Slightly lighter dark blue
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  walletInfo: {
    alignItems: 'center',
  },
  walletLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 4,
  },
  walletAddress: {
    fontSize: 18,
    color: '#22d3ee', // Cyan color for addresses
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  balanceContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#22c55e', // Green for money
  },
  walletButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  smallButton: {
    backgroundColor: '#374151',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  smallButtonText: {
    color: '#ffffff',
    fontSize: 14,
  },
  disconnectButton: {
    backgroundColor: '#7f1d1d', // Dark red
  },

  // Connect section styles
  connectSection: {
    alignItems: 'center',
  },
  connectPrompt: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 16,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: '#7c3aed', // Purple
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ef4444', // Red
    marginTop: 12,
    textAlign: 'center',
  },

  // Bet configuration styles
  betSection: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  betSectionTitle: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  currencyToggle: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  currencyButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 6,
  },
  currencyButtonActive: {
    backgroundColor: '#7c3aed',
  },
  currencyButtonText: {
    color: '#9ca3af',
    fontSize: 18,
    fontWeight: 'bold',
  },
  currencyButtonTextActive: {
    color: '#ffffff',
  },
  currencyAmountText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  currencyAmountTextActive: {
    color: 'rgba(255, 255, 255, 0.7)',
  },

  // Action buttons styles
  actionsSection: {
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#22c55e', // Green
  },
  secondaryButton: {
    backgroundColor: '#374151', // Gray
  },
  disabledButton: {
    backgroundColor: '#1f2937', // Darker gray
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  actionButtonSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 4,
  },

  // Footer styles
  footer: {
    marginTop: 'auto', // Push to bottom
    alignItems: 'center',
    paddingBottom: 10,
  },
  footerText: {
    color: '#6b7280',
    fontSize: 14,
  },
  footerSubtext: {
    color: '#4b5563',
    fontSize: 12,
    marginTop: 2,
  },
});
