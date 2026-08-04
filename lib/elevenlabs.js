'use strict';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'KbKfLt8hwi6gTNZSpDM0';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';

async function speakWithElevenLabs(text, opts = {}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const voiceId = opts.voiceId || ELEVENLABS_VOICE_ID;
  const model = opts.model || ELEVENLABS_MODEL;
  const safeText = String(text || '').slice(0, 2000);

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: safeText,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.4,
        use_speaker_boost: true,
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
