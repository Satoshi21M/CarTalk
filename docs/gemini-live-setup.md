# Gemini Live Setup

## Goal

Keep the Gemini API key off the mobile client by running a local relay server.

## What is implemented

- `server/index.mjs`: starts an HTTP server and WebSocket relay
- `server/gemini-live-relay.mjs`: connects server-side to Gemini Live and forwards messages
- `server/gemini_live_async.py`: async Python Live API test client using `google-genai`
- `src/lib/live/live-relay-client.ts`: app-side helper for connecting to the relay

## Environment

Add these values to `.env`:

- `GEMINI_API_KEY`
- `GEMINI_LIVE_MODEL`
- `GEMINI_ANALYZE_MODEL`
- `GEMINI_LIVE_RESPONSE_MODALITIES`
- `LIVE_RELAY_PORT`
- `EXPO_PUBLIC_RELAY_HOST` (optional, useful on a physical iPhone)

Default model currently points to:

- `gemini-3.1-flash-live-preview`

## Python Live test client

The repo also contains a Python Live API helper that uses the same `.env` values as the Node relay:

```bash
cd /Users/imbert21/Desktop/CarTalk
python3 server/gemini_live_async.py
```

See:

- `/Users/imbert21/Desktop/CarTalk/docs/gemini-live-python.md`

## Run the relay

```bash
cd /Users/imbert21/Desktop/CarTalk
source ~/.zshrc
npm run start:server
```

## Health check

Open:

- `http://localhost:8787/health`

If you test on a physical iPhone and the app still cannot reach the local relay, set your Mac LAN IP explicitly in `.env`:

```bash
EXPO_PUBLIC_RELAY_HOST=192.168.1.115
```

Then restart Metro and the app.

## Relay protocol

The app should connect to:

- `ws://localhost:8787/live`

Supported client message wrappers:

- `send_client_content`
- `send_realtime_input`
- `tool_response`

Server emits:

- `relay_ready`
- `gemini_message`
- `relay_error`

## Important note

The React Native app now has a relay-connected send prototype that can:

- send structured CarTalk prompts to Gemini Live
- stream realtime microphone PCM audio in the web preview
- queue returned PCM audio for playback in the web preview

Native iOS and Android microphone chunk streaming is still the next integration step and will likely require a more native audio capture path than the current Expo-only recorder surface.

## Native recording analysis

The iOS app now also supports a native recording test flow:

- record a short clip in the app
- play the clip back locally
- send the recorded clip to `POST /analyze-recording`
- let Gemini return:
  - transcript
  - Dutch CarTalk alert
  - detected target

This currently uses server-side `generateContent` audio analysis rather than the Live API websocket.
