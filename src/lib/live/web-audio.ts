function floatTo16BitPCM(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return globalThis.btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function pcm16ToFloat32(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.byteLength / 2);

  for (let index = 0; index < samples.length; index += 1) {
    const pcm = view.getInt16(index * 2, true);
    samples[index] = pcm / 0x8000;
  }

  return samples;
}

export class WebMicrophoneStreamer {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  async start(onChunk: (base64Pcm: string) => void) {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser microphone capture is not available.");
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      const pcmBytes = floatTo16BitPCM(channel);
      onChunk(bytesToBase64(pcmBytes));
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  async stop() {
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    await this.audioContext?.close();

    this.processorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioContext = null;
  }
}

export class WebPcmPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime = 0;

  async enqueuePcm16(base64Pcm: string, sampleRate: number = 24000) {
    if (typeof window === "undefined") {
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate });
      this.nextStartTime = this.audioContext.currentTime;
    }

    const bytes = base64ToBytes(base64Pcm);
    const floatSamples = pcm16ToFloat32(bytes);
    const buffer = this.audioContext.createBuffer(1, floatSamples.length, sampleRate);
    buffer.copyToChannel(floatSamples, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;
  }

  async reset() {
    await this.audioContext?.close();
    this.audioContext = null;
    this.nextStartTime = 0;
  }
}

