const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(ROOT, 'data');
const DATA_DIR = process.env.PATWAGO_DATA_DIR
  ? path.resolve(process.env.PATWAGO_DATA_DIR)
  : DEFAULT_DATA_DIR;
const SEED_PATH = process.env.PATWAGO_SEED_FILE
  ? path.resolve(process.env.PATWAGO_SEED_FILE)
  : path.join(DATA_DIR, 'seed.json');
const STATE_PATH = process.env.PATWAGO_STATE_FILE
  ? path.resolve(process.env.PATWAGO_STATE_FILE)
  : path.join(DATA_DIR, 'state.json');

let cache = null;

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || crypto.randomUUID();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedState() {
  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Missing seed file: ${SEED_PATH}`);
  }
  return readJson(SEED_PATH);
}

function loadState() {
  if (cache) return cache;
  if (fs.existsSync(STATE_PATH)) {
    cache = readJson(STATE_PATH);
    return cache;
  }
  cache = seedState();
  writeJson(STATE_PATH, cache);
  return cache;
}

function saveState(next) {
  cache = next;
  writeJson(STATE_PATH, next);
  return cache;
}

function resetState() {
  cache = clone(seedState());
  writeJson(STATE_PATH, cache);
  return cache;
}

function ensureCollections(state) {
  state.places ||= [];
  state.vendors ||= [];
  state.reviews ||= [];
  state.trips ||= [];
  state.guardian_checkins ||= [];
  state.vendor_signups ||= [];
  state.payments ||= [];
  state.phrasebook ||= [];
  state.transcripts ||= [];
  state.analytics_events ||= [];
  return state;
}

function getState() {
  return ensureCollections(loadState());
}

function reviewStatsFor(vendorId, reviews) {
  const list = reviews.filter((review) => review.vendor_id === vendorId);
  const count = list.length;
  const avg = count
    ? list.reduce((sum, review) => sum + Number(review.rating || 0), 0) / count
    : 0;
  return {
    review_count: count,
    avg_rating: count ? Number(avg.toFixed(1)) : 0,
  };
}

function decorateVendor(vendor, state) {
  const stats = reviewStatsFor(vendor.id, state.reviews || []);
  const featuredPlace = (state.places || []).find((place) => place.id === vendor.featured_place_id) || null;
  const avgRating = stats.review_count
    ? stats.avg_rating
    : Number(vendor.avg_rating_hint || 4.8);
  const reviewCount = stats.review_count
    ? stats.review_count
    : Number(vendor.review_count_hint || 0);
  return {
    ...vendor,
    avg_rating: Number(avgRating.toFixed ? avgRating.toFixed(1) : Number(avgRating).toFixed(1)),
    review_count: reviewCount,
    featured_place: featuredPlace,
  };
}

function partnerVendorsFromSignups(state) {
  return (state.vendor_signups || []).map((signup) => {
    const status = String(signup.status || 'pending').toLowerCase();
    const verified = signup.verified === true || status === 'approved' || status === 'verified' || status === 'active';
    return {
      id: signup.id || `partner-${slugify(signup.name || 'vendor')}`,
      name: signup.name || signup.business_name || 'Partner vendor',
      category: signup.category || 'tours',
      verified,
      partner: true,
      promoted: verified,
      location_address: signup.location || signup.location_address || 'Jamaica',
      summary: signup.message || signup.description || 'PatWaGo partner vendor',
      price_from: Number(signup.price_from || 0) || undefined,
      photo_url: signup.photo_url || '',
      avg_rating: Number(signup.avg_rating || 0) || undefined,
      review_count: Number(signup.review_count || 0) || 0,
      source: 'patwago_partner',
      status,
      created_at: signup.created_at,
    };
  });
}

function listVendors({ limit, category, q } = {}) {
  const state = getState();
  const query = String(q || '').trim().toLowerCase();
  const catalog = (state.vendors || []).map((vendor) => decorateVendor(vendor, state));
  const partners = partnerVendorsFromSignups(state).map((vendor) => decorateVendor(vendor, state));
  const items = [...partners, ...catalog]
    .filter((vendor) => {
      if (category && vendor.category !== category) return false;
      if (!query) return true;
      const blob = [vendor.name, vendor.location_address, vendor.summary, vendor.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(query);
    })
    .sort((a, b) => {
      const ap = a.promoted || a.verified ? 1 : 0;
      const bp = b.promoted || b.verified ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      if ((b.avg_rating || 0) !== (a.avg_rating || 0)) return (b.avg_rating || 0) - (a.avg_rating || 0);
      return (b.review_count || 0) - (a.review_count || 0);
    });
  const n = Number(limit || items.length);
  return items.slice(0, Number.isFinite(n) && n > 0 ? n : items.length);
}

function smartSearchVendors(filters = {}) {
  const state = getState();
  const query = normalize(filters.q);
  const category = String(filters.category || '').trim();
  const region = normalize(filters.region);
  const intent = normalize(filters.intent);
  const maxPrice = Number(filters.maxPrice || filters.max_price || 0);
  const minRating = Number(filters.minRating || filters.min_rating || 0);
  const verifiedOnly = filters.verified === true || filters.verified === 'true';
  const terms = [...new Set(`${query} ${intent}`.split(' ').filter((word) => word.length > 2))];
  const signals = { beach:['water_sports','lodging','adventure'], swim:['water_sports','adventure'], rafting:['tours','adventure'], waterfall:['tours','adventure'], culture:['tours','crafts'], music:['tours'], taxi:['transport'], airport:['transport'], ride:['transport'], food:['food'], eat:['food'], stay:['lodging'], hotel:['lodging'] };
  const inferred = terms.flatMap((term) => signals[term] || []);
  const pool = [
    ...partnerVendorsFromSignups(state).map((vendor) => decorateVendor(vendor, state)),
    ...(state.vendors || []).map((vendor) => decorateVendor(vendor, state)),
  ];
  const results = pool.map((vendor) => {
    const place = vendor.featured_place || {};
    const blob = normalize([vendor.name, vendor.category, vendor.location_address, vendor.summary, place.name, place.region, place.type, ...(place.highlights || [])].join(' '));
    let score = ((vendor.verified || vendor.promoted) ? 40 : 0) + Number(vendor.avg_rating || 0) * 6 + Math.min(10, Number(vendor.review_count || 0) / 8);
    if (vendor.partner) score += 25; // paid/partner signups rank above generic listings
    terms.forEach((term) => { if (blob.includes(term)) score += 14; });
    if (inferred.includes(vendor.category)) score += 18;
    if (region && blob.includes(region)) score += 24;
    if (category && vendor.category === category) score += 30;
    const reasons = [];
    if (vendor.partner && vendor.verified) reasons.push('Verified PatWaGo partner');
    else if (vendor.partner) reasons.push('PatWaGo partner application');
    if (region && blob.includes(region)) reasons.push(`Near ${filters.region}`);
    if (inferred.includes(vendor.category)) reasons.push(`Matches your ${intent || query || 'trip'} request`);
    if (vendor.verified) reasons.push('Verified by PatWaGo');
    if (vendor.avg_rating >= 4.7) reasons.push(`Top rated ${Number(vendor.avg_rating).toFixed(1)}`);
    return { ...vendor, smart_score: Number(score.toFixed(2)), match_reasons: reasons.slice(0, 3) };
  }).filter((vendor) => {
    if (category && vendor.category !== category) return false;
    if (region && !normalize([vendor.location_address, vendor.featured_place?.region].join(' ')).includes(region)) return false;
    if (maxPrice > 0 && Number(vendor.price_from || 0) > maxPrice) return false;
    if (minRating > 0 && Number(vendor.avg_rating || 0) < minRating) return false;
    if (verifiedOnly && !vendor.verified) return false;
    if ((query || intent) && vendor.smart_score < 25 && !vendor.partner) return false;
    return true;
  }).sort((a, b) => b.smart_score - a.smart_score);
  const n = Math.max(1, Math.min(100, Number(filters.limit || 50) || 50));
  return { items: results.slice(0, n), total: results.length, inferred_categories: [...new Set(inferred)] };
}

function listPlaces({ limit } = {}) {
  const state = getState();
  const n = Number(limit || state.places.length);
  return state.places.slice(0, Number.isFinite(n) && n > 0 ? n : state.places.length);
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function translate(text) {
  const state = getState();
  const q = normalize(text);
  if (!q) {
    return {
      source: 'empty',
      translation: '',
    };
  }

  const exact = state.phrasebook.find((entry) => normalize(entry.q) === q);
  if (exact) {
    return {
      source: 'lexicon',
      translation: exact.a,
    };
  }

  const broad = state.phrasebook.find((entry) => q.includes(normalize(entry.q)) || normalize(entry.q).includes(q));
  if (broad) {
    return {
      source: 'lexicon',
      translation: broad.a,
    };
  }

  const fallback = text
    .replace(/\bthe\b/gi, '')
    .replace(/\bis\b|\bare\b/gi, 'deh')
    .replace(/\bwhere\b/gi, 'weh')
    .replace(/\bcan you\b/gi, 'yuh can')
    .replace(/\bplease\b/gi, 'please')
    .replace(/\bthank you\b/gi, 'tanks mon');

  return {
    source: 'fallback',
    translation: fallback.replace(/\s+/g, ' ').trim(),
  };
}

function createVendorSignup(payload) {
  const state = getState();
  const status = String(payload.status || 'pending').trim().toLowerCase() || 'pending';
  const verified = payload.verified === true || status === 'approved' || status === 'verified' || status === 'active';
  const signup = {
    id: `signup-${crypto.randomUUID().slice(0, 8)}`,
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    category: String(payload.category || '').trim(),
    location: String(payload.location || '').trim(),
    plan: String(payload.plan || 'Starter').trim(),
    message: String(payload.message || '').trim(),
    status,
    verified,
    created_at: nowIso(),
  };
  state.vendor_signups.unshift(signup);
  saveState(state);
  return signup;
}

function listVendorSignups() {
  return getState().vendor_signups.slice();
}

function createReview(payload) {
  const state = getState();
  const vendorId = String(payload.vendor_id || payload.vendorId || '').trim();
  if (!vendorId) throw new Error('vendor_id is required');
  const review = {
    id: `review-${crypto.randomUUID().slice(0, 8)}`,
    vendor_id: vendorId,
    author: String(payload.author || 'Traveler').trim(),
    country: String(payload.country || '').trim(),
    rating: Math.max(1, Math.min(5, Number(payload.rating || 0) || 0)),
    body: String(payload.body || payload.comment || '').trim(),
    created_at: nowIso(),
  };
  state.reviews.unshift(review);
  saveState(state);
  return review;
}

function listReviews({ vendorId } = {}) {
  const state = getState();
  return state.reviews.filter((review) => !vendorId || review.vendor_id === vendorId);
}

function createTrip(payload) {
  const state = getState();
  const trip = {
    id: payload.id || `trip-${slugify(payload.title || payload.destination || crypto.randomUUID().slice(0, 8))}`,
    title: String(payload.title || 'My Trip').trim(),
    destination: String(payload.destination || 'Jamaica').trim(),
    days: Math.max(1, Number(payload.days || 1) || 1),
    startDate: String(payload.startDate || payload.start_date || '').trim(),
    notes: String(payload.notes || '').trim(),
    created_at: nowIso(),
    items: Array.isArray(payload.items) ? clone(payload.items) : [],
  };
  state.trips.unshift(trip);
  saveState(state);
  return trip;
}

function listTrips() {
  return getState().trips.slice();
}

function createTripFromItinerary(profile, itinerary) {
  const items = (itinerary.days || []).flatMap((day) => (day.stops || []).map((stop) => ({
    title: `Day ${day.day}: ${stop.place_name}`,
    note: `${stop.time} · ${stop.reason}`,
    place_id: stop.place_id,
    vendor_ids: stop.vendor_ids || [],
    done: false,
  })));
  return createTrip({
    title: itinerary.title || 'My AI Jamaica itinerary',
    destination: profile.location || 'Jamaica',
    days: itinerary.days?.length || profile.days || 1,
    startDate: profile.startDate || '',
    notes: itinerary.overview || '',
    items,
  });
}

function saveTranscript(payload) {
  const state = getState();
  const transcript = {
    id: `transcript-${crypto.randomUUID().slice(0, 8)}`,
    session_id: String(payload.session_id || payload.sessionId || 'default').slice(0, 120),
    role: payload.role === 'assistant' ? 'assistant' : 'user',
    content: String(payload.content || '').trim().slice(0, 10000),
    source: String(payload.source || 'text').slice(0, 40),
    created_at: nowIso(),
  };
  if (!transcript.content) throw new Error('content is required');
  state.transcripts.push(transcript);
  if (state.transcripts.length > 1000) state.transcripts = state.transcripts.slice(-1000);
  saveState(state);
  return transcript;
}

function listTranscripts({ sessionId } = {}) {
  return getState().transcripts.filter((item) => !sessionId || item.session_id === sessionId);
}

function addTripItem(tripId, payload) {
  const state = getState();
  const trip = state.trips.find((item) => item.id === tripId);
  if (!trip) return null;
  const item = {
    id: `item-${crypto.randomUUID().slice(0, 8)}`,
    title: String(payload.title || payload.name || 'New stop').trim(),
    note: String(payload.note || '').trim(),
    place_id: String(payload.place_id || payload.placeId || '').trim(),
    done: Boolean(payload.done),
  };
  trip.items ||= [];
  trip.items.push(item);
  saveState(state);
  return { trip, item };
}

function createGuardianCheckin(payload) {
  const state = getState();
  const checkin = {
    id: `checkin-${crypto.randomUUID().slice(0, 8)}`,
    traveler_name: String(payload.traveler_name || payload.name || 'Traveler').trim(),
    contact: String(payload.contact || '').trim(),
    hours: Math.max(1, Number(payload.hours || payload.intervalHours || 1) || 1),
    note: String(payload.note || '').trim(),
    state: String(payload.state || 'scheduled').trim() || 'scheduled',
    created_at: nowIso(),
  };
  state.guardian_checkins.unshift(checkin);
  saveState(state);
  return checkin;
}

function listGuardianCheckins() {
  return getState().guardian_checkins.slice();
}

function createPaymentOrder(payload) {
  const state = getState();
  const order = {
    id: `order-${crypto.randomUUID().slice(0, 8)}`,
    plan: String(payload.plan || 'trip').trim(),
    amount: Number(payload.amount || 0),
    description: String(payload.description || '').trim(),
    status: 'created',
    approval_url: '',
    created_at: nowIso(),
    buyer: String(payload.buyer || '').trim(),
  };
  order.approval_url = `/checkout/paypal/${order.id}`;
  order.order_id = order.id;
  state.payments.unshift(order);
  saveState(state);
  return order;
}

function getPaymentOrder(orderId) {
  return getState().payments.find((payment) => payment.id === orderId) || null;
}

function capturePayment(orderId, payload = {}) {
  const state = getState();
  const order = state.payments.find((payment) => payment.id === orderId);
  if (!order) return null;
  order.status = 'completed';
  order.captured_at = nowIso();
  if (payload.buyer) order.buyer = String(payload.buyer).trim();
  saveState(state);
  return order;
}

function dashboardStats() {
  const state = getState();
  const verified = (state.vendor_signups || []).filter((s) => {
    const status = String(s.status || '').toLowerCase();
    return s.verified === true || status === 'approved' || status === 'verified' || status === 'active';
  });
  return {
    vendors: verified.length,
    verified_vendors: verified.length,
    partner_applications: (state.vendor_signups || []).length,
    catalog_places: (state.places || []).length,
    signups: (state.vendor_signups || []).length,
    // User-owned activity is never taken from shared seed fake rows.
    trips: 0,
    reviews: (state.reviews || []).length,
    checkins: 0,
    passes: (state.payments || []).filter((p) => p.status === 'completed').length,
    transcripts: 0,
  };
}

module.exports = {
  ROOT,
  DATA_DIR,
  STATE_PATH,
  slugify,
  getState,
  saveState,
  resetState,
  listVendors,
  smartSearchVendors,
  listPlaces,
  translate,
  createVendorSignup,
  listVendorSignups,
  createReview,
  listReviews,
  createTrip,
  listTrips,
  addTripItem,
  createTripFromItinerary,
  saveTranscript,
  listTranscripts,
  createGuardianCheckin,
  listGuardianCheckins,
  createPaymentOrder,
  getPaymentOrder,
  capturePayment,
  dashboardStats,
};
