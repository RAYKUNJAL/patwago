'use strict';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'KbKfLt8hwi6gTNZSpDM0';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
// Keep demo speech natural — turbo can feel rushed at 1.0.
const ELEVENLABS_SPEED = Number(process.env.ELEVENLABS_SPEED || 0.88);
const ELEVENLABS_STABILITY = Number(process.env.ELEVENLABS_STABILITY || 0.62);
const ELEVENLABS_SIMILARITY = Number(process.env.ELEVENLABS_SIMILARITY || 0.8);
const ELEVENLABS_STYLE = Number(process.env.ELEVENLABS_STYLE || 0.15);

function clamp(n, min, max, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

async function speakWithElevenLabs(text, opts = {}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const voiceId = opts.voiceId || ELEVENLABS_VOICE_ID;
  const model = opts.model || ELEVENLABS_MODEL;
  const safeText = String(text || '').slice(0, 2000);
  const speed = clamp(opts.speed ?? ELEVENLABS_SPEED, 0.7, 1.2, 0.88);
  const stability = clamp(opts.stability ?? ELEVENLABS_STABILITY, 0, 1, 0.62);
  const similarity = clamp(opts.similarity ?? ELEVENLABS_SIMILARITY, 0, 1, 0.8);
  const style = clamp(opts.style ?? ELEVENLABS_STYLE, 0, 1, 0.15);

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: safeText,
      model_id: model,
      voice_settings: {
        stability,
        similarity_boost: similarity,
        style,
        use_speaker_boost: true,
        speed,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs ${response.status}: ${errText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

module.exports = { speakWithElevenLabs };
