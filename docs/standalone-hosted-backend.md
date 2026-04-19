# CarTalk Standalone Hosted Backend

CarTalk kan zonder MacBook draaien zodra de Gemini relay publiek is gehost en de app naar die URL wijst.

## Benodigd

- Firebase project met:
  - Authentication
  - Firestore
  - Realtime Database
- Hosted Node backend voor `server/index.mjs`
- Gemini API key alleen server-side

## App environment

Voeg in de app toe:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_DATABASE_URL=
EXPO_PUBLIC_RELAY_BASE_URL=https://your-cartalk-backend.example.com
```

## Backend environment

Stel op de hosted service in:

```env
GEMINI_API_KEY=
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_ANALYZE_MODEL=gemini-2.5-flash
GEMINI_ANALYSIS_FALLBACK_MODEL=gemini-2.5-flash-lite
LIVE_RELAY_PORT=8787
```

## Deploy

Deze repo bevat:

- `Dockerfile`
- `render.yaml`

Je kunt dit direct naar Render deployen of dezelfde container naar een andere host sturen.

## Firebase rules

- Firestore rules: `firestore.rules`
- Realtime Database rules: `database.rules.json`

Upload beide voordat je live delivery tussen twee open apps test.
