(function () {
  var consentKey = 'patwago_analytics_consent';
  var anonKey = 'patwago_anonymous_id';
  var sessionKey = 'patwago_analytics_session';
  function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  function getStored(key, fallback) { try { var value = localStorage.getItem(key); if (value) return value; localStorage.setItem(key, fallback); return fallback; } catch (_) { return fallback; } }
  var anonymousId = getStored(anonKey, id('anon'));
  var sessionId = getStored(sessionKey, id('session'));
  function consent() { try { return localStorage.getItem(consentKey) === 'granted'; } catch (_) { return false; } }
  function send(name, properties) {
    if (!consent() && name !== 'consent_update') return;
    var payload = JSON.stringify({ name: name, anonymous_id: anonymousId, session_id: sessionId, properties: properties || {} });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/analytics/events', new Blob([payload], { type: 'application/json' }));
    else fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
  }
  window.patwagoAnalytics = { track: send, consent: consent };
  window.addEventListener('patwago:consent', function (event) {
    var value = event.detail === true ? 'granted' : 'denied';
    try { localStorage.setItem(consentKey, value); } catch (_) {}
    if (value === 'granted') send('consent_update', { consent: value });
  });
  if (consent()) send('page_view', { path: location.pathname, referrer_path: document.referrer ? new URL(document.referrer).pathname : '', viewport: window.innerWidth + 'x' + window.innerHeight, device: /Mobi/i.test(navigator.userAgent) ? 'mobile' : 'desktop' });
  else if (localStorage.getItem(consentKey) === null) {
    var banner = document.createElement('div');
    banner.className = 'analytics-consent';
    banner.innerHTML = '<strong>Help improve PatWaGo</strong><p>Allow privacy-safe usage analytics so we can improve searches, itineraries, and bookings. We never add microphone audio, messages, Guardian contacts, or payment details to marketing analytics.</p><div><button class="btn btn-gold" data-consent="yes">Allow analytics</button><button class="btn btn-ghost" data-consent="no">Not now</button></div>';
    document.body.appendChild(banner);
    banner.addEventListener('click', function (event) {
      var choice = event.target && event.target.getAttribute('data-consent');
      if (!choice) return;
      window.dispatchEvent(new CustomEvent('patwago:consent', { detail: choice === 'yes' }));
      banner.remove();
      if (choice === 'yes') send('page_view', { path: location.pathname, viewport: window.innerWidth + 'x' + window.innerHeight, device: /Mobi/i.test(navigator.userAgent) ? 'mobile' : 'desktop' });
    });
  }
})();
