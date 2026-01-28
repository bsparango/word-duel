/**
 * Word Duel - Entry Point
 *
 * This is the first file that runs when the app starts.
 * It sets up some required libraries and then launches the main App.
 */

// These two imports fix compatibility issues with Solana libraries on mobile
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// This tells React Native to use our App component as the main app
AppRegistry.registerComponent(appName, () => App);
