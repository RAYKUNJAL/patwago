// App page generators — real internal pages served at /app, /app/translate, etc.
// Each page shares the same design system (dark, Jamaican colors, glass cards)
// and a common nav + bottom-nav shell.

const store = require('./store');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function catLabel(c) {
  var m = {
    water_sports: 'Water Sports',
    tours: 'Tours',
    food: 'Food',
    adventure: 'Adventure',
    transport: 'Transport',
    beauty: 'Beauty',
    crafts: 'Crafts',
    lodging: 'Lodging',
  };
  return m[c] || c || '';
}

function stars(rating) {
  var full = Math.round(rating);
  var s = '';
  for (var i = 0; i < 5; i++) s += i < full ? '★' : '☆';
  return s;
}

function shell(title, bodyHtml, activeNav, options) {
  var navItems = [
    { href: '/app', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { href: '/app/translate', label: 'Translate', icon: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m3.038.5a18.022 18.022 0 016.088-4.5M9 15a9 9 0 0111.95 0M21 12a9 9 0 01-9 9m3-9h3m-3 0v3' },
    { href: '/app/vendors', label: 'Vendors', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3-3 3 3 3-3 3 3 3-3z' },
    { href: '/app/trips', label: 'Trips', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
    { href: '/app/voice', label: 'AI Voice', icon: 'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z' },
  ];

  var bottomNav = navItems
    .map(function (item) {
      var cls = item.href === activeNav ? 'bottom-nav-item active' : 'bottom-nav-item';
      return (
        '<a href="' +
        item.href +
        '" class="' +
        cls +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' +
        item.icon +
        '"/></svg><span>' +
        item.label +
        '</span></a>'
      );
    })
    .join('');

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />\n' +
    '<title>' +
    esc(title) +
    ' — PatWaGo</title>\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />\n' +
    '<link rel="stylesheet" href="/app/app.css" />\n' +
    ((options && options.admin) ? '<link rel="stylesheet" href="/app/admin.css" />\n' : '') +
    ((options && options.account) ? '<link rel="stylesheet" href="/app/account.css" />\n' : '') +
    ((activeNav === '/app/vendors') ? '<link rel="stylesheet" href="/app/vendor-search.css" />\n' : '') +
    '</head>\n' +
    '<body>\n' +
    '<header class="app-header">\n' +
    '<a href="/app" class="app-logo">Pat<span>WaGo</span></a>\n' +
    ((options && options.admin) ? '<div class="app-header-actions"><span class="app-profile">Owner intelligence</span><a href="/" class="app-back">← Public site</a></div>\n' : '<div class="app-header-actions"><a href="/app/profile" class="app-profile">My pass</a><a href="/" class="app-back">← Back to site</a></div>\n') +
    '</header>\n' +
    '<main class="app-main">\n' +
    bodyHtml +
    '\n</main>\n' +
    ((options && options.admin) ? '' : '<nav class="bottom-nav" aria-label="App navigation">\n' + bottomNav + '</nav>\n') +
    '<script src="/app/analytics.js"></script>\n' +
    '<script src="/app/app.js"></script>\n' +
    ((options && options.admin) ? '<script src="/app/admin.js"></script>\n' : '') +
    ((options && options.account) ? '<script src="/app/account-pages.js"></script><script>PatWaGoAccountPages.mount("patwago-account",{state:"' + esc(options.state || 'onboarding') + '"});</script>\n' : '') +
    '</body>\n</html>\n'
  );
}

function dashboard() {
  var stats = store.dashboardStats();
  var places = store.listPlaces({ limit: 4 });
  var vendors = store.listVendors({ limit: 3 });

  var placeCards = places
    .map(function (p) {
      return (
        '<a href="/app/vendors?q=' +
        encodeURIComponent(p.name) +
        '" class="mini-card glass">' +
        (p.photo_url
          ? '<div class="mini-photo"><img src="' + esc(p.photo_url) + '" alt="' + esc(p.name) + '" loading="lazy"></div>'
          : '<div class="mini-photo mini-photo-fallback">' + esc(p.name.charAt(0)) + '</div>') +
        '<div class="mini-body"><h4>' +
        esc(p.name) +
        '</h4><p>' +
        esc(p.region) +
        '</p></div></a>'
      );
    })
    .join('');

  var vendorCards = vendors
    .map(function (v) {
      return (
        '<a href="/app/vendor/' +
        encodeURIComponent(v.id) +
        '" class="mini-card glass">' +
        (v.photo_url
          ? '<div class="mini-photo"><img src="' + esc(v.photo_url) + '" alt="' + esc(v.name) + '" loading="lazy"></div>'
          : '<div class="mini-photo mini-photo-fallback">' + esc(v.name.charAt(0)) + '</div>') +
        '<div class="mini-body"><h4>' +
        esc(v.name) +
        '</h4><p>' +
        catLabel(v.category) +
        ' · ' +
        stars(v.avg_rating || 4.8) +
        '</p></div></a>'
      );
    })
    .join('');

  var body =
    '<div class="dash-hero glass">\n' +
    '<div>\n<span class="eyebrow">Welcome back</span>\n<h1>Your Jamaica trip dashboard</h1>\n' +
    '<p>Translate, book vendors, plan trips, and stay safe — all in one place.</p>\n</div>\n' +
    '<div class="dash-stats">\n' +
    '<div class="dash-stat"><strong>' + stats.vendors + '</strong><span>Vendors</span></div>\n' +
    '<div class="dash-stat"><strong>' + stats.trips + '</strong><span>Trips</span></div>\n' +
    '<div class="dash-stat"><strong>' + stats.checkins + '</strong><span>Check-ins</span></div>\n' +
    '</div>\n</div>\n' +
    '<div class="quick-actions">\n' +
    '<a href="/app/translate" class="qa-card glass"><div class="qa-icon">🗣️</div><span>Translate</span></a>\n' +
    '<a href="/app/vendors" class="qa-card glass"><div class="qa-icon">🏪</div><span>Vendors</span></a>\n' +
    '<a href="/app/trips" class="qa-card glass"><div class="qa-icon">🗺️</div><span>Trips</span></a>\n' +
    '<a href="/app/guardian" class="qa-card glass"><div class="qa-icon">🛡️</div><span>Safety</span></a>\n' +
    '</div>\n' +
    '<div class="quick-actions"><a href="/app/trips/new" class="qa-card glass"><div class="qa-icon">✨</div><span>AI Itinerary</span></a><a href="/app/voice" class="qa-card glass"><div class="qa-icon">🎙️</div><span>AI Voice</span></a></div>' +
    '<section class="app-section">\n<h2>Featured locations</h2>\n<div class="card-grid">' +
    placeCards +
    '</div>\n</section>\n' +
    '<section class="app-section">\n<h2>Top vendors</h2>\n<div class="card-grid">' +
    vendorCards +
    '</div>\n' +
    '<a href="/app/vendors" class="see-all">Browse all vendors →</a>\n</section>\n';

  return shell('Dashboard', body, '/app');
}

function translatePage() {
  var body =
    '<div class="page-head">\n' +
    '<span class="eyebrow">Patois Translator</span>\n' +
    '<h1>Speak English, hear Patois back</h1>\n' +
    '</div>\n' +
    '<div class="translator-card glass">\n' +
    '<div class="translator-input">\n' +
    '<textarea id="translateInput" placeholder="Type or speak in English…" rows="4"></textarea>\n' +
    '<div class="translator-actions">\n' +
    '<button id="micBtn" class="btn btn-ghost">🎤 Mic</button>\n' +
    '<button id="translateBtn" class="btn btn-gold">Translate →</button>\n' +
    '</div>\n' +
    '</div>\n' +
    '<div id="translateResult" class="translator-result">\n' +
    '<p class="muted">Your Patois translation will appear here.</p>\n' +
    '</div>\n' +
    '</div>\n' +
    '<section class="app-section">\n<h2>Common phrases</h2>\n' +
    '<div class="phrase-list glass">\n' +
    '<div class="phrase" data-q="where can I find food"><strong>Where can I find food?</strong><span>Weh mi can find nyam?</span></div>\n' +
    '<div class="phrase" data-q="how much is this"><strong>How much is this?</strong><span>How much dis?</span></div>\n' +
    '<div class="phrase" data-q="thank you"><strong>Thank you</strong><span>Tanks mon</span></div>\n' +
    '<div class="phrase" data-q="good morning"><strong>Good morning</strong><span>Good mawnin</span></div>\n' +
    '<div class="phrase" data-q="let\'s go"><strong>Let\'s go</strong><span>Mek wi go</span></div>\n' +
    '<div class="phrase" data-q="how are you"><strong>How are you?</strong><span>How yuh deh?</span></div>\n' +
    '</div>\n</section>\n';

  return shell('Translate', body, '/app/translate');
}

function vendorsPage() {
  var body =
    '<div class="vendor-discovery-hero">' +
    '<span class="eyebrow">Verified Jamaica marketplace</span>' +
    '<h1>Tell us what you want to do.</h1>' +
    '<p>PatWaGo understands natural travel requests and matches verified local operators by location, budget, rating, and experience.</p>' +
    '<form id="smartVendorForm" class="smart-search-bar"><input id="vendorIntent" name="intent" placeholder="Try: beach adventure in Negril under $60" autocomplete="off"><button class="btn btn-gold" type="submit">Smart search</button></form>' +
    '<div class="intent-chips"><button data-intent="airport taxi in Montego Bay">Airport taxi</button><button data-intent="waterfall adventure near Ocho Rios">Waterfalls</button><button data-intent="relaxed beach activity in Negril">Beach day</button><button data-intent="culture and music in Kingston">Culture</button></div></div>' +
    '<div class="vendor-filter-layout"><aside class="vendor-filters"><div class="filter-heading"><strong>Refine results</strong><button id="clearVendorFilters" type="button">Clear</button></div>' +
    '<label>Search by name<input type="search" id="vendorSearch" placeholder="Vendor or activity"></label>' +
    '<label>Category<select id="vendorCategory"><option value="">All categories</option><option value="food">Food</option><option value="water_sports">Water Sports</option><option value="tours">Tours</option><option value="adventure">Adventure</option><option value="transport">Transport</option><option value="lodging">Lodging</option><option value="beauty">Beauty</option><option value="crafts">Crafts</option></select></label>' +
    '<label>Area<select id="vendorRegion"><option value="">Anywhere in Jamaica</option><option>Kingston</option><option>Montego Bay</option><option>Negril</option><option>Ocho Rios</option><option>Port Antonio</option></select></label>' +
    '<label>Maximum price <strong id="vendorPriceLabel">$150</strong><input type="range" id="vendorMaxPrice" min="20" max="200" value="150" step="5"></label>' +
    '<label>Minimum rating<select id="vendorMinRating"><option value="0">Any rating</option><option value="4">4.0+</option><option value="4.5">4.5+</option><option value="4.7">4.7+</option></select></label>' +
    '<label class="verified-toggle"><input type="checkbox" id="vendorVerified" checked> Verified vendors only</label></aside>' +
    '<section class="vendor-results"><div class="vendor-results-head"><div><span class="eyebrow">Smart matches</span><h2 id="vendorResultTitle">Recommended for you</h2></div><span id="vendorResultCount">Loading…</span></div><div id="vendorMatchSummary" class="match-summary" hidden></div>' +
    '<div id="vendorGrid" class="vendor-grid"><div class="vendor-skel"></div><div class="vendor-skel"></div><div class="vendor-skel"></div></div></section></div>';
  return shell('Vendors', body, '/app/vendors');
}

function vendorDetailPage(vendorId) {
  var vendors = store.listVendors({ limit: 100 });
  var vendor = vendors.find(function (v) { return v.id === vendorId; });
  if (!vendor) return null;

  var reviews = store.listReviews({ vendorId: vendor.id });

  var reviewHtml = reviews.length
    ? reviews
        .map(function (r) {
          return (
            '<div class="review-card glass"><div class="review-head"><strong>' +
            esc(r.author) +
            '</strong><span>' +
            stars(r.rating) +
            '</span></div><p>' +
            esc(r.body) +
            '</p><small>' +
            new Date(r.created_at).toLocaleDateString() +
            '</small></div>'
          );
        })
        .join('')
    : '<p class="muted">No reviews yet — be the first to leave one.</p>';

  var photo = vendor.photo_url
    ? '<div class="vendor-hero-photo"><img src="' + esc(vendor.photo_url) + '" alt="' + esc(vendor.name) + '"></div>'
    : '';

  var place = vendor.featured_place
    ? '<div class="info-row"><span>Location</span><strong>' +
      esc(vendor.featured_place.name) +
      ', ' +
      esc(vendor.featured_place.region) +
      '</strong></div>'
    : '<div class="info-row"><span>Address</span><strong>' + esc(vendor.location_address || 'Jamaica') + '</strong></div>';

  var body =
    '<a href="/app/vendors" class="back-link">← All vendors</a>\n' +
    photo +
    '<div class="vendor-detail glass">\n' +
    '<span class="eyebrow">' + catLabel(vendor.category) + '</span>\n' +
    '<h1>' + esc(vendor.name) + '</h1>\n' +
    (vendor.verified ? '<span class="verified-badge">✓ Verified</span>' : '') +
    '<div class="vendor-rating"><span class="stars">' + stars(vendor.avg_rating || 4.8) + '</span><span>' +
    (vendor.avg_rating || 4.8).toFixed(1) + ' · ' + (vendor.review_count || 0) + ' reviews</span></div>\n' +
    '<p class="vendor-summary">' + esc(vendor.summary || '') + '</p>\n' +
    '<div class="info-grid">\n' +
    place +
    '<div class="info-row"><span>Starting from</span><strong>$' + Number(vendor.price_from || 0).toFixed(2) + '</strong></div>\n' +
    '</div>\n' +
    '<div class="vendor-actions">\n' +
    '<a href="https://wa.me/?text=Booking%20' + encodeURIComponent(vendor.name) + '" class="btn btn-gold" target="_blank" rel="noopener">Book via WhatsApp</a>\n' +
    '<a href="tel:+18765550000" class="btn btn-ghost">Call</a>\n' +
    '</div>\n' +
    '</div>\n' +
    '<section class="app-section">\n<h2>Reviews</h2>\n<div class="review-list">' + reviewHtml + '</div>\n</section>\n' +
    '<section class="app-section">\n<h2>Leave a review</h2>\n' +
    '<form id="reviewForm" class="glass form-card">\n' +
    '<input type="hidden" name="vendor_id" value="' + esc(vendor.id) + '">\n' +
    '<div class="field"><label>Your name</label><input type="text" name="author" placeholder="Traveler" required></div>\n' +
    '<div class="field"><label>Rating</label><select name="rating"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select></div>\n' +
    '<div class="field"><label>Review</label><textarea name="body" placeholder="Tell others about your experience…" rows="3" required></textarea></div>\n' +
    '<button type="submit" class="btn btn-gold">Submit review</button>\n' +
    '</form>\n</section>\n';

  return shell(vendor.name, body, '/app/vendors');
}

function tripsPage() {
  var trips = store.listTrips();

  var tripList = trips.length
    ? trips
        .map(function (t) {
          var items = (t.items || [])
            .map(function (item) {
              return '<li>' + esc(item.title) + (item.done ? ' ✓' : '') + '</li>';
            })
            .join('');
          return (
            '<div class="trip-card glass">\n' +
            '<h3>' + esc(t.title) + '</h3>\n' +
            '<p class="muted">' + esc(t.destination) + ' · ' + (t.days || 1) + ' days' +
            (t.startDate ? ' · ' + esc(t.startDate) : '') + '</p>\n' +
            (t.notes ? '<p>' + esc(t.notes) + '</p>' : '') +
            (items ? '<ul class="trip-items">' + items + '</ul>' : '') +
            '</div>'
          );
        })
        .join('')
    : '<p class="muted">No trips yet — create your first itinerary below.</p>';

  var body =
    '<div class="page-head">\n' +
    '<span class="eyebrow">Trip Planner</span>\n' +
    '<h1>Build your Jamaica itinerary</h1>\n</div>\n' +
    '<section class="app-section">\n<h2>Your trips</h2>\n<div class="trip-list">' +
    tripList +
    '</div>\n</section>\n' +
    '<section class="app-section ai-callout glass"><span class="eyebrow">New: PatWaGo AI</span><h2>Not sure where to go?</h2><p class="muted">Answer a short questionnaire and let our Grok-powered Jamaica agent build the route around your interests.</p><a class="btn btn-gold" href="/app/trips/new">Build an AI itinerary</a></section>' +
    '<section class="app-section">\n<h2>Create a trip manually</h2>\n' +
    '<form id="tripForm" class="glass form-card">\n' +
    '<div class="field"><label>Trip title</label><input type="text" name="title" placeholder="Negril Weekender" required></div>\n' +
    '<div class="field"><label>Destination</label><input type="text" name="destination" placeholder="Negril, Jamaica" required></div>\n' +
    '<div class="form-row">\n' +
    '<div class="field"><label>Start date</label><input type="date" name="startDate"></div>\n' +
    '<div class="field"><label>Days</label><input type="number" name="days" min="1" max="30" value="3"></div>\n' +
    '</div>\n' +
    '<div class="field"><label>Notes</label><textarea name="notes" placeholder="Beaches, food stops, tours…" rows="3"></textarea></div>\n' +
    '<button type="submit" class="btn btn-gold">Save trip</button>\n' +
    '</form>\n</section>\n';

  return shell('Trips', body, '/app/trips');
}

function guardianPage() {
  var checkins = store.listGuardianCheckins();

  var checkinList = checkins.length
    ? checkins
        .map(function (c) {
          return (
            '<div class="checkin-card glass">\n' +
            '<div class="checkin-badge ' + esc(c.state) + '">' + esc(c.state.toUpperCase()) + '</div>\n' +
            '<div class="checkin-body">\n' +
            '<strong>' + esc(c.traveler_name) + '</strong>\n' +
            '<p>Contact: ' + esc(c.contact) + ' · Every ' + c.hours + ' hours</p>\n' +
            (c.note ? '<p class="muted">' + esc(c.note) + '</p>' : '') +
            '</div>\n</div>'
          );
        })
        .join('')
    : '<p class="muted">No check-ins scheduled.</p>';

  var body =
    '<div class="page-head">\n' +
    '<span class="eyebrow">Guardian Mode</span>\n' +
    '<h1>Travel safety check-ins</h1>\n' +
    '<p>Check-ins and location sharing only with Guardians you choose.</p>\n</div>\n' +
    '<div class="emergency-bar glass">\n' +
    '<a href="tel:119" class="btn btn-sos">🚨 Call 119 (Police)</a>\n' +
    '<a href="tel:110" class="btn btn-ghost">Call 110 (Ambulance)</a>\n' +
    '<a href="tel:888" class="btn btn-ghost">Tourist Police 888</a>\n' +
    '</div>\n' +
    '<section class="app-section">\n<h2>Active check-ins</h2>\n<div class="checkin-list">' +
    checkinList +
    '</div>\n</section>\n' +
    '<section class="app-section">\n<h2>Schedule a check-in</h2>\n' +
    '<form id="guardianForm" class="glass form-card">\n' +
    '<div class="field"><label>Traveler name</label><input type="text" name="traveler_name" placeholder="Your name" required></div>\n' +
    '<div class="field"><label>Trusted contact</label><input type="text" name="contact" placeholder="Mom, Dad, partner…" required></div>\n' +
    '<div class="form-row">\n' +
    '<div class="field"><label>Check-in every (hours)</label><input type="number" name="hours" min="1" max="24" value="4"></div>\n' +
    '<div class="field"><label>Note</label><input type="text" name="note" placeholder="Beach day in Negril"></div>\n' +
    '</div>\n' +
    '<div class="form-row">\n' +
    '<button type="submit" class="btn btn-gold">Schedule check-in</button>\n' +
    '<button type="button" id="safeBtn" class="btn btn-ghost">I\'m Safe</button>\n' +
    '</div>\n' +
    '</form>\n</section>\n';

  return shell('Guardian Mode', body, '/app/guardian');
}

function aiPlannerPage() {
  var body = '<div class="page-head"><span class="eyebrow">Grok-powered trip planner</span><h1>Tell us your vibe. Get a Jamaica plan.</h1><p>Answer a few quick questions. PatWaGo AI uses our Jamaica place and verified vendor catalog to build a practical itinerary you can save.</p></div>' +
    '<form id="aiPlannerForm" class="glass form-card ai-planner-form">' +
    '<div class="form-row"><div class="field"><label>Where are you staying?</label><select name="location"><option value="Jamaica">Not sure yet</option><option>Kingston</option><option>Montego Bay</option><option>Negril</option><option>Ocho Rios</option><option>Port Antonio</option></select></div><div class="field"><label>How many days?</label><input name="days" type="number" min="1" max="10" value="3" required></div></div>' +
    '<div class="field"><label>What sounds good?</label><div class="interest-grid"><label><input type="checkbox" name="interests" value="beach"> Beaches</label><label><input type="checkbox" name="interests" value="food"> Food</label><label><input type="checkbox" name="interests" value="culture"> Culture</label><label><input type="checkbox" name="interests" value="adventure"> Adventure</label><label><input type="checkbox" name="interests" value="music"> Music</label><label><input type="checkbox" name="interests" value="waterfall"> Waterfalls</label></div></div>' +
    '<div class="form-row"><div class="field"><label>Trip pace</label><select name="pace"><option value="balanced">Balanced</option><option value="relaxed">Relaxed</option><option value="adventure">Adventurous</option><option value="culture">Culture-first</option></select></div><div class="field"><label>Budget</label><select name="budget"><option value="value">Value</option><option value="moderate">Moderate</option><option value="premium">Premium</option></select></div></div>' +
    '<div class="form-row"><div class="field"><label>Who is traveling?</label><select name="group"><option>Solo</option><option>Couple</option><option>Family</option><option>Friends</option></select></div><div class="field"><label>Mobility or special needs</label><input name="mobility" placeholder="Optional"></div></div>' +
    '<button class="btn btn-gold" type="submit">Build my itinerary with AI</button></form>' +
    '<section id="aiItineraryResult" class="app-section" hidden><div class="ai-loading glass">Building your Jamaica plan…</div></section>';
  return shell('AI Itinerary', body, '/app/trips');
}

function voicePage() {
  var body = '<div class="page-head"><span class="eyebrow">PatWaGo AI voice concierge</span><h1>Ask Jamaica anything—by voice.</h1><p>Record or type a question. Your speech is transcribed in your browser, PatWaGo AI answers from our local catalog, and the full conversation stays visible.</p></div>' +
    '<div class="voice-layout"><section class="voice-console glass"><div id="voiceStatus" class="voice-status">Ready</div><button id="recordVoiceBtn" class="voice-orb" type="button" aria-label="Start recording">🎙️</button><p class="muted">Tap to start live transcription. Tap again to stop.</p><form id="voiceTextForm" class="voice-text-form"><input id="voiceTextInput" placeholder="Or type: We have 3 days near Montego Bay…" required><button class="btn btn-gold">Ask AI</button></form></section>' +
    '<section class="glass transcript-panel"><div class="transcript-head"><h2>Full transcript</h2><button id="clearTranscriptBtn" class="btn btn-ghost" type="button">Clear</button></div><div id="voiceTranscript" class="voice-transcript"><p class="muted">Your conversation will appear here.</p></div></section></div>';
  return shell('AI Voice Concierge', body, '/app/voice');
}

function adminAnalyticsPage() {
  var body = '<div class="admin-shell"><aside class="admin-sidebar"><span class="eyebrow">R&R DIGITAL</span><h1>Growth Console</h1><nav><a class="active" href="/admin/analytics">Overview</a><a href="#funnel">Conversion funnel</a><a href="#searches">Search intelligence</a><a href="#vendors">Vendor demand</a><a href="#events">Event stream</a></nav><button id="adminLogout" class="btn btn-ghost">Lock dashboard</button></aside>' +
    '<section class="admin-workspace"><div id="adminLogin" class="admin-login"><span class="eyebrow">Protected owner access</span><h2>Unlock business intelligence</h2><p>Enter the analytics access token configured on your server.</p><form id="adminLoginForm"><input id="adminToken" type="password" autocomplete="current-password" placeholder="Owner analytics token" required><button class="btn btn-gold">Unlock dashboard</button></form></div>' +
    '<div id="adminDashboard" hidden><div class="admin-title"><div><span class="eyebrow">LIVE BEHAVIORAL INTELLIGENCE</span><h2>What travelers want—and where they convert.</h2></div><select id="analyticsRange"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select></div>' +
    '<div id="analyticsKpis" class="admin-kpis"></div><section id="funnel" class="admin-section"><div class="admin-section-head"><h3>Conversion funnel</h3><span>Discovery → purchase</span></div><div id="analyticsFunnel" class="funnel-chart"></div></section>' +
    '<div class="admin-columns"><section id="searches" class="admin-section"><div class="admin-section-head"><h3>Traveler intent</h3><span>Top smart searches</span></div><div id="analyticsSearches"></div></section><section id="vendors" class="admin-section"><div class="admin-section-head"><h3>Vendor demand</h3><span>Most-viewed operators</span></div><div id="analyticsVendors"></div></section></div>' +
    '<section id="events" class="admin-section"><div class="admin-section-head"><h3>Recent event stream</h3><span>Privacy-safe behavioral events</span></div><div id="analyticsEvents" class="event-table"></div></section></div></section></div>';
  return shell('Owner Analytics', body, '', { admin: true });
}

function accountPage(state) {
  return shell('Account', '<div id="patwago-account"></div>', '', { account: true, state: state || 'onboarding' });
}

function profilePage() {
  var body =
    '<div class="page-head">\n' +
    '<span class="eyebrow">Your Profile</span>\n' +
    '<h1>Pass & account</h1>\n</div>\n' +
    '<div class="pass-card glass">\n' +
    '<div class="pass-status">\n<span class="pass-badge">Day Pass</span>\n<span class="pass-active">Active</span>\n</div>\n' +
    '<p class="muted">Full access to translation, vendors, trips, and Guardian Mode.</p>\n' +
    '<a href="/" class="btn btn-ghost">Manage pass →</a>\n' +
    '</div>\n' +
    '<section class="app-section">\n<h2>Quick links</h2>\n' +
    '<div class="quick-links">\n' +
    '<a href="/app/translate" class="link-card glass">🗣️ Translate Patois</a>\n' +
    '<a href="/app/vendors" class="link-card glass">🏪 Browse vendors</a>\n' +
    '<a href="/app/trips" class="link-card glass">🗺️ Plan a trip</a>\n' +
    '<a href="/app/guardian" class="link-card glass">🛡️ Guardian Mode</a>\n' +
    '<a href="/" class="link-card glass">← Back to landing page</a>\n' +
    '</div>\n</section>\n';

  return shell('Profile', body, '/app');
}

module.exports = {
  dashboard,
  translatePage,
  vendorsPage,
  vendorDetailPage,
  tripsPage,
  guardianPage,
  profilePage,
  aiPlannerPage,
  voicePage,
  adminAnalyticsPage,
  accountPage,
};
