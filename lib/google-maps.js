'use strict';

const MAPS_API_BASE = 'https://maps.googleapis.com/maps/api';
const GOOGLE_MAPS_API_KEY_NAME = 'GOOGLE_MAPS_API_KEY';
const GOOGLE_MAPS_BROWSER_KEY_NAME = 'GOOGLE_MAPS_BROWSER_KEY';

function serverKey(env = process.env) {
  return env[GOOGLE_MAPS_API_KEY_NAME] || '';
}

function browserKey(env = process.env) {
  return env[GOOGLE_MAPS_BROWSER_KEY_NAME] || env[GOOGLE_MAPS_API_KEY_NAME] || '';
}

function configured(env = process.env) {
  return Boolean(serverKey(env));
}

function publicConfig(env = process.env) {
  const key = browserKey(env);
  return { configured: Boolean(key), browser_key: key };
}

function cleanText(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function withKey(path, params, env = process.env) {
  const key = serverKey(env);
  if (!key) throw new Error('Google Maps API key is not configured');
  const url = new URL(`${MAPS_API_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') url.searchParams.set(k, String(v));
  });
  url.searchParams.set('key', key);
  return url;
}

async function googleJson(path, params, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const url = withKey(path, params, opts.env || process.env);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs || 12_000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_message || `Google Maps HTTP ${response.status}`);
  if (payload.status && !['OK', 'ZERO_RESULTS'].includes(payload.status)) {
    throw new Error(payload.error_message || `Google Maps status ${payload.status}`);
  }
  return payload;
}

function photoUrl(photoRef, maxWidth = 640) {
  if (!photoRef) return null;
  return `/api/maps/photo?ref=${encodeURIComponent(photoRef)}&maxwidth=${encodeURIComponent(maxWidth)}`;
}

function normalizePlace(place) {
  const loc = place.geometry && place.geometry.location ? place.geometry.location : {};
  return {
    place_id: place.place_id,
    name: place.name,
    address: place.formatted_address || place.vicinity || '',
    latitude: loc.lat,
    longitude: loc.lng,
    rating: place.rating || null,
    user_ratings_total: place.user_ratings_total || 0,
    price_level: place.price_level ?? null,
    business_status: place.business_status || '',
    open_now: place.opening_hours ? Boolean(place.opening_hours.open_now) : null,
    types: place.types || [],
    maps_url: place.place_id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.place_id)}` : null,
    photo_url: photoUrl(place.photos && place.photos[0] && place.photos[0].photo_reference),
  };
}

function categoryToGoogleType(category) {
  const map = { food: 'restaurant', water_sports: 'tourist_attraction', tours: 'tourist_attraction', adventure: 'tourist_attraction', transport: 'taxi_stand', lodging: 'lodging', beauty: 'beauty_salon', crafts: 'store' };
  return map[String(category || '').trim()] || '';
}

function categoryKeyword(category) {
  const map = { food: 'food restaurant jerk cafe bar', water_sports: 'watersports beach tours boat jet ski', tours: 'tours attractions excursions guide', adventure: 'adventure tours rafting waterfall hiking', transport: 'taxi shuttle transport airport transfer', lodging: 'hotel guest house villa lodging', beauty: 'spa salon beauty massage', crafts: 'craft market souvenir shop artisan' };
  return map[String(category || '').trim()] || '';
}

function inferCategory(types = []) {
  const joined = types.join(' ');
  if (/restaurant|food|meal|cafe|bar|bakery/.test(joined)) return 'food';
  if (/lodging|hotel/.test(joined)) return 'lodging';
  if (/taxi|transit|bus|car_rental/.test(joined)) return 'transport';
  if (/spa|beauty|hair/.test(joined)) return 'beauty';
  if (/store|shopping|market/.test(joined)) return 'crafts';
  return 'tours';
}

function toMarketplaceVendor(place, context = {}) {
  const name = place.name || 'Google Maps listing';
  const category = context.category || inferCategory(place.types || []);
  return {
    id: `google-${place.place_id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    google_place: true,
    source: 'google_places',
    place_id: place.place_id,
    name,
    category,
    verified: false,
    google_verified: true,
    location_address: place.address || '',
    latitude: place.latitude,
    longitude: place.longitude,
    photo_url: place.photo_url,
    price_from: 0,
    avg_rating: Number(place.rating || 0),
    review_count: Number(place.user_ratings_total || 0),
    business_status: place.business_status,
    open_now: place.open_now,
    maps_url: place.maps_url,
    summary: `Live Google Maps listing${place.rating ? ` rated ${place.rating}` : ''}${place.address ? ` near ${place.address}` : ''}. Confirm hours, price, and availability before visiting.`,
    match_reasons: ['Live Google Maps business', context.region ? `Near ${context.region}` : 'Jamaica listing'].filter(Boolean),
    smart_score: 50 + Number(place.rating || 0) * 5 + Math.min(10, Number(place.user_ratings_total || 0) / 100),
  };
}

async function businessSearch(params = {}, opts = {}) {
  const query = cleanText(params.query || params.q || 'restaurants in Jamaica');
  const region = cleanText(params.region || params.location || 'Jamaica');
  const type = cleanText(params.type || params.category || '');
  const limit = Math.max(1, Math.min(20, toNumber(params.limit, 10)));
  const searchQuery = query.toLowerCase().includes('jamaica') ? query : `${query} ${region || 'Jamaica'}`;
  const payload = await googleJson('/place/textsearch/json', { query: searchQuery, type, region: 'jm' }, opts);
  return (payload.results || []).slice(0, limit).map(normalizePlace);
}

async function marketplaceSearch(filters = {}, opts = {}) {
  if (!configured(opts.env || process.env)) return [];
  const query = cleanText(filters.intent || filters.q || filters.query || 'businesses');
  const category = cleanText(filters.category || '');
  const region = cleanText(filters.region || filters.location || 'Jamaica');
  const limit = Math.max(1, Math.min(20, toNumber(filters.limit, 10)));
  const keyword = [query, categoryKeyword(category), region].filter(Boolean).join(' ');
  const type = categoryToGoogleType(category);
  const places = await businessSearch({ query: keyword || 'things to do', region: region || 'Jamaica', type, limit }, opts);
  return places.map((place) => toMarketplaceVendor(place, { category: category || inferCategory(place.types), region }));
}

async function nearbySearch(params = {}, opts = {}) {
  const lat = toNumber(params.lat || params.latitude, null);
  const lng = toNumber(params.lng || params.longitude, null);
  if (lat === null || lng === null) throw new Error('lat and lng are required');
  const radius = Math.max(100, Math.min(50_000, toNumber(params.radius, 5000)));
  const keyword = cleanText(params.keyword || params.query || '');
  const type = cleanText(params.type || 'restaurant');
  const limit = Math.max(1, Math.min(20, toNumber(params.limit, 10)));
  const payload = await googleJson('/place/nearbysearch/json', { location: `${lat},${lng}`, radius, keyword, type }, opts);
  return (payload.results || []).slice(0, limit).map(normalizePlace);
}

function normalizeStep(step) {
  return {
    instruction: String(step.html_instructions || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    distance: step.distance && step.distance.text,
    duration: step.duration && step.duration.text,
    travel_mode: step.travel_mode,
    start_location: step.start_location,
    end_location: step.end_location,
  };
}

async function directions(params = {}, opts = {}) {
  const origin = cleanText(params.origin, 300);
  const destination = cleanText(params.destination, 300);
  if (!origin) throw new Error('origin is required');
  if (!destination) throw new Error('destination is required');
  const mode = ['driving', 'walking', 'bicycling', 'transit'].includes(String(params.mode || '').toLowerCase())
    ? String(params.mode).toLowerCase()
    : 'driving';
  const payload = await googleJson('/directions/json', { origin, destination, mode, region: 'jm', units: 'metric' }, opts);
  const route = (payload.routes || [])[0];
  if (!route) return null;
  const leg = (route.legs || [])[0] || {};
  return {
    summary: route.summary || '',
    origin: leg.start_address || origin,
    destination: leg.end_address || destination,
    distance: leg.distance && leg.distance.text,
    duration: leg.duration && leg.duration.text,
    steps: (leg.steps || []).map(normalizeStep),
    maps_url: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${encodeURIComponent(mode)}`,
  };
}

function photoRedirectUrl(ref, maxwidth = 640, env = process.env) {
  const url = withKey('/place/photo', { photoreference: ref, maxwidth }, env);
  return url.toString();
}

module.exports = { configured, publicConfig, businessSearch, nearbySearch, marketplaceSearch, directions, photoRedirectUrl };
