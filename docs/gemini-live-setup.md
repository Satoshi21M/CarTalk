# Gemini Cloud Setup

## Production/demo architecture

CarTalk keeps the Gemini API key off the iPhone. The native app connects to the
hosted relay:

- `https://cartalk-relay-us.onrender.com`

The hosted service provides:

- `GET /health`
- `POST /analyze-transcript`
- `POST /live-speak`
- open-app presence, recipient resolution, delivery, and acknowledgement

The iPhone therefore does not need Metro, a development server, or a MacBook
connection after a Release build has been installed.

## Environment

Server-only values:

- `GEMINI_API_KEY`
- `GEMINI_LIVE_MODEL`
- `GEMINI_ANALYZE_MODEL`
- `GEMINI_ANALYSIS_FALLBACK_MODEL`
- `LIVE_RELAY_PORT`

Mobile build value:

- `EXPO_PUBLIC_RELAY_BASE_URL=https://cartalk-relay-us.onrender.com`

The API key must never use an `EXPO_PUBLIC_` prefix.

## Deployment

Render reads the root `render.yaml` and builds the root `Dockerfile`. The
service is deployed in Virginia because Gemini requests from the previous
Render region were rejected before model execution.

The configured Live model is:

- `gemini-3.1-flash-live-preview`

## Local server development

Local relay use remains available for backend development:

```bash
cd /Users/imbert21/Desktop/CarTalk
node --env-file=.env server/index.mjs
```

Health check:

- `http://localhost:8787/health`

Changing `EXPO_PUBLIC_RELAY_BASE_URL` to a local URL is optional and should
never be required for an installed standalone demo build.

## Native voice flow

The production iPhone flow is:

1. On-device wake phrase and speech recognition
2. Hosted Gemini transcript analysis
3. Hosted Gemini Live audio generation
4. WAV file storage in the iPhone cache
5. Native file-URI playback
6. Optional delivery confirmation
7. Deterministic reset to wake mode

The older Python and WebSocket helpers remain development diagnostics. The
main iPhone flow does not depend on either helper.
