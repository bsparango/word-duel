/**
 * Wallet Connection Hook
 *
 * This file manages everything related to connecting to a Solana wallet.
 * It uses the Solana Mobile Wallet Adapter, which lets the app talk to
 * wallet apps installed on the phone (like Phantom, Solflare, etc.)
 *
 * Think of this like a "bridge" between Word Duel and the player's wallet.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Platform } from 'react-native';
import {
  transact,
  Web3MobileWallet,
} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { Buffer } from 'buffer';

// The Solana network we're connecting to (devnet = fake money for testing)
const SOLANA_NETWORK = 'devnet';
const CONNECTION = new Connection(clusterApiUrl(SOLANA_NETWORK), 'confirmed');

// Test wallet address for emulator fallback (when no real wallet is available)
// This is a valid Solana address format (System Program address - safe for testing)
const TEST_WALLET_ADDRESS = '11111111111111111111111111111111';

// App identity - tells the wallet what app is requesting connection
const APP_IDENTITY = {
  name: 'Word Duel',
  uri: 'https://wordduel.app', // Placeholder - would be your real website
  icon: 'favicon.ico',
};

// ============================================================
// TYPES - These describe the shape of our data
// ============================================================

// What the wallet hook provides to the rest of the app
interface WalletContextType {
  // The player's wallet address (null if not connected)
  publicKey: PublicKey | null;

  // Whether the wallet is currently connected
  isConnected: boolean;

  // Whether we're in the middle of connecting
  isConnecting: boolean;

  // The player's SOL balance (null if not fetched yet)
  balance: number | null;

  // Function to connect to a wallet
  connect: () => Promise<void>;

  // Function to disconnect from the wallet
  disconnect: () => void;

  // Function to refresh the balance
  refreshBalance: () => Promise<void>;

  // Function to sign and send a transaction
  signAndSendTransaction: (transaction: Transaction) => Promise<string>;

  // Any error that occurred
  error: string | null;
}

// ============================================================
// CONTEXT - Lets any component access wallet info
// ============================================================

// Create a "container" that can hold wallet data and be accessed from anywhere
const WalletContext = createContext<WalletContextType | undefined>(undefined);

// ============================================================
// PROVIDER - The component that manages wallet state
// ============================================================

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  // State variables - these store wallet information
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived state - calculated from other state
  const isConnected = publicKey !== null;

  // --------------------------------------------------------
  // CONNECT - Opens the wallet app and asks for permission
  // --------------------------------------------------------
  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // 'transact' opens a connection to the wallet app
      // The wallet app will show a popup asking the user to approve
      await transact(async (wallet: Web3MobileWallet) => {
        // Request permission to use the wallet
        const authorizationResult = await wallet.authorize({
          identity: APP_IDENTITY,
          cluster: SOLANA_NETWORK,
        });

        // Get the wallet's public address (like an account number)
        // The Seed Vault returns the address as a Base64 encoded string,
        // while other wallets might return Base58 or raw bytes.
        // Cast to unknown to handle all possible formats from different wallets
        const addressData: unknown = authorizationResult.accounts[0].address;
        let walletPublicKey: PublicKey;

        if (addressData instanceof Uint8Array) {
          // Raw byte array - create PublicKey directly
          walletPublicKey = new PublicKey(addressData);
        } else if (typeof addressData === 'string') {
          const trimmedAddress = addressData.trim();

          // Check if it's Base64 encoded (contains chars not in Base58, or has padding)
          // Base64 uses: A-Z, a-z, 0-9, +, /, =
          // Base58 uses: A-Z, a-z, 0-9 (excluding 0, O, I, l)
          // So if we see +, /, or = it's definitely Base64
          const isBase64 = /[+/=]/.test(trimmedAddress);

          if (isBase64) {
            // Decode Base64 to bytes, then create PublicKey
            // Using Buffer.from (polyfilled in index.js) instead of atob
            // (atob doesn't exist in React Native)
            const bytes = Buffer.from(trimmedAddress, 'base64');
            walletPublicKey = new PublicKey(bytes);
          } else {
            // Assume it's a Base58 string
            walletPublicKey = new PublicKey(trimmedAddress);
          }
        } else if (Array.isArray(addressData)) {
          // Regular number array - convert to Uint8Array
          walletPublicKey = new PublicKey(new Uint8Array(addressData));
        } else if (typeof addressData === 'object' && addressData !== null) {
          // Object with numeric keys - convert to array
          const values = Object.values(addressData) as number[];
          walletPublicKey = new PublicKey(new Uint8Array(values));
        } else {
          throw new Error(`Unexpected address format: ${typeof addressData}`);
        }

        setPublicKey(walletPublicKey);

        // Fetch the wallet's SOL balance
        const balanceLamports = await CONNECTION.getBalance(walletPublicKey);
        // Convert from lamports to SOL (1 SOL = 1 billion lamports)
        setBalance(balanceLamports / 1_000_000_000);
      });
    } catch (err: any) {
      // Check if this is a "no wallet found" error (common on emulator)
      // In dev mode, fall back to test wallet for easier testing
      if (__DEV__ && err.code === 'ERROR_WALLET_NOT_FOUND') {
        console.log('No wallet found - using test wallet for development');
        const testPublicKey = new PublicKey(TEST_WALLET_ADDRESS);
        setPublicKey(testPublicKey);
        setBalance(1.5); // Fake balance for testing
        setError(null);
      } else {
        // Something went wrong - save the error message
        console.error('Wallet connection error:', err);
        setError(err.message || 'Failed to connect wallet');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // --------------------------------------------------------
  // DISCONNECT - Clear wallet data from the app
  // --------------------------------------------------------
  const disconnect = useCallback(() => {
    setPublicKey(null);
    setBalance(null);
    setError(null);
  }, []);

  // --------------------------------------------------------
  // REFRESH BALANCE - Get the latest SOL balance
  // --------------------------------------------------------
  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;

    try {
      const balanceLamports = await CONNECTION.getBalance(publicKey);
      setBalance(balanceLamports / 1_000_000_000);
    } catch (err: any) {
      console.error('Balance fetch error:', err);
    }
  }, [publicKey]);

  // --------------------------------------------------------
  // SIGN AND SEND - Sign a transaction and send it to Solana
  // --------------------------------------------------------
  const signAndSendTransaction = useCallback(
    async (transaction: Transaction): Promise<string> => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }

      // Open connection to wallet app for signing
      const signature = await transact(async (wallet: Web3MobileWallet) => {
        // Re-authorize (wallet apps may require this each session)
        await wallet.authorize({
          identity: APP_IDENTITY,
          cluster: SOLANA_NETWORK,
        });

        // Get the latest blockhash (required for transactions)
        const { blockhash, lastValidBlockHeight } =
          await CONNECTION.getLatestBlockhash();

        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Sign and send the transaction
        const signatures = await wallet.signAndSendTransactions({
          transactions: [transaction],
        });

        return signatures[0];
      });

      // Wait for the transaction to be confirmed
      // This makes sure the transaction actually went through
      await CONNECTION.confirmTransaction(signature, 'confirmed');

      // Refresh balance since it probably changed
      await refreshBalance();

      return signature;
    },
    [publicKey, refreshBalance]
  );

  // --------------------------------------------------------
  // RENDER - Provide wallet data to all child components
  // --------------------------------------------------------
  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnected,
        isConnecting,
        balance,
        connect,
        disconnect,
        refreshBalance,
        signAndSendTransaction,
        error,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ============================================================
// HOOK - Easy way for components to access wallet data
// ============================================================

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

// Export the connection so other parts of the app can use it
export { CONNECTION, SOLANA_NETWORK };
