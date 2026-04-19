# Firebase Wiring Notes

This app is not connected to Firebase yet, but the config surface is prepared in:

- `src/lib/firebase/config.ts`
- `.env.example`

## Planned first integrations

1. Firebase Authentication for Google and email sign-in
2. Firestore for user and vehicle records
3. Cloud Functions for send-message orchestration
4. Firebase Cloud Messaging for receiver alerts

## Environment variables

Copy `.env.example` to `.env` and fill in the Expo public Firebase values when ready.

## Current state

- if Firebase env vars are missing, the app stays in mock mode
- if Firebase env vars are present, auth and vehicle services switch to Firebase-backed adapters
- web Google sign-in now uses Firebase popup auth
- native paths still use anonymous sign-in as a safe placeholder until dedicated mobile OAuth is wired
