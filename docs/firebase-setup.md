# Firebase Setup

## 1. Create a local env file

Create a file named `.env` in the project root based on `.env.example`.

Example:

```bash
cp .env.example .env
```

## 2. Fill in these values from your Firebase project settings

Required keys:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

## 3. Recommended Firebase products to enable first

- Authentication
- Firestore Database

For the current app build:

- Authentication can use anonymous auth as a bootstrap
- Firestore stores `users` and `vehicles`

## 4. Firestore collections used so far

### `users`

- `id`
- `provider`
- `country`
- `language`
- `createdAt`
- `updatedAt`

### `vehicles`

- `userId`
- `country`
- `plateDisplay`
- `plateNormalized`
- `verificationStatus`
- `isPrimary`
- `createdAt`

## 5. What happens after config is added

- the app switches from mock mode to Firebase mode
- sign-in creates an authenticated Firebase session
- a basic user profile record is created in Firestore
- vehicle registration is saved in Firestore

## 6. Current limitation

Google sign-in and email sign-in UI labels already exist, but under the hood the Firebase path currently uses anonymous sign-in as a temporary bootstrap layer. That lets us validate the backend structure before adding provider-specific login flows.

