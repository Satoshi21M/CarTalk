# Google Auth Setup

## Current behavior

- Web preview: real Google sign-in can be used through Firebase popup auth
- Native iOS and Android: the app currently falls back to anonymous Firebase auth until we add the Expo native Google auth flow

## Why this split exists

Firebase popup auth works well on web, but native Expo requires a dedicated OAuth flow with platform client IDs and redirect handling.

## Firebase Console setup

Enable these providers in Firebase Authentication:

- Google
- Anonymous

## What works today

If Firebase env values are present and you open the app in the browser preview:

- tapping `Continue with Google` uses Firebase Google popup auth
- a Firestore user profile is created
- vehicle registration can persist to Firestore

## Native next step

To support real Google sign-in on iOS and Android, we need to add:

- Expo Auth Session or a native Google sign-in library
- iOS client ID
- Android client ID
- redirect URI setup

## Recommendation

Use web popup auth first to validate the backend path, then add native OAuth once the Simulator is ready.

