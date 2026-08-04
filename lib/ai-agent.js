const store = require('./store');
const googleMaps = require('./google-maps');

const XAI_BASE_URL = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const XAI_MODEL = process.env.XAI_MODEL || 'grok-4.5';
const XAI_API_KEY = process.env.XAI_API_KEY || '';

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function catalog() {
  const places = store.listPlaces({ limit: 100 });
  const vendors = store.listVendors({ limit: 100 });
  return { places, vendors };
}

async function marketplaceContext(query, category, limit = 8) {
  try {
    return await googleMaps.marketplaceSearch({ query, intent: query, category, region: 'Jamaica', limit });
  } catch {
    return [];
  }
}

function scorePlace(place, profile) {
  const interests = normalizeList(profile.interests).map((v) => v.toLowerCase());
  const location = String(profile.location || '').toLowerCase();
  const pace = String(profile.pace || '').toLowerCase();
  const text = [place.name, place.region, place.type, place.summary, ...(place.highlights || [])].join(' ').toLowerCase();
  let score = 0;
  interests.forEach((interest) => { if (text.includes(interest)) score += 4; });
  if (location && text.includes(location)) score += 6;
  if (pace === 'adventure' && /adventure|waterfall|jump|climb|water sports/.test(text)) score += 4;
  if (pace === 'relaxed' && /beach|quiet|swim|chill|sunset/.test(text)) score += 4;
  if (pace === 'culture' && /culture|museum|music|history|kingston/.test(text)) score += 4;
  return score;
}

function buildGroundedFallback(profile) {
  const { places, vendors } = catalog();
  const days = Math.max(1, Math.min(10, Number(profile.days || 3)));
  const ranked = places.slice().sort((a, b) => scorePlace(b, profile) - scorePlace(a, profile));
  const itineraryDays = Array.from({ length: days }, (_, index) => {
    const place = ranked[index % ranked.length];
    const matchingVendors = vendors.filter((vendor) => vendor.featured_place_id === place.id).slice(0, 2);
    return {
      day: index + 1,
      title: `${place.region}: ${place.name}`,
      region: place.region,
      summary: place.summary,
      stops: [{
        time: index === 0 ? '10:00' : '09:30',
        place_id: place.id,
        place_name: place.name,
        reason: (place.highlights || []).slice(0, 2).join(' · ') || place.summary,
        vendor_ids: matchingVendors.map((vendor) => vendor.id),
      }],
      local_tip: `Allow travel time and confirm opening hours for ${place.name} before leaving.`,
    };
  });
  return {
    title: `${days}-day Jamaica plan`,
    overview: `A ${String(profile.pace || 'balanced').toLowerCase()} Jamaica itinerary built from PatWaGo's verified catalog.`,
    days: itineraryDays,
    practical_tips: [
      'Confirm transport and attraction hours the day before.',
      'Keep cash for small local vendors while using verified operators for booked activities.',
      'Use Guardian Mode before longer day trips.',
    ],
    source: 'catalog-fallback',
    model: 'patwago-rules',
  };
}

function itinerarySchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'patwago_itinerary',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          overview: { type: 'string' },
          days: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                day: { type: 'integer' },
                title: { type: 'string' },
                region: { type: 'string' },
                summary: { type: 'string' },
                stops: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      time: { type: 'string' },
                      place_id: { type: 'string' },
                      place_name: { type: 'string' },
                      reason: { type: 'string' },
                      vendor_ids: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['time', 'place_id', 'place_name', 'reason', 'vendor_ids'],
                  },
                },
                local_tip: { type: 'string' },
              },
              required: ['day', 'title', 'region', 'summary', 'stops', 'local_tip'],
            },
          },
          practical_tips: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'overview', 'days', 'practical_tips'],
      },
    },
  };
}

async function callGrok(messages, responseFormat) {
  if (!XAI_API_KEY) throw new Error('XAI_API_KEY is not configured');
  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${XAI_API_KEY}`;
  const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: XAI_MODEL, messages, temperature: 0.35, response_format: responseFormat }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `xAI returned HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.message?.reasoning;
  if (!content) throw new Error('xAI returned no content');
  return { content, model: payload.model || XAI_MODEL };
}

async function generateItinerary(profile = {}) {
  const { places, vendors } = catalog();
  const liveBusinesses = await marketplaceContext([profile.location, ...normalizeList(profile.interests)].filter(Boolean).join(' '), '', 8);
  const fallback = buildGroundedFallback(profile);
  if (!XAI_API_KEY) return fallback;
  const compactPlaces = places.map((p) => ({ id: p.id, name: p.name, region: p.region, type: p.type, summary: p.summary, highlights: p.highlights }));
  const compactVendors = vendors.map((v) => ({ id: v.id, name: v.name, category: v.category, location: v.location_address, place_id: v.featured_place_id, price_from: v.price_from, verified: v.verified }));
  const compactLiveBusinesses = liveBusinesses.map((v) => ({ id: v.id, name: v.name, category: v.category, location: v.location_address, rating: v.avg_rating, reviews: v.review_count, source: 'google_places', maps_url: v.maps_url }));
  const messages = [
    {
      role: 'system',
      content: 'You are PatWaGo AI, a Jamaica travel itinerary specialist. Build practical plans primarily from the supplied PatWaGo catalog. You may mention live Google business listings as optional nearby businesses, clearly labeling them as Google listings and telling travelers to confirm hours/prices. Never invent attractions, vendors, opening hours, safety guarantees, or travel times. Use only listed place_id and vendor_ids for structured stops. If information is uncertain, say to confirm it.',
    },
    { role: 'user', content: JSON.stringify({ traveler: profile, places: compactPlaces, verified_vendors: compactVendors, live_google_businesses: compactLiveBusinesses }) },
  ];
  try {
    const result = await callGrok(messages, itinerarySchema());
    const itinerary = JSON.parse(result.content);
    return { ...itinerary, source: 'grok', model: result.model };
  } catch (error) {
    return { ...fallback, warning: `Grok unavailable: ${error.message}` };
  }
}

function localConcierge(message) {
  const { places, vendors } = catalog();
  const q = String(message || '').toLowerCase();
  const matchedPlaces = places.filter((place) => [place.name, place.region, place.type, place.summary].join(' ').toLowerCase().split(/\s+/).some((word) => word.length > 4 && q.includes(word))).slice(0, 3);
  const suggestions = matchedPlaces.length ? matchedPlaces : places.slice(0, 3);
  const top = suggestions[0];
  const nearby = vendors.filter((v) => suggestions.some((p) => p.id === v.featured_place_id)).slice(0, 2);
  if (/jerk|food|eat|nyam|hungry|restaurant/.test(q)) {
    const foodVendor = vendors.find((v) => /food|jerk|grill|kitchen/i.test(`${v.category} ${v.name} ${v.summary}`)) || nearby[0] || vendors[0];
    return `Yeah mon — for real food, start with ${foodVendor ? foodVendor.name : 'a verified local kitchen'} near ${top ? top.region : 'the coast'}. ${top ? top.name + ' is close if you want a stop after.' : ''} Confirm price before you sit, and keep a little cash handy.`;
  }
  if (/taxi|cab|transport|bus|fare|price to/.test(q)) {
    return `For taxis, agree the fare before you leave and use a registered driver or hotel desk when you can. ${top ? `If you're heading around ${top.region}, budget extra time for traffic.` : ''} PatWaGo lists verified operators so you don't get hustled at the stand.`;
  }
  if (/safe|safety|night|scam|hustle/.test(q)) {
    return `Stay sharp after dark — stick to well-lit areas, keep valuables low-key, and use verified transport. ${top ? `${top.name} in ${top.region} is a solid daytime stop.` : ''} If something feels off, walk away and call your hotel or a trusted contact.`;
  }
  if (/beach|swim|sea|sand/.test(q)) {
    const beach = places.find((p) => /beach/i.test(`${p.type} ${p.name}`)) || top;
    return `For clear water, check ${beach.name} in ${beach.region}. ${beach.summary} Go earlier in the day, carry water, and confirm any entry fee on arrival.`;
  }
  if (/dunn|falls|direction|how do i get|where is/.test(q)) {
    return top
      ? `${top.name} is in ${top.region}. ${top.summary} Use a verified driver or tour operator, and leave early so you're not rushing the road.`
      : `Tell me which parish you're in and I can point you to the closest verified stop.`;
  }
  const names = suggestions.map((p) => `${p.name} in ${p.region}`).join(', ');
  const vendorBit = nearby.length ? ` Verified operators include ${nearby.map((v) => v.name).join(' and ')}.` : '';
  return `Good question. From PatWaGo's local picks, look at ${names}.${vendorBit} Tell me your parish and what you want — food, beach, culture, or adventure — and I'll narrow it down.`;
}

async function conciergeReply(message, history = [], opts = {}) {
  const safeMessage = String(message || '').trim().slice(0, 4000);
  if (!safeMessage) throw new Error('message is required');
  const { places, vendors } = catalog();
  const liveBusinesses = await marketplaceContext(safeMessage, '', 10);
  const spoken = Boolean(opts.spoken || opts.demo);
  if (!XAI_API_KEY) return { reply: localConcierge(safeMessage), model: 'patwago-rules', source: 'catalog-fallback' };
  const style = spoken
    ? 'You are Miss Cleo, a warm, trusted older Jamaican lady and local travel guide for PatWaGo. Answer the traveler question directly in 2-4 short sentences. Use natural Jamaican English with light Patois flavor (yeah mon, irie, walk good) — clear enough for visitors. Do NOT only restate or translate their question. Give a real recommendation or practical answer. Never call yourself Tanty, Yaadie, or Yardie — your name is Miss Cleo.'
    : 'You are Miss Cleo, PatWaGo\'s warm Jamaican travel concierge. Answer the traveler question directly with practical local guidance. Never call yourself Tanty, Yaadie, or Yardie.';
  const messages = [
    {
      role: 'system',
      content: `${style} Ground factual recommendations in PatWaGo's verified vendor catalog and live Google business listings. Identify uncertainty. Do not claim to book, guarantee safety, or know live hours. When recommending a non-PatWaGo business, say it is a live Google Maps listing and advise the traveler to confirm hours/price. Catalog: ${JSON.stringify({ places, verified_vendors: vendors.map((v) => ({ id: v.id, name: v.name, category: v.category, location: v.location_address, place_id: v.featured_place_id, summary: v.summary, price_from: v.price_from })), live_google_businesses: liveBusinesses.map((v) => ({ id: v.id, name: v.name, category: v.category, location: v.location_address, rating: v.avg_rating, reviews: v.review_count, maps_url: v.maps_url })) })}`,
    },
    ...history.slice(-8).map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: String(turn.content || '').slice(0, 3000) })),
    { role: 'user', content: safeMessage },
  ];
  try {
    const result = await callGrok(messages);
    return { reply: result.content, model: result.model, source: 'grok' };
  } catch (error) {
    return { reply: localConcierge(safeMessage), model: 'patwago-rules', source: 'catalog-fallback', warning: error.message };
  }
}

module.exports = { generateItinerary, conciergeReply, buildGroundedFallback };
