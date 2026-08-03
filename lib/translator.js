const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function cleanJson(text) {
  return String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}

async function translateWithGemini(text, from = 'en', to = 'patois') {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const legacyUrl = process.env.LEGACY_TRANSLATE_URL || '';
  if (!apiKey && legacyUrl) {
    const response = await fetch(legacyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `Existing translator returned HTTP ${response.status}`);
    const result = payload.data || payload;
    if (!result.translation) throw new Error('Existing translator returned no translation');
    return { translation: String(result.translation), ipa: result.ipa ? String(result.ipa) : undefined, source: result.source || 'gemini', model: 'existing-patwago-agent' };
  }
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const direction = from === 'patois' && to === 'en'
    ? 'Jamaican Patois to natural standard English'
    : 'standard English to authentic, readable Jamaican Patois';
  const prompt = `You are the PatWaGo Jamaican Patois translator. Translate from ${direction}.
Preserve meaning, place names, questions, tone, and intent. Use natural Jamaican grammar rather than word-by-word substitutions. Do not exaggerate or add profanity. Return only JSON: {"translation":"...","ipa":"..."}. IPA is optional and should only be included for Patois output.
Text: ${JSON.stringify(String(text || '').trim())}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `Gemini returned HTTP ${response.status}`);
  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  const parsed = JSON.parse(cleanJson(raw));
  if (!parsed.translation) throw new Error('Gemini returned no translation');
  return { translation: String(parsed.translation), ipa: parsed.ipa ? String(parsed.ipa) : undefined, source: 'gemini', model: GEMINI_MODEL };
}

module.exports = { translateWithGemini };
