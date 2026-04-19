# CarTalk

CarTalk is a voice-first mobile app for iOS and Android that helps drivers send short, safety-focused spoken messages to other drivers.

For the first version, the product is designed for the Netherlands and broader EU expansion after validation.

## Workspace Status

This repository now contains:

- product documentation
- an Expo + React Native app scaffold
- prototype onboarding, auth, vehicle registration, home, inbox, and settings screens
- local persisted prototype state so onboarding survives app restarts
- Firebase-ready config scaffolding for the next integration step
- service abstractions for auth and vehicle registration so we can swap mocks for Firebase progressively
- a local Gemini Live relay server plus an app-side live prompt prototype
- a Python Gemini Live test client that shares the same `.env` config as the local backend

## Product Goal

Make roads safer by allowing drivers to notify each other about urgent, practical issues such as:

- broken tail lights
- open trunk doors
- flat tires
- hazards around the vehicle

Messages are voice-native. Users speak naturally, the system interprets and moderates the message, and the receiver hears a safe audio output.

## Initial Direction

The first product foundation is documented in:

- [`docs/cartalk-mvp.md`](/Users/imbert21/Desktop/CarTalk/docs/cartalk-mvp.md)
- [`docs/technical-architecture.md`](/Users/imbert21/Desktop/CarTalk/docs/technical-architecture.md)
- [`docs/sprint-plan.md`](/Users/imbert21/Desktop/CarTalk/docs/sprint-plan.md)
- [`docs/firebase-setup.md`](/Users/imbert21/Desktop/CarTalk/docs/firebase-setup.md)
- [`docs/google-auth-setup.md`](/Users/imbert21/Desktop/CarTalk/docs/google-auth-setup.md)
- [`docs/gemini-live-setup.md`](/Users/imbert21/Desktop/CarTalk/docs/gemini-live-setup.md)

## Recommended MVP Positioning

To make the product launchable and safer:

- start with registered CarTalk users only
- support Dutch first
- restrict messages to safety-related categories
- avoid exposing personal identity or direct user lookup
- treat license plate handling as a sensitive matching signal, not a public directory

## Next Build Steps

1. Choose the mobile stack and backend stack.
2. Define the driver matching model for v1.
3. Build a prototype of onboarding, push-to-talk, and message receive flows.
4. Add moderation, abuse controls, and audit tooling before pilot launch.
