import asyncio
import contextlib
import os
from pathlib import Path
import tempfile
import wave
from typing import Optional

from google import genai
from google.genai import types

DEFAULT_MODEL = "gemini-3.1-flash-live-preview"


def load_local_env() -> None:
    """
    Load key/value pairs from the repo .env file if present.
    This keeps the Python helper aligned with the existing CarTalk backend setup.
    """
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


class LiveAudioPlayer:
    """
    Minimal macOS playback helper for inline PCM audio chunks.
    Buffers one model turn and plays it through afplay when the turn completes.
    """

    def __init__(self) -> None:
        self.buffer = bytearray()
        self.mime_type = "audio/pcm;rate=24000"
        self.current_process: Optional[asyncio.subprocess.Process] = None
        self.temp_files: list[str] = []

    def add_chunk(self, audio_bytes: bytes, mime_type: str) -> None:
        self.buffer.extend(audio_bytes)
        self.mime_type = mime_type
        print(f"[audio] buffered {len(audio_bytes)} bytes ({mime_type})")

    async def flush(self) -> None:
        if not self.buffer:
            return

        sample_rate = 24000
        if "rate=" in self.mime_type:
            with contextlib.suppress(ValueError):
                sample_rate = int(self.mime_type.split("rate=", 1)[1].split(";", 1)[0])

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            temp_path = tmp.name

        with wave.open(temp_path, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(bytes(self.buffer))

        self.temp_files.append(temp_path)
        self.buffer.clear()

        if self.current_process and self.current_process.returncode is None:
            await self.current_process.wait()

        self.current_process = await asyncio.create_subprocess_exec("/usr/bin/afplay", temp_path)

    async def close(self) -> None:
        if self.buffer:
            await self.flush()

        if self.current_process and self.current_process.returncode is None:
            await self.current_process.wait()

        for temp_path in self.temp_files:
            with contextlib.suppress(FileNotFoundError):
                os.remove(temp_path)

        self.temp_files.clear()


async def receive_loop(session) -> None:
    """
    Consume Gemini Live server responses and route audio/text payloads.
    """
    player = LiveAudioPlayer()

    async for response in session.receive():
        server_content = getattr(response, "server_content", None)
        if not server_content:
            continue

        input_tx = getattr(server_content, "input_transcription", None)
        if input_tx and getattr(input_tx, "text", None):
            print(f"[input transcription] {input_tx.text}")

        output_tx = getattr(server_content, "output_transcription", None)
        if output_tx and getattr(output_tx, "text", None):
            print(f"[output transcription] {output_tx.text}")

        model_turn = getattr(server_content, "model_turn", None)
        if not model_turn or not getattr(model_turn, "parts", None):
            continue

        for part in model_turn.parts:
            inline_data = getattr(part, "inline_data", None)
            if inline_data and getattr(inline_data, "mime_type", "").startswith("audio/"):
                player.add_chunk(inline_data.data, inline_data.mime_type)
                continue

            text = getattr(part, "text", None)
            if text:
                print(f"[model text] {text}")

        if getattr(server_content, "turn_complete", False):
            await player.flush()

    await player.close()


async def send_example_inputs(session) -> None:
    """
    Send a text example and show how raw audio chunks can be streamed.
    """
    prompt = os.environ.get(
        "GEMINI_LIVE_TEST_PROMPT",
        "Herschrijf deze bestuurdersmelding in korte, nette Nederlandse audio voor de ontvanger: yo man je lichten zijn uit zet ze aan.",
    )
    await session.send_realtime_input(text=prompt)

    # Example: stream raw 16-bit PCM mono audio at 16kHz.
    # pcm_chunk: bytes = get_next_pcm_chunk_somehow()
    # await session.send_realtime_input(
    #     audio=types.Blob(
    #         data=pcm_chunk,
    #         mime_type="audio/pcm;rate=16000",
    #     )
    # )
    #
    # When your audio stream is done:
    # await session.send_realtime_input(audio_stream_end=True)


def build_live_config() -> types.LiveConnectConfig:
    """
    Build the Gemini Live connection config.
    """
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=(
            "You are CarTalk. Reply in concise Dutch. "
            "Turn informal driver reports into calm, polite road-safety audio for the receiving driver."
        ),
        # This installed SDK version exposes token-budget based thinking control.
        # A budget of 0 is the closest low-latency equivalent to "minimal".
        thinking_config=types.ThinkingConfig(thinking_budget=0),
        input_audio_transcription={},
        output_audio_transcription={},
    )


async def run_live_session(api_key: str) -> None:
    client = genai.Client(api_key=api_key)
    model = os.environ.get("GEMINI_LIVE_MODEL", DEFAULT_MODEL)
    receive_task: Optional[asyncio.Task] = None

    try:
        async with client.aio.live.connect(model=model, config=build_live_config()) as session:
            print(f"Connected to {model}")

            receive_task = asyncio.create_task(receive_loop(session))
            await send_example_inputs(session)
            await receive_task

    except asyncio.CancelledError:
        raise
    except Exception as exc:
        print(f"[connection error] {type(exc).__name__}: {exc}")
        if receive_task:
            receive_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receive_task
        raise


async def main() -> None:
    load_local_env()
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Set GEMINI_API_KEY in your environment.")

    try:
        await run_live_session(api_key)
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    except Exception as exc:
        print(f"[fatal] {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
