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

function listVendors({ limit, category, q } = {}) {
  const state = getState();
  const query = String(q || '').trim().toLowerCase();
  const items = state.vendors
    .filter((vendor) => {
      if (category && vendor.category !== category) return false;
      if (!query) return true;
      const blob = [vendor.name, vendor.location_address, vendor.summary, vendor.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(query);
    })
    .map((vendor) => decorateVendor(vendor, state))
    .sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      if (b.avg_rating !== a.avg_rating) return b.avg_rating - a.avg_rating;
      return (b.review_count || 0) - (a.review_count || 0);
    });
  const n = Number(limit || items.length);
  return items.slice(0, Number.isFinite(n) && n > 0 ? n : items.length);
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
  const signup = {
    id: `signup-${crypto.randomUUID().slice(0, 8)}`,
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    category: String(payload.category || '').trim(),
    location: String(payload.location || '').trim(),
    plan: String(payload.plan || 'Starter').trim(),
    message: String(payload.message || '').trim(),
    status: 'pending',
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
    approval_url: `/checkout/paypal/${crypto.randomUUID().slice(0, 8)}`,
    created_at: nowIso(),
    buyer: String(payload.buyer || '').trim(),
  };
  order.approval_url = `/checkout/paypal/${order.id}`;
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
  return {
    vendors: state.vendors.length,
    signups: state.vendor_signups.length,
    trips: state.trips.length,
    reviews: state.reviews.length,
    checkins: state.guardian_checkins.length,
    passes: state.payments.length,
  };
}

module.exports = {
  ROOT,
  DATA_DIR,
  STATE_PATH,
  slugify,
  getState,
  resetState,
  listVendors,
  listPlaces,
  translate,
  createVendorSignup,
  listVendorSignups,
  createReview,
  listReviews,
  createTrip,
  listTrips,
  addTripItem,
  createGuardianCheckin,
  listGuardianCheckins,
  createPaymentOrder,
  getPaymentOrder,
  capturePayment,
  dashboardStats,
};
