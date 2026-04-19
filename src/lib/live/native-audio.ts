type PcmChunk = {
  data: string;
  mimeType?: string;
};

function parseSampleRate(mimeType?: string) {
  const match = mimeType?.match(/rate=(\d+)/i);
  const parsed = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 24_000;
}

function concatBase64(chunks: string[]) {
  return chunks.join("");
}

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return globalThis.btoa(binary);
}

function buildWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
}

/**
 * Strip the 44-byte WAV header from a recorded WAV ArrayBuffer,
 * returning only the raw PCM bytes as a base64 string.
 * Use this before sending mic segments to Gemini Live.
 */
export function stripWavHeaderToBase64(buffer: ArrayBuffer): string {
  const WAV_HEADER_BYTES = 44;
  const pcmBuffer = buffer.byteLength > WAV_HEADER_BYTES ? buffer.slice(WAV_HEADER_BYTES) : buffer;
  const bytes = new Uint8Array(pcmBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return globalThis.btoa(binary);
}

export function buildWavDataUriFromPcmChunks(chunks: PcmChunk[]) {
  if (!chunks.length) {
    return null;
  }

  const pcmBase64 = concatBase64(chunks.map((chunk) => chunk.data));
  const pcmBytes = base64ToBytes(pcmBase64);
  const sampleRate = parseSampleRate(chunks[0]?.mimeType);
  const header = buildWavHeader(pcmBytes.length, sampleRate, 1, 16);
  const wavBytes = new Uint8Array(header.length + pcmBytes.length);

  wavBytes.set(header, 0);
  wavBytes.set(pcmBytes, header.length);

  return `data:audio/wav;base64,${bytesToBase64(wavBytes)}`;
}
