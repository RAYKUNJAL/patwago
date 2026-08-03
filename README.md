# PatWaGo

## AI itinerary and self-hosted voice

PatWaGo keeps the existing Gemini Patois translator, uses Grok for grounded itinerary planning and concierge reasoning, and uses xAI expressive/custom voice TTS for speech. Copy `.env.example` into the private runtime environment and set the provider keys; never commit them. Optional speech-to-text infrastructure is self-hosted with Speaches/faster-whisper:

```bash
docker compose -f deploy/voice-services.compose.yml up -d
```

Production variables: `XAI_API_KEY`, `XAI_MODEL`, `WHISPER_URL`, `WHISPER_MODEL`, `TTS_BASE_URL`, and `TTS_VOICE`. Keep both voice containers bound to localhost; PatWaGo proxies them through its own API.

This removes ElevenLabs and robotic browser speech synthesis as runtime requirements. If expressive speech is unavailable, the transcript remains readable instead of silently using a robotic voice.

The voice page prefers self-hosted Speaches/faster-whisper transcription and xAI TTS with `XAI_VOICE_ID`. Create a custom voice from a consented 90–120 second Jamaican reference recording for an authentic accent. Grok responses remain grounded in `data/seed.json`; if xAI reasoning is unavailable, a deterministic catalog planner keeps itinerary suggestions usable without fabricating places.

## Owner marketing intelligence

The protected `/admin/analytics` dashboard shows conversion funnels, smart-search demand, vendor interest, itinerary adoption, translation/voice usage, and checkout conversion. Set `ADMIN_ANALYTICS_TOKEN` privately. Production events use PostgreSQL through `DATABASE_URL` and `database/001_analytics.sql`; local development falls back to `data/state.json`.

Tracking is consent-aware and first-party. Raw microphone audio, transcript text, Guardian contacts, and payment details are excluded from behavioral analytics.

Exported PatWaGo site and support files.
