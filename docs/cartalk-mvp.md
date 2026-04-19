# CarTalk v1 MVP

## 1. Vision

CarTalk is a voice-controlled mobile app for drivers that enables short, safety-oriented communication between road users.

The key idea:

1. A sender sees an issue with another vehicle.
2. The sender describes the vehicle or provides the license plate by voice.
3. CarTalk identifies whether the target driver is reachable in the system.
4. The message is analyzed, moderated, and transformed into a safe spoken output.
5. The receiver hears the message through the app, ideally routed through the car's Bluetooth audio.

If the target user is not on CarTalk, the sender is informed that delivery is not possible.

## 2. MVP Goal

Validate that drivers will use a hands-free, safety-focused driver-to-driver voice messaging app and that receivers find the messages useful rather than distracting or abusive.

The MVP is not meant to solve every matching problem. It is meant to prove:

- drivers are willing to register their car in the app
- users can send useful safety notifications quickly
- recipients accept voice alerts from unknown drivers when moderation is strong
- Bluetooth-first playback works reliably in real driving conditions

## 3. First Market

- Country: Netherlands
- Language: Dutch first
- Compliance mindset: EU-first from day one

This means we design for:

- GDPR-aware data handling
- minimal retention
- clear user consent
- strict abuse prevention
- age and safety policies appropriate for mobile driving use

## 4. Core User Problem

Drivers often notice time-sensitive issues with nearby vehicles but have no safe way to warn the other driver.

Examples:

- "Your left brake light is broken."
- "Your trunk is still open."
- "You have a flat rear tire."
- "There is smoke coming from your car."

Existing alternatives are poor:

- shouting is impossible or unsafe
- flashing lights is ambiguous
- stopping the other driver is impractical
- social messaging apps do not identify drivers in real time

## 5. Product Principles

- Voice first: no typing required during active use
- Safety first: short, structured, non-social messaging
- Privacy first: no public exposure of identity or personal contact info
- Abuse resistant: strong moderation and rate limiting
- Driving compatible: works with Bluetooth and low-distraction flows

## 6. Recommended MVP Scope

### In scope

- iOS app
- Android app
- account creation with Google or email-based account setup
- user registers one or more vehicles
- Dutch voice input and Dutch voice output
- push-to-talk or single-tap voice capture
- structured safety message generation
- moderation of all outgoing messages
- delivery only to registered CarTalk users
- receiver hears a short spoken alert
- sender is notified when target is unavailable
- Bluetooth audio routing support where the OS and car allow it
- basic abuse reporting and sender blocking

### Out of scope for MVP

- open voice chat between users
- free-form social conversations
- anonymous public plate search
- direct person-to-person calling
- real-time location sharing between users
- marketplace or monetization features
- insurance, police, or roadside assistance integrations
- automatic computer vision recognition from camera feed

## 7. Best v1 Matching Model

This is the most important product decision.

### Recommendation

For v1, require users to pre-register their own vehicle license plate inside CarTalk. Messages can be addressed to:

- a spoken license plate
- a manually confirmed recognized plate

Do not rely on fuzzy car-description-only matching for MVP delivery.

### Why

Pure descriptive matching like "blue Volkswagen Golf near me" sounds attractive but is difficult to make reliable and safe. It introduces:

- false positives
- targeting mistakes
- potential harassment
- complicated privacy questions
- harder moderation and appeals

### Safer v1 flow

1. Receiver creates an account.
2. Receiver verifies ownership or possession of a vehicle plate.
3. Plate is stored as a protected identifier in the system.
4. Sender speaks the plate and message.
5. System normalizes the plate, checks whether it belongs to an active CarTalk user, and only then attempts delivery.

### Later expansion

After MVP validation, we can add optional assisted matching such as:

- guided car description
- color and vehicle type filters
- proximity-based suggestions
- camera-assisted recognition with explicit consent and legal review

## 8. Message Model

To keep the product safe while driving, messages should not be delivered as raw user audio in MVP.

### Recommended flow

1. Sender speaks naturally.
2. Gemini Live transcribes and interprets intent.
3. Backend moderation checks whether the content is allowed.
4. System rewrites the message into a short, neutral, structured alert.
5. Receiver hears the generated output in Dutch.

### Example

Raw sender input:

"Hey, your right rear light is broken, I am behind you on the A10."

Delivered output:

"Veiligheidsmelding: uw rechter achterlicht lijkt kapot."

### Why this is better than forwarding native audio

- better moderation
- reduced abuse
- consistent clarity
- less emotional or threatening content
- easier localization
- safer short-form playback

This still remains voice-native for both sides, but the delivered output is system-generated rather than unfiltered peer audio.

## 9. Supported Message Categories

Restrict the MVP to a small, safety-related taxonomy:

- broken light
- flat tire
- open trunk or door
- object dragging or loose load
- smoke or fire concern
- vehicle damage noticed during parking or low-speed situations
- general urgent safety issue

Each category should map to a short approved output format.

## 10. Suggested User Flows

### A. New user onboarding

1. User installs CarTalk.
2. User selects Dutch language.
3. User signs up with Google or email.
4. User accepts privacy terms and safety rules.
5. User registers a vehicle plate.
6. User enables microphone, notifications, and Bluetooth-friendly audio behavior.
7. User completes a short voice tutorial.

### B. Sending a message

1. User taps a large microphone button or steering-safe action.
2. App prompts: "Spreek het kenteken en het probleem in."
3. User says: "Kenteken 12-AB-34, linker remlicht kapot."
4. System extracts plate and issue.
5. Moderation validates that the content is allowed.
6. If receiver exists, message is delivered as a short spoken alert.
7. If receiver does not exist, sender hears: "Deze bestuurder gebruikt CarTalk nog niet."

### C. Receiving a message

1. Receiver gets a high-priority safety alert.
2. App plays a short chime and generated spoken output.
3. Receiver can optionally say "herhaal" or review later when parked.
4. Receiver can block or report abuse.

### D. No-match flow

1. Sender speaks a plate.
2. Plate is normalized.
3. No registered user found.
4. App returns a short unavailable response and ends the interaction.

## 11. Safety and Trust Requirements

This product will fail without strong trust controls.

### Required controls for MVP

- category-restricted messaging
- moderation before delivery
- profanity, threat, harassment, and spam filtering
- sender rate limits
- per-user daily send caps
- per-plate abuse detection
- block sender
- report message
- audit log for moderation review
- minimal message retention window

### Product rule

CarTalk is not a general messaging app. It is a road safety utility.

That positioning should shape everything.

## 12. Privacy and EU Considerations

This is not legal advice, but these are critical design assumptions.

### Sensitive areas

- license plates can be personal data in context
- voice recordings may contain personal data
- location or nearby-vehicle context increases sensitivity
- driver-to-driver communication can be abused if identity leaks

### Recommended privacy posture

- store as little raw audio as possible
- prefer transient processing over retention
- hash or tokenize searchable identifiers where feasible
- make user identity invisible to other users
- do not reveal whether a specific named person owns a vehicle
- give users clear deletion controls
- keep clear purpose limitation: road safety messaging only

Before launch, a formal GDPR review and Dutch legal review will be necessary.

## 13. Technical Architecture Recommendation

## Mobile apps

- React Native for shared iOS and Android development
- native bridges only where audio or Bluetooth behavior needs platform-specific handling

## Backend

- authentication service
- vehicle registry service
- message orchestration service
- moderation pipeline
- notification and delivery service
- admin moderation dashboard

## AI layer

- Gemini Live for speech interaction and understanding
- structured moderation prompts and rule checks before delivery
- controlled output generation for the receiver message

## Infrastructure needs

- secure auth
- encrypted data storage
- push notifications
- event logging
- monitoring and abuse analytics

## 14. MVP Screens

- welcome / onboarding
- sign in / account creation
- permissions setup
- register vehicle
- home with large push-to-talk action
- send confirmation state
- receiver alert history
- settings
- safety / report / blocked users

## 15. Success Metrics

For the pilot and early launch, measure:

- onboarding completion rate
- vehicle registration completion rate
- successful message delivery rate
- false positive match rate
- moderation rejection rate
- abuse report rate
- repeat usage by registered drivers
- receiver satisfaction after alert

The true success metric is not raw message volume. It is trusted useful alerts delivered with low abuse.

## 16. Biggest Risks

### Product risk

Users may not register before they need it, which weakens network effects.

### Matching risk

Plate recognition and delivery accuracy must be extremely high.

### Trust risk

Even small amounts of abuse could damage adoption.

### Legal risk

Plate-linked communication may trigger privacy and regulatory concerns.

### Driving UX risk

Too much friction or too much distraction will kill usage.

## 17. Recommended Go-To-Market for v1

Do not try to launch nationwide immediately.

Start with:

- Dutch pilot
- limited beta community
- drivers who actively opt in
- clear safety-first branding

Possible early audiences:

- commuting professionals
- EV communities
- driving schools
- fleet pilots
- local automotive communities

## 18. Roadmap

### Phase 1: Product definition

- finalize MVP scope
- choose stack
- define legal assumptions
- design conversation model

### Phase 2: Prototype

- build onboarding
- build vehicle registration
- build push-to-talk sender flow
- build receiver alert playback

### Phase 3: Private alpha

- test with a small Dutch user group
- measure matching accuracy
- tune moderation and audio UX

### Phase 4: Beta

- expand carefully
- add stronger reporting and admin tooling
- improve delivery reliability

## 19. What I Recommend We Build First

The first buildable version should be:

- React Native app
- Dutch-only UI
- Google sign-in plus email fallback
- one registered vehicle per user
- plate-based matching only
- push-to-talk sending
- generated Dutch spoken alert on receive
- message categories only, not free-form conversations
- receiver unavailable response
- basic moderation, rate limiting, reporting, and blocking

That version is realistic enough to test and strong enough to learn from.

## 20. Immediate Next Decisions

Before coding, we should lock these 5 decisions:

1. React Native or Flutter
2. Firebase/Supabase/custom backend
3. exact sign-in methods for v1
4. whether plate verification is self-asserted or checked with stronger verification
5. whether delivered messages are generated speech only or can include sanitized original audio later
