# Word Duel

A fast-paced competitive word game for Solana Mobile Seeker.

## What is Word Duel?

Word Duel is a mobile game where two players compete to form words from a shared pool of letters. Think of it like Scrabble meets speed chess, with cryptocurrency prizes!

**How it works:**
1. Two players connect their Solana wallets
2. Each player bets a small amount of SOL (like 0.01 SOL)
3. Both players see the same 16 letters
4. You have 60 seconds to form as many words as possible
5. Longer words = more points
6. Highest score wins the pot!

## Project Structure

```
word-duel/
├── app/                    # The mobile app (what you run on your phone)
│   ├── src/
│   │   ├── screens/        # Different "pages" of the app
│   │   │   ├── HomeScreen.tsx      # Main menu, wallet connection
│   │   │   ├── GameScreen.tsx      # Where you play the game
│   │   │   └── ResultsScreen.tsx   # Shows final score
│   │   ├── components/     # Reusable UI pieces
│   │   │   └── LetterTile.tsx      # The clickable letter squares
│   │   ├── hooks/          # Shared app logic
│   │   │   └── useWallet.tsx       # Wallet connection manager
│   │   ├── utils/          # Helper functions
│   │   │   ├── gameLogic.ts        # Scoring, letter generation
│   │   │   └── dictionary.ts       # Word validation
│   │   └── App.tsx         # Main app setup
│   └── package.json        # App dependencies
├── program/                # Solana smart contract (coming in Phase 5)
└── docs/                   # Additional documentation
```

## Setup Guide

### Prerequisites

Before you can run Word Duel, you need to install some developer tools. Don't worry - I'll walk you through each one!

#### 1. Install Node.js

Node.js runs JavaScript code on your computer. We need it to build the app.

**On Mac:**
```bash
# Install Homebrew first (if you don't have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install Node.js
brew install node
```

**Verify it worked:**
```bash
node --version  # Should show v18 or higher
npm --version   # Should show a number
```

#### 2. Install Watchman

Watchman watches your files for changes and automatically updates the app.

```bash
brew install watchman
```

#### 3. Install Java (for Android)

Android apps need Java to build.

```bash
brew install --cask zulu@17
```

After installing, add this to your shell config (~/.zshrc or ~/.bashrc):
```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
```

Then restart your terminal or run:
```bash
source ~/.zshrc
```

#### 4. Install Android Studio

Android Studio provides the tools to build and test Android apps.

1. Download from: https://developer.android.com/studio
2. Open the downloaded file and drag Android Studio to Applications
3. Open Android Studio and follow the setup wizard
4. When asked about SDK components, make sure these are checked:
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device (for testing on your computer)

**Configure Android SDK:**

After Android Studio installs, add these to your ~/.zshrc:
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

Restart your terminal.

#### 5. Set Up a Test Device

**Option A: Use your Solana Seeker device**
1. On your Seeker, go to Settings > About > Tap "Build number" 7 times to enable Developer options
2. Go to Settings > Developer options > Enable "USB debugging"
3. Connect your Seeker via USB
4. Run `adb devices` - you should see your device listed

**Option B: Use an Android Emulator**
1. Open Android Studio
2. Click "More Actions" (or Tools menu) > "Virtual Device Manager"
3. Click "Create device"
4. Select a phone (Pixel 6 works well)
5. Download a system image (API 34 recommended)
6. Finish creating the emulator

### Installing Word Duel

Now let's get the app set up!

```bash
# Go to the app folder
cd /Users/bensparango/Projects/word-duel/app

# Install all the dependencies
# This downloads all the code libraries the app needs
npm install

# For iOS (if you want to test on iPhone/iPad)
cd ios && pod install && cd ..
```

### Running the App

**Start the development server:**
```bash
cd /Users/bensparango/Projects/word-duel/app
npm start
```

This opens Metro Bundler - the tool that packages your app code.

**Run on Android:**

In a new terminal:
```bash
cd /Users/bensparango/Projects/word-duel/app
npm run android
```

**Run on iOS (if you have a Mac):**
```bash
npm run ios
```

### Testing Wallet Connection

Since we're using Solana devnet (test network), you'll need:

1. **A wallet app on your device** - Download Phantom or Solflare from the Play Store
2. **Set the wallet to Devnet:**
   - In Phantom: Settings > Developer Settings > Enable Testnet Mode > Select Devnet
   - In Solflare: Settings > Network > Devnet
3. **Get free test SOL:**
   - Copy your wallet address
   - Visit https://faucet.solana.com/
   - Paste your address and request devnet SOL

## Current Features (Phase 1)

✅ Project structure set up
✅ Wallet connection using Solana Mobile Wallet Adapter
✅ Home screen with connect/disconnect
✅ Balance display
✅ Game screen with letter tiles
✅ Word formation (tap letters to build words)
✅ Word validation (checks if it's a real English word)
✅ Scoring system
✅ 60-second timer
✅ Results screen

## Coming Next

- **Phase 2**: Firebase integration for real-time multiplayer
- **Phase 3**: Matchmaking system
- **Phase 4**: Solana escrow program for trustless betting
- **Phase 5**: Full integration and polish

## Troubleshooting

### "SDK location not found"
Make sure you've set ANDROID_HOME in your ~/.zshrc and restarted your terminal.

### "Unable to load script"
Make sure Metro Bundler is running (`npm start`).

### "Wallet connection failed"
- Make sure you have a wallet app installed
- Make sure the wallet is set to Devnet
- Check that you're running on a real device (wallet adapter doesn't work on emulator)

### App crashes on start
Check the Metro terminal for red error messages. They usually tell you what's wrong.

## Scoring System

| Word Length | Points |
|------------|--------|
| 3 letters  | 3      |
| 4 letters  | 5      |
| 5 letters  | 8      |
| 6 letters  | 12     |
| 7 letters  | 17     |
| 8+ letters | 23+    |

## Dictionary

The app includes a dictionary of ~2000 common English words. This covers most words you'd think of during a 60-second game. For production, we can expand this to 100,000+ words.

---

Built with React Native and Solana Mobile Wallet Adapter.
