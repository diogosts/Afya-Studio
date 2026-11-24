export function base64ToWavBlob(base64: string, mimeType = "audio/wav"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00.0";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateSpeechSeconds(text: string, includeBreaths = true): number {
  const words = countWords(text);
  if (words === 0) return 0;
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean).length;
  // Institutional Portuguese narration averages ~132 words per minute (2.2 words/sec)
  const baseSeconds = words / 2.2;
  const breathSeconds = includeBreaths && paragraphs > 1 ? (paragraphs - 1) * 0.55 : 0;
  return Math.max(1.5, baseSeconds + breathSeconds);
}

export async function extractWaveformPeaks(blob: Blob, barCount = 84): Promise<{ peaks: number[]; duration: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channelData = decoded.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channelData.length / barCount));
    const rawPeaks: number[] = [];

    for (let i = 0; i < barCount; i++) {
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let sumSquares = 0;
      for (let j = start; j < end; j++) {
        sumSquares += channelData[j] * channelData[j];
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
      rawPeaks.push(rms);
    }

    const maxPeak = Math.max(...rawPeaks, 0.001);
    const normalized = rawPeaks.map((val) => Math.max(0.12, Math.min(1, val / maxPeak)));

    return {
      peaks: normalized,
      duration: decoded.duration,
    };
  } finally {
    await ctx.close();
  }
}

/**
 * Concatenates multiple 24kHz mono 16-bit PCM WAV blobs into a single valid WAV file.
 * Strips the 44-byte RIFF header from each clip and writes a unified RIFF header.
 */
export async function concatWavBlobs(blobs: Blob[], gapSeconds = 0.45): Promise<Blob> {
  if (blobs.length === 0) {
    throw new Error("Nenhum áudio disponível para combinar.");
  }
  if (blobs.length === 1) {
    return blobs[0];
  }

  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const gapByteLength = Math.floor(sampleRate * gapSeconds) * numChannels * bytesPerSample;
  const silenceGap = new Uint8Array(gapByteLength);

  const pcmSegments: Uint8Array[] = [];
  let totalPcmBytes = 0;

  buffers.forEach((buf, index) => {
    const bytes = new Uint8Array(buf);
    const pcm = bytes.length > 44 ? bytes.slice(44) : bytes;
    pcmSegments.push(pcm);
    totalPcmBytes += pcm.length;

    if (index < buffers.length - 1 && gapByteLength > 0) {
      pcmSegments.push(silenceGap);
      totalPcmBytes += gapByteLength;
    }
  });

  const wavBuffer = new ArrayBuffer(44 + totalPcmBytes);
  const view = new DataView(wavBuffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + totalPcmBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, totalPcmBytes, true);

  const outBytes = new Uint8Array(wavBuffer);
  let offset = 44;
  for (const segment of pcmSegments) {
    outBytes.set(segment, offset);
    offset += segment.length;
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}
