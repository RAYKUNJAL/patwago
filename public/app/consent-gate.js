/**
 * public/app/consent-gate.js
 * Hard-gated EU/SGI data consent. Include on landing + app shells BEFORE AI widgets.
 *
 * Usage:
 *   <script src="/app/consent-gate.js" data-app="patwago" data-policy-version="sgi-eu-v1"></script>
 *   window.AppConsent.allow('ai_processing') // boolean
 *   window.AppConsent.attach(fetch) // optional wrapper
 */
(function () {
  'use strict';

  var script = document.currentScript || {};
  var APP = (script.getAttribute && script.getAttribute('data-app')) || 'app';
  var POLICY = (script.getAttribute && script.getAttribute('data-policy-version')) || 'sgi-eu-v1';
  var STORAGE_KEY = APP + '_data_consent';
  var COOKIE_NAME = APP + '_data_consent';
  var EVENT = APP + ':consent';

  function nowIso() { return new Date().toISOString(); }

  function read() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.accepted_at) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function writeCookie(record) {
    try {
      var maxAge = 60 * 60 * 24 * 180;
      var val = encodeURIComponent(JSON.stringify(record));
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = COOKIE_NAME + '=' + val + '; Path=/; SameSite=Lax; Max-Age=' + maxAge + secure;
    } catch (_) {}
  }

  function save(record) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    writeCookie(record);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: record }));
    window.dispatchEvent(new CustomEvent('patwago:consent', {
      detail: !!(record.categories && record.categories.analytics),
    }));
  }

  function allow(category) {
    var c = read();
    if (!c) return category === 'essential';
    if (category === 'essential') return true;
    return !!(c.categories && c.categories[category]);
  }

  function consentHeaderValue() {
    var c = read();
    if (!c) return '';
    try {
      var json = JSON.stringify(c);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch (_) {
      return '';
    }
  }

  /** Wrap window.fetch to attach X-Data-Consent on same-origin /api calls */
  function installFetchWrapper() {
    if (window.__appConsentFetchWrapped) return;
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init ? Object.assign({}, init) : {};
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var sameApi = url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0;
      if (sameApi) {
        var headers = new Headers(init.headers || (input && input.headers) || {});
        var token = consentHeaderValue();
        if (token && !headers.has('X-Data-Consent')) headers.set('X-Data-Consent', token);
        init.headers = headers;
        if (init.credentials == null) init.credentials = 'include';
      }
      return orig(input, init);
    };
    window.__appConsentFetchWrapped = true;
  }

  function lockAiControls(locked) {
    var nodes = document.querySelectorAll(
      '[data-requires-consent], #micBtn, #demoExampleChips button, #demoModeVoice, #demoModeText, #recordVoiceBtn, #voiceTextForm button, #translateBtn'
    );
    nodes.forEach(function (el) {
      if (locked) {
        el.setAttribute('data-consent-locked', '1');
        if ('disabled' in el) el.disabled = true;
        el.setAttribute('title', 'Enable AI data consent to use this');
      } else if (el.getAttribute('data-consent-locked') === '1') {
        el.removeAttribute('data-consent-locked');
        if ('disabled' in el) el.disabled = false;
        el.removeAttribute('title');
      }
    });
  }

  function applyState() {
    var aiOk = allow('ai_processing');
    lockAiControls(!aiOk);
    document.documentElement.setAttribute('data-ai-consent', aiOk ? '1' : '0');
  }

  function buildRecord(categories, source) {
    return {
      version: new Date().toISOString().slice(0, 10),
      accepted_at: nowIso(),
      categories: Object.assign({
        essential: true,
        ai_processing: false,
        analytics: false,
        location: false,
        marketing: false,
      }, categories || {}),
      policy_version: POLICY,
      source: source || 'web_gate',
      anonymous_id: (function () {
        try {
          var k = APP + '_anonymous_id';
          var v = localStorage.getItem(k);
          if (v) return v;
          v = 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          localStorage.setItem(k, v);
          return v;
        } catch (_) { return null; }
      })(),
    };
  }

  function closeGate() {
    var el = document.getElementById('euConsentGate');
    if (el) el.remove();
    document.documentElement.classList.remove('consent-gate-open');
  }

  function openGate() {
    if (document.getElementById('euConsentGate')) return;
    document.documentElement.classList.add('consent-gate-open');
    var root = document.createElement('div');
    root.id = 'euConsentGate';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'euConsentTitle');
    root.innerHTML =
      '<style>' +
      '#euConsentGate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(5,5,5,.88);backdrop-filter:blur(10px);padding:20px}' +
      '#euConsentGate .box{max-width:520px;width:100%;background:#12100c;border:1px solid rgba(255,215,0,.28);' +
      'border-radius:20px;padding:28px;color:#f5f5f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.55)}' +
      '#euConsentGate h2{margin:0 0 8px;font-size:28px;color:#ffd400;font-family:Anton,Impact,sans-serif}' +
      '#euConsentGate p{color:#b7b7ad;line-height:1.55;font-size:14px}' +
      '#euConsentGate label{display:flex;gap:10px;align-items:flex-start;margin:10px 0;font-size:14px;color:#e8e8e0}' +
      '#euConsentGate .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}' +
      '#euConsentGate button{border:0;border-radius:999px;padding:12px 18px;font-weight:700;cursor:pointer;font-size:14px}' +
      '#euConsentGate .primary{background:#ffd400;color:#0a0a0a}' +
      '#euConsentGate .ghost{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12)}' +
      '#euConsentGate a{color:#ffd400}' +
      '</style>' +
      '<div class="box">' +
      '<h2 id="euConsentTitle">Before we continue</h2>' +
      '<p>European data rules require a clear yes before we process personal data or send anything to AI. Choose what you allow. You can change this later.</p>' +
      '<label><input type="checkbox" id="cgAi" checked> <span><strong>AI processing</strong> — translations, Miss Cleo / concierge, voice, itineraries (prompts may go to our model providers). We keep a timestamped generation audit log for compliance.</span></label>' +
      '<label><input type="checkbox" id="cgAnalytics"> <span><strong>Analytics</strong> — privacy-safe product usage (no payment or SOS contents).</span></label>' +
      '<label><input type="checkbox" id="cgLocation"> <span><strong>Location</strong> — only when you use near-me / safety features.</span></label>' +
      '<label><input type="checkbox" id="cgMarketing"> <span><strong>Marketing</strong> — optional product updates.</span></label>' +
      '<p style="font-size:12px">Essential cookies for login/security stay on. Read our <a href="#privacy" data-legal="privacy">Privacy Policy</a> and EU Data Consent notice.</p>' +
      '<div class="actions">' +
      '<button type="button" class="primary" data-act="save">Save choices</button>' +
      '<button type="button" class="primary" data-act="all">Accept all</button>' +
      '<button type="button" class="ghost" data-act="essential">Essential only</button>' +
      '</div></div>';
    document.body.appendChild(root);

    root.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute('data-act');
      if (!act) return;
      var cats;
      if (act === 'all') {
        cats = { essential: true, ai_processing: true, analytics: true, location: true, marketing: true };
      } else if (act === 'essential') {
        cats = { essential: true, ai_processing: false, analytics: false, location: false, marketing: false };
      } else {
        cats = {
          essential: true,
          ai_processing: !!document.getElementById('cgAi').checked,
          analytics: !!document.getElementById('cgAnalytics').checked,
          location: !!document.getElementById('cgLocation').checked,
          marketing: !!document.getElementById('cgMarketing').checked,
        };
      }
      save(buildRecord(cats, 'web_gate_' + act));
      closeGate();
      applyState();
    });
  }

  function init() {
    installFetchWrapper();
    var existing = read();
    if (!existing) openGate();
    applyState();
    window.addEventListener(EVENT, applyState);
  }

  window.AppConsent = {
    read: read,
    allow: allow,
    save: save,
    openGate: openGate,
    header: consentHeaderValue,
    storageKey: STORAGE_KEY,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
