/**
 * Word Duel - Main App Component
 *
 * This is the "container" for the entire app. It sets up:
 * - Navigation (moving between screens)
 * - The wallet connection provider (lets any screen access wallet info)
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Preload dictionary at app startup to prevent game freezes
import { preloadDictionary } from './utils/dictionary';

// Import our screens (the different "pages" of the app)
import HomeScreen from './screens/HomeScreen';
import MatchmakingScreen from './screens/MatchmakingScreen';
import GameScreen from './screens/GameScreen';
import ResultsScreen from './screens/ResultsScreen';

// Import the wallet provider (manages wallet connection state)
import { WalletProvider } from './hooks/useWallet';

// Create the navigation system
// Think of this like a book where each screen is a page you can flip to
const Stack = createNativeStackNavigator();

export default function App() {
  // Start loading the dictionary as soon as the app launches
  // This runs in the background and prevents freezes during gameplay
  useEffect(() => {
    preloadDictionary();
  }, []);

  return (
    // SafeAreaProvider ensures content doesn't overlap with phone notches/edges
    <SafeAreaProvider>
      {/* WalletProvider makes wallet info available to all screens */}
      <WalletProvider>
        {/* StatusBar is the top bar showing time, battery, etc. */}
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />

        {/* NavigationContainer manages which screen is currently showing */}
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              // Styling for all screen headers
              headerStyle: { backgroundColor: '#1a1a2e' },
              headerTintColor: '#ffffff',
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          >
            {/* Each Stack.Screen is a "page" in the app */}
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: 'Word Duel' }}
            />
            <Stack.Screen
              name="Matchmaking"
              component={MatchmakingScreen}
              options={{
                title: 'Finding Match',
                headerBackVisible: false,
              }}
            />
            <Stack.Screen
              name="Game"
              component={GameScreen}
              options={{
                title: 'Playing...',
                // Prevent going back during a game (would be unfair!)
                headerBackVisible: false,
              }}
            />
            <Stack.Screen
              name="Results"
              component={ResultsScreen}
              options={{
                title: 'Game Over',
                headerBackVisible: false,
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </WalletProvider>
    </SafeAreaProvider>
  );
}
