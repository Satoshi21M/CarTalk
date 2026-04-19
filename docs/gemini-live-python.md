# Gemini Live Python Test

This helper script opens a realtime Gemini Live session with the `google-genai` SDK.

Script:

- `/Users/imbert21/Desktop/CarTalk/server/gemini_live_async.py`

Run:

```bash
cd /Users/imbert21/Desktop/CarTalk
python3 server/gemini_live_async.py
```

The script automatically reads `/Users/imbert21/Desktop/CarTalk/.env` if it exists.

Supported shared env values:

- `GEMINI_API_KEY`
- `GEMINI_LIVE_MODEL`
- `GEMINI_LIVE_TEST_PROMPT`

What it does:

- connects to `gemini-3.1-flash-live-preview`
- requests `AUDIO` responses
- sends one Dutch CarTalk example prompt
- prints transcriptions
- buffers returned inline PCM audio and plays it on macOS with `afplay`
- uses the same `.env` convention as the Node relay so backend testing stays aligned
