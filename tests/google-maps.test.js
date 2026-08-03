'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadFreshMaps(env = {}) {
  const prior = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../lib/google-maps')];
  const maps = require('../lib/google-maps');
  process.env = prior;
  return maps;
}

function mockFetch(handler) {
  return async (url) => new Response(JSON.stringify(handler(new URL(String(url)))), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('publicConfig exposes browser key presence and value', () => {
  const maps = loadFreshMaps({ GOOGLE_MAPS_API_KEY: 'server-key', GOOGLE_MAPS_BROWSER_KEY: 'browser-key' });
  assert.equal(maps.configured({ GOOGLE_MAPS_API_KEY: 'server-key' }), true);
  assert.deepEqual(maps.publicConfig({ GOOGLE_MAPS_API_KEY: 'server-key', GOOGLE_MAPS_BROWSER_KEY: 'browser-key' }), {
    configured: true,
    browser_key: 'browser-key',
  });
});

test('businessSearch normalizes live Google Places results', async () => {
  const maps = loadFreshMaps({ GOOGLE_MAPS_API_KEY: 'server-key' });
  const places = await maps.businessSearch({ query: 'jerk chicken Negril', limit: 1 }, {
    env: { GOOGLE_MAPS_API_KEY: 'server-key' },
    fetch: mockFetch((url) => {
      assert.equal(url.pathname, '/maps/api/place/textsearch/json');
      assert.match(url.searchParams.get('query'), /jerk chicken Negril/);
      return {
        status: 'OK',
        results: [{
          place_id: 'place-1', name: 'Best Jerk', formatted_address: 'Negril, Jamaica', rating: 4.7,
          user_ratings_total: 99, geometry: { location: { lat: 18.3, lng: -78.3 } }, photos: [{ photo_reference: 'photo-1' }],
        }],
      };
    }),
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Best Jerk');
  assert.match(places[0].maps_url, /place_id/);
  assert.match(places[0].photo_url, /photo-1/);
});

test('directions returns distance, duration, steps, and Google Maps URL', async () => {
  const maps = loadFreshMaps({ GOOGLE_MAPS_API_KEY: 'server-key' });
  const route = await maps.directions({ origin: 'Montego Bay airport', destination: 'Negril', mode: 'driving' }, {
    env: { GOOGLE_MAPS_API_KEY: 'server-key' },
    fetch: mockFetch((url) => {
      assert.equal(url.pathname, '/maps/api/directions/json');
      assert.equal(url.searchParams.get('mode'), 'driving');
      return {
        status: 'OK',
        routes: [{ summary: 'A1', legs: [{
          start_address: 'Montego Bay', end_address: 'Negril',
          distance: { text: '80 km' }, duration: { text: '1 hour 30 mins' },
          steps: [{ html_instructions: 'Head <b>west</b>', distance: { text: '5 km' }, duration: { text: '6 mins' }, travel_mode: 'DRIVING' }],
        }] }],
      };
    }),
  });
  assert.equal(route.distance, '80 km');
  assert.equal(route.duration, '1 hour 30 mins');
  assert.equal(route.steps[0].instruction, 'Head west');
  assert.match(route.maps_url, /google\.com\/maps\/dir/);
});
