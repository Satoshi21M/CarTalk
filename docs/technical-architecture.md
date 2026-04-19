# CarTalk Technical Architecture

## 1. Recommended Stack

### Mobile

- React Native with Expo for fast iteration
- TypeScript
- Expo Router
- Native modules only where Bluetooth audio behavior or background audio handling needs platform-specific work

### Backend

- Firebase Authentication
- Firestore
- Cloud Functions
- Firebase Cloud Messaging
- Cloud Storage only if temporary audio storage is required

### Admin and Ops

- React web admin dashboard
- Firebase Admin SDK
- analytics and crash reporting

### AI and speech layer

- Gemini Live for sender voice interaction
- server-side moderation and message normalization
- text-to-speech for short Dutch receiver playback

## 2. Why This Stack

This is the best fit for an MVP because it gives us:

- one mobile codebase for iOS and Android
- fast authentication setup
- real-time and event-driven backend workflows
- push notifications out of the box
- low ops overhead for an early team
- enough flexibility to swap parts later

This is not the cheapest long-term architecture, but it is a strong speed-to-market choice.

## 3. High-Level System Design

The system has 5 main layers:

1. Mobile app
2. Authentication and user profile layer
3. Vehicle registry and matching layer
4. Message safety pipeline
5. Delivery and moderation operations

## 4. Core Flow

### Send flow

1. User presses push-to-talk.
2. App captures voice input.
3. Gemini Live interprets the spoken plate and reported issue.
4. App sends structured payload to backend.
5. Backend validates sender permissions and rate limits.
6. Backend resolves the target plate to a CarTalk user.
7. Backend moderates and normalizes the message.
8. Backend stores a minimal message event.
9. Backend triggers push delivery.
10. Receiver app plays Dutch spoken alert.

### Receive flow

1. Receiver device gets a push notification.
2. App opens or wakes a lightweight audio alert flow.
3. App fetches the short normalized message payload.
4. App plays a short spoken message through available audio output.
5. Receiver can dismiss, repeat, block sender, or report abuse.

## 5. Mobile App Architecture

## Recommended folders

- `app/`
- `src/features/auth/`
- `src/features/onboarding/`
- `src/features/vehicles/`
- `src/features/messages/`
- `src/features/audio/`
- `src/features/settings/`
- `src/lib/api/`
- `src/lib/firebase/`
- `src/lib/permissions/`
- `src/lib/state/`
- `src/lib/types/`

## Key mobile modules

### Auth module

- sign in with Google
- email sign up and login
- session handling

### Onboarding module

- permissions
- language selection
- safety tutorial

### Vehicle module

- plate registration
- plate formatting and validation
- primary vehicle selection

### Voice send module

- push-to-talk UI
- voice capture
- transcript preview when needed
- send confirmation

### Inbox and alert module

- incoming alert playback
- recent alert history
- block and report actions

### Audio module

- audio session handling
- Bluetooth routing support
- alert playback behavior

## 6. Backend Services

### Auth service

Responsibilities:

- account creation
- identity provider linking
- auth token verification

### User profile service

Responsibilities:

- store language and country
- store consent state
- store account safety flags

### Vehicle registry service

Responsibilities:

- store registered vehicles
- normalize plate values
- map a plate to a target user
- prevent public plate enumeration in client flows

### Message orchestration service

Responsibilities:

- accept send requests
- validate payload shape
- enforce cooldowns and quotas
- create message records
- trigger moderation pipeline

### Moderation service

Responsibilities:

- classify allowed category
- reject abuse or non-safety content
- rewrite into approved Dutch output
- flag uncertain messages for fallback behavior

### Delivery service

Responsibilities:

- send push notifications
- manage retry logic
- record delivery status

### Abuse operations service

Responsibilities:

- process reports
- maintain sender risk scores
- apply temporary or permanent restrictions

## 7. Data Model

These are recommended top-level collections.

### `users`

Fields:

- `id`
- `email`
- `authProviders`
- `country`
- `language`
- `createdAt`
- `status`
- `consents`
- `safetyFlags`

### `vehicles`

Fields:

- `id`
- `userId`
- `country`
- `plateNormalized`
- `plateDisplay`
- `verificationStatus`
- `isPrimary`
- `createdAt`

Important note:

- `plateNormalized` should not be exposed in broad client queries

### `messageRequests`

Fields:

- `id`
- `senderUserId`
- `targetPlateNormalized`
- `rawTranscript`
- `detectedCategory`
- `status`
- `createdAt`
- `moderationDecision`

### `deliveredMessages`

Fields:

- `id`
- `senderUserId`
- `receiverUserId`
- `vehicleId`
- `category`
- `normalizedTextNl`
- `deliveryStatus`
- `reported`
- `createdAt`

### `reports`

Fields:

- `id`
- `messageId`
- `reporterUserId`
- `reason`
- `status`
- `createdAt`

### `blocks`

Fields:

- `id`
- `userId`
- `blockedSenderUserId`
- `createdAt`

## 8. Security Rules and Privacy Controls

### Client restrictions

- clients cannot query vehicles by arbitrary plate
- clients cannot see another user's identity
- clients cannot directly create delivered messages

### Backend-only operations

- plate matching
- moderation decisions
- delivery writes
- abuse score updates

### Privacy defaults

- retain raw audio only if strictly needed
- delete transient transcripts quickly
- keep normalized delivery records short-lived where possible
- avoid unnecessary location collection in MVP

## 9. AI Pipeline Design

For v1, do not allow unconstrained model behavior.

### Input

Sender says something like:

"Kenteken 12-AB-34, rechter achterlicht kapot."

### Extracted structure

- plate
- category
- optional note
- confidence score

### Moderation stages

1. plate format extraction
2. category classification
3. prohibited content screening
4. normalized Dutch output generation
5. confidence threshold check

### Fallback behavior

If confidence is too low:

- ask sender to repeat
- do not deliver uncertain messages

## 10. Audio and Bluetooth Considerations

This area needs real-device testing early.

### MVP goals

- capture voice reliably
- play spoken alerts clearly
- respect phone and car audio constraints

### Caveats

- iOS and Android differ in background audio behavior
- Bluetooth routing depends on device, OS version, and car system
- some alert behaviors may require native handling outside plain Expo defaults

### Recommendation

Prototype with Expo first, but be ready to use development builds and native modules for:

- audio focus
- route switching
- foreground service behavior on Android if needed

## 11. Notification Strategy

Use push notifications for incoming alerts.

Notification design should:

- be short and safety-oriented
- avoid exposing the sender
- prompt direct audio playback in app when possible

Example notification text:

"Nieuwe veiligheidsmelding beschikbaar."

## 12. Admin Dashboard

We need a basic internal tool before beta.

### Functions

- view reported messages
- review moderation outcomes
- inspect flagged users
- suspend abusive senders
- review delivery failures

## 13. Environments

At minimum:

- `development`
- `staging`
- `production`

Each should have separate:

- Firebase project
- push credentials
- config values
- analytics separation

## 14. Observability

Track:

- auth success and failure
- plate registration success and failure
- send attempt volumes
- moderation rejection rates
- delivery success rates
- report and block rates
- app crashes
- audio playback failures

## 15. Technical Risks

- Gemini parsing may be inconsistent for noisy driving audio
- plate normalization can fail on accents, spacing, or speech ambiguity
- Bluetooth playback may vary significantly across devices
- push delivery timing may be inconsistent under mobile OS constraints
- false matches are unacceptable and need strong safeguards

## 16. Recommended MVP Constraints

To protect quality, launch v1 with these limitations:

- Dutch only
- Netherlands plate format only
- one primary vehicle per user
- one-way safety alerts only
- no free-form peer audio delivery
- no background passive listening
- no location sharing

## 17. Suggested Next Engineering Deliverables

1. project scaffold
2. design system and navigation shell
3. auth and onboarding
4. vehicle registration flow
5. send message prototype
6. delivery and alert playback prototype
7. moderation pipeline stub
8. internal admin tool
