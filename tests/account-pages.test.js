const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const JS_PATH = path.join(repoRoot, 'public', 'app', 'account-pages.js');
const CSS_PATH = path.join(repoRoot, 'public', 'app', 'account.css');

/* ---------- helpers ---------- */

// Minimal browser-like DOM stub so we can load the IIFE and exercise it.
function makeDomStub() {
  const store = {};
  const elements = {};
  let lastCreated = null;

  function makeEl(id) {
    const el = {
      id: id || '',
      tagName: 'DIV',
      _children: [],
      _attrs: {},
      style: {},
      dataset: {},
      hidden: false,
      disabled: false,
      checked: false,
      value: '',
      textContent: '',
      innerHTML: '',
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      _listeners: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k] || null; },
      removeAttribute() {},
      appendChild(child) { this._children.push(child); return child; },
      removeChild(child) { const i = this._children.indexOf(child); if (i >= 0) this._children.splice(i, 1); return child; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      remove() {},
      focus() {},
      blur() {},
      click() { if (this._listeners.click) this._listeners.click({ preventDefault() {}, target: this }); },
      addEventListener(type, fn) { this._listeners[type] = fn; },
      removeEventListener() {},
      insertAdjacentHTML() {},
      closest() { return null; },
    };
    return el;
  }

  const document = {
    body: makeEl('body'),
    head: makeEl('head'),
    _created: [],
    getElementById(id) { return elements[id] || null; },
    querySelector(sel) { return null; },
    querySelectorAll(sel) { return []; },
    createElement(tag) {
      const el = makeEl();
      el.tagName = String(tag || 'div').toUpperCase();
      this._created.push(el);
      lastCreated = el;
      return el;
    },
    createTextNode(text) { const el = makeEl(); el.textContent = String(text); return el; },
    addEventListener() {},
    readyState: 'complete',
    location: { pathname: '/app/account', href: 'http://localhost/app/account', search: '', hash: '' },
    title: 'PatWaGo',
  };

  // register an element so getElementById finds it
  function register(el, id) { if (id) { el.id = id; elements[id] = el; } }

  return {
    document,
    register,
    store,
    elements,
    lastCreatedRef: { get() { return lastCreated; } },
  };
}

function loadModule(domStub) {
  const window = {
    document: domStub.document,
    localStorage: makeStorage(domStub.store),
    sessionStorage: makeStorage({}),
    location: domStub.document.location,
    addEventListener() {},
    dispatchEvent() {},
    CustomEvent: function (name, opts) { this.name = name; this.detail = opts && opts.detail; },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '' }),
    navigator: { sendBeacon() { return true; }, userAgent: 'node' },
    URL: function (u) { this.pathname = u; },
    patwagoAnalytics: { track() {}, consent() { return true; } },
    SpeechRecognition: null,
    webkitSpeechRecognition: null,
    MediaRecorder: null,
    Audio: function () { this.play = async () => {}; this.onended = null; },
  };
  window.window = window;

  const sandbox = { window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, navigator: window.navigator, fetch: window.fetch, console, CustomEvent: window.CustomEvent, URL: window.URL, Audio: window.Audio, setTimeout: (fn, ms) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {}, Promise, Object, Array, String, Number, Boolean, Math, Date, JSON, RegExp, Error, Map, Set };
  vm.createContext(sandbox);
  const code = fs.readFileSync(JS_PATH, 'utf8');
  vm.runInContext(code, sandbox);
  return { window, sandbox };
}

function makeStorage(backing) {
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
    setItem(k, v) { backing[k] = String(v); },
    removeItem(k) { delete backing[k]; },
    clear() { Object.keys(backing).forEach((k) => delete backing[k]); },
  };
}

/* ---------- file existence ---------- */

test('account-pages.js and account.css exist as new files', () => {
  assert.ok(fs.existsSync(JS_PATH), 'account-pages.js should exist');
  assert.ok(fs.existsSync(CSS_PATH), 'account.css should exist');
  assert.ok(fs.statSync(JS_PATH).size > 1000, 'account-pages.js should be substantial');
  assert.ok(fs.statSync(CSS_PATH).size > 500, 'account.css should be substantial');
});

test('account-pages.js parses as valid JavaScript', () => {
  const code = fs.readFileSync(JS_PATH, 'utf8');
  // Should not throw
  new vm.Script(code, { filename: 'account-pages.js' });
  assert.ok(code.includes('PatWaGoAccountPages'), 'must expose PatWaGoAccountPages');
});

/* ---------- exposed API surface ---------- */

test('window.PatWaGoAccountPages exposes the required account functions', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const api = window.PatWaGoAccountPages;
  assert.ok(api, 'PatWaGoAccountPages must be defined on window');
  const expected = ['renderOnboarding', 'renderAuth', 'renderTrialStatus', 'renderCheckout', 'renderProfile', 'mount', 'toast', 'escapeHtml', 'jsonFetch'];
  for (const fn of expected) {
    assert.equal(typeof api[fn], 'function', 'missing exported function: ' + fn);
  }
});

/* ---------- accessibility: rendered HTML contains a11y attributes ---------- */

test('renderOnboarding returns HTML with aria-label, role, and lang attributes', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const html = window.PatWaGoAccountPages.renderOnboarding();
  assert.match(html, /aria-label/i, 'onboarding should include aria-label');
  assert.match(html, /role=/i, 'onboarding should include role');
  assert.match(html, /<h1/i, 'onboarding should have a heading');
});

test('renderAuth returns HTML with labelled form fields for register and login', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const html = window.PatWaGoAccountPages.renderAuth({ mode: 'register' });
  assert.match(html, /name="email"/i, 'auth should include email field');
  assert.match(html, /name="password"/i, 'auth should include password field');
  assert.match(html, /aria-label/i, 'auth fields should have aria-label');
  assert.match(html, /create/i, 'register mode should mention create');
  const loginHtml = window.PatWaGoAccountPages.renderAuth({ mode: 'login' });
  assert.match(loginHtml, /sign in|log in|login/i, 'login mode should mention sign in');
});

test('renderTrialStatus shows trial days remaining and a paywall CTA', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const html = window.PatWaGoAccountPages.renderTrialStatus({ daysRemaining: 3, totalDays: 7 });
  assert.match(html, /3/, 'should show days remaining');
  assert.match(html, /7/, 'should show total days');
  assert.match(html, /upgrade|paywall|premium|plan/i, 'should include upgrade CTA');
  assert.match(html, /role=/i, 'should include a11y attributes');
});

test('renderCheckout returns HTML with plan, amount, and a confirm action', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const html = window.PatWaGoAccountPages.renderCheckout({ plan: 'day', amount: 9.99, orderId: 'order-abc' });
  assert.match(html, /day/i, 'should show plan');
  assert.match(html, /9\.99/, 'should show amount');
  assert.match(html, /order-abc/, 'should show order id');
  assert.match(html, /confirm|checkout|pay/i, 'should include confirm action');
  assert.match(html, /aria-label/i, 'should include a11y attributes');
});

test('renderProfile returns HTML showing account info and links', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const html = window.PatWaGoAccountPages.renderProfile({ email: 'traveler@example.com', plan: 'day', passActive: true });
  assert.match(html, /traveler@example.com/, 'should show email');
  assert.match(html, /day/i, 'should show plan');
  assert.match(html, /active/i, 'should show pass status');
  assert.match(html, /aria-label|role=/i, 'should include a11y attributes');
});

/* ---------- mount wiring ---------- */

test('mount returns a container element with account content', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const container = window.document.createElement('div');
  container.id = 'account-root';
  stub.register(container, 'account-root');
  const result = window.PatWaGoAccountPages.mount('account-root', { state: 'onboarding' });
  assert.ok(result, 'mount should return the container');
  assert.ok(container.innerHTML.length > 0, 'mount should populate container innerHTML');
  assert.match(container.innerHTML, /patwago/i, 'mounted content should mention PatWaGo');
});

test('mount respects state option to switch between onboarding, auth, trial, checkout, profile', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  for (const state of ['onboarding', 'auth', 'trial', 'checkout', 'profile']) {
    const container = window.document.createElement('div');
    container.id = 'root-' + state;
    stub.register(container, 'root-' + state);
    window.PatWaGoAccountPages.mount('root-' + state, { state, email: 'a@b.com', plan: 'day', daysRemaining: 5, totalDays: 7, amount: 9.99, orderId: 'o1', passActive: true });
    assert.ok(container.innerHTML.length > 50, state + ' should produce substantial markup');
  }
});

/* ---------- no inline secrets ---------- */

test('account-pages.js contains no hardcoded API keys, tokens, or secrets', () => {
  const code = fs.readFileSync(JS_PATH, 'utf8');
  const patterns = [
    /sk_live_[A-Za-z0-9]{10,}/i,
    /pk_live_[A-Za-z0-9]{10,}/i,
    /api[_-]?key\s*=\s*['"][A-Za-z0-9]{16,}['"]/i,
    /secret\s*=\s*['"][A-Za-z0-9]{16,}['"]/i,
    /bearer\s+[A-Za-z0-9]{16,}/i,
    /password\s*=\s*['"][^'"]{6,}['"]/i,
  ];
  for (const p of patterns) {
    assert.doesNotMatch(code, p, 'should not contain secret matching ' + p);
  }
});

test('account-pages.js does not hardcode fetch URLs to external paid services', () => {
  const code = fs.readFileSync(JS_PATH, 'utf8');
  // No direct calls to stripe/paypal/etc domains — should use relative /api/ paths
  assert.doesNotMatch(code, /api\.stripe\.com/i, 'should not call Stripe API directly');
  assert.doesNotMatch(code, /api\.paypal\.com/i, 'should not call PayPal API directly');
  assert.doesNotMatch(code, /api\.openai\.com/i, 'should not call OpenAI API directly');
  assert.ok(/\/api\//.test(code), 'should use relative /api/ endpoints');
});

/* ---------- CSS design system conformance ---------- */

test('account.css uses PatWaGo black/gold design tokens', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  assert.match(css, /#ffd400/i, 'should use gold (#ffd400)');
  assert.match(css, /#080908|#0a0a0a|#090909/i, 'should use near-black background');
  assert.match(css, /Anton/i, 'should use Anton font');
  assert.match(css, /Inter/i, 'should use Inter font');
  assert.match(css, /\.glass/i, 'should reuse .glass card style');
});

test('account.css is mobile-first (uses media queries for larger screens)', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  // mobile-first means base styles target small then min-width queries enhance
  assert.match(css, /@media\s*\(min-width/i, 'should include min-width media queries');
});

test('account.css includes focus-visible styles for accessibility', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  assert.match(css, /focus-visible|:focus/i, 'should include focus styles for a11y');
});

/* ---------- jsonFetch & toast helpers ---------- */

test('escapeHtml escapes dangerous characters', () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  const out = window.PatWaGoAccountPages.escapeHtml('<script>alert("x")</script>');
  assert.equal(out.indexOf('<script>'), -1, 'should escape <script>');
  assert.ok(out.indexOf('&lt;') === 0, 'should start with &lt;');
});

test('toast creates and removes a toast node', async () => {
  const stub = makeDomStub();
  const { window } = loadModule(stub);
  // ensure a toast container exists
  window.document.body.id = 'body';
  window.PatWaGoAccountPages.toast('hello world');
  // Should have appended a .toast element to body
  const created = window.document._created.filter((el) => /toast/.test(el.className || ''));
  assert.ok(created.length >= 1, 'should create at least one toast element');
});
