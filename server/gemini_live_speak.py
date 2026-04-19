import asyncio
import base64
import json
import os
import sys
import wave
from io import BytesIO
from pathlib import Path

from google import genai
from google.genai import types

DEFAULT_MODEL = "gemini-3.1-flash-live-preview"


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and key not in os.environ:
            os.environ[key] = value


def build_live_config() -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=(
            "You are CarTalk. Reply in concise, calm Dutch for drivers. "
            "Speak naturally, clearly, and briefly."
        ),
        thinking_config=types.ThinkingConfig(thinking_budget=0),
        output_audio_transcription={},
    )


def build_wav_base64(pcm_chunks: list[tuple[bytes, str]]) -> tuple[str, str]:
    if not pcm_chunks:
        return "", ""

    mime_type = pcm_chunks[0][1]
    sample_rate = 24000
    if "rate=" in mime_type:
        try:
            sample_rate = int(mime_type.split("rate=", 1)[1].split(";", 1)[0])
        except ValueError:
            sample_rate = 24000

    pcm_bytes = b"".join(chunk for chunk, _ in pcm_chunks)
    with BytesIO() as buffer:
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)
        wav_bytes = buffer.getvalue()

    return base64.b64encode(wav_bytes).decode("ascii"), "audio/wav"


async def speak_prompt(prompt: str) -> dict:
    load_local_env()
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Set GEMINI_API_KEY in your environment.")

    model = os.environ.get("GEMINI_LIVE_MODEL", DEFAULT_MODEL)
    client = genai.Client(api_key=api_key)
    pcm_chunks: list[tuple[bytes, str]] = []
    transcript_parts: list[str] = []

    async with client.aio.live.connect(model=model, config=build_live_config()) as session:
        await session.send_realtime_input(text=prompt)

        async for response in session.receive():
            server_content = getattr(response, "server_content", None)
            if not server_content:
                continue

            output_tx = getattr(server_content, "output_transcription", None)
            if output_tx and getattr(output_tx, "text", None):
                transcript_parts.append(output_tx.text)

            model_turn = getattr(server_content, "model_turn", None)
            if model_turn and getattr(model_turn, "parts", None):
                for part in model_turn.parts:
                    inline_data = getattr(part, "inline_data", None)
                    if inline_data and getattr(inline_data, "mime_type", "").startswith("audio/"):
                        pcm_chunks.append((inline_data.data, inline_data.mime_type))

                    text = getattr(part, "text", None)
                    if text:
                        transcript_parts.append(text)

            if getattr(server_content, "turn_complete", False):
                break

    audio_base64, mime_type = build_wav_base64(pcm_chunks)
    return {
        "ok": True,
        "audioBase64": audio_base64,
        "mimeType": mime_type,
        "transcript": " ".join(part.strip() for part in transcript_parts if part.strip()).strip(),
        "model": model,
    }


async def main() -> None:
    prompt = sys.argv[1] if len(sys.argv) > 1 else ""
    if not prompt.strip():
        raise RuntimeError("Missing prompt argument.")

    result = await speak_prompt(prompt)
    print(json.dumps(result))


if __name__ == "__main__":
    asyncio.run(main())
