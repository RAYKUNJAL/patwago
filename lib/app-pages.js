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
    { href: '/app/voice', label: 'Miss Cleo', icon: 'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z' },
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
        '<script src="/app/consent-gate.js" data-app="patwago" data-policy-version="sgi-eu-v1"></script>\n' +
        '<script src="/app/analytics.js"></script>\n' +
        '<script src="/app/app.js"></script>\n' +
        ((options && options.admin) ? '<script src="/app/admin.js"></script>\n' : '') +
        ((options && options.account) ? '<script src="/app/account-pages.js"></script><script>PatWaGoAccountPages.mount("patwago-account",{state:"' + esc(options.state || 'onboarding') + '"});</script>\n' : '') +
        '</body>\n</html>\n'
      );
    }

function dashboard() {
  var places = store.listPlaces({ limit: 4 });

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

  var body =
      '<div class="dash-hero glass">\n' +
      '<div>\n<span class="eyebrow">Welcome back</span>\n<h1>Your Jamaica trip dashboard</h1>\n' +
      '<p>Translate, book partners, plan trips, and stay safe — all in one place.</p>\n' +
      '<div id="accessBanner" class="access-banner" hidden></div>\n</div>\n' +
      '<div class="dash-stats">\n' +
      '<div class="dash-stat"><strong id="statVerifiedVendors">—</strong><span>Verified partners</span></div>\n' +
      '<div class="dash-stat"><strong id="statGoogleListings">—</strong><span>Live Google listings</span></div>\n' +
      '<div class="dash-stat"><strong id="statMyTrips">0</strong><span>Your trips</span></div>\n' +
      '<div class="dash-stat"><strong id="statMyCheckins">0</strong><span>Your check-ins</span></div>\n' +
      '</div>\n</div>\n' +
    '<div class="quick-actions">\n' +
    '<a href="/app/translate" class="qa-card glass"><div class="qa-icon">🗣️</div><span>Translate</span></a>\n' +
    '<a href="/app/vendors" class="qa-card glass"><div class="qa-icon">🏪</div><span>Vendors</span></a>\n' +
    '<a href="/app/trips" class="qa-card glass"><div class="qa-icon">🗺️</div><span>Trips</span></a>\n' +
    '<a href="/app/guardian" class="qa-card glass"><div class="qa-icon">🛡️</div><span>Safety</span></a>\n' +
    '</div>\n' +
    '<div class="quick-actions"><a href="/app/trips/new" class="qa-card glass"><div class="qa-icon">✨</div><span>AI Itinerary</span></a><a href="/app/voice" class="qa-card glass"><div class="qa-icon">🎙️</div><span>Miss Cleo</span></a></div>' +
    '<section class="app-section">\n<h2>Featured locations</h2>\n<div class="card-grid">' +
    placeCards +
    '</div>\n</section>\n' +
    '<section class="app-section">\n<h2>Top verified partners</h2>\n<div class="card-grid" id="dashPartnerVendors"><p class="muted">Loading partners…</p></div>\n' +
    '<a href="/app/vendors" class="see-all">Browse marketplace →</a>\n</section>\n' +
    '<script>(function(){function set(id,v){var el=document.getElementById(id);if(el)el.textContent=v}function showAccess(a){var b=document.getElementById("accessBanner");if(!b||!a)return;if(a.is_trial&&a.pass){b.hidden=false;b.innerHTML="<strong>Free trial active</strong> — ends "+new Date(a.pass.expires_at).toLocaleString()+". <a href=\\"/account/paywall\\">Buy a Day or Trip pass</a> before it expires."}else if(a.paid_active&&a.pass){b.hidden=false;b.innerHTML="<strong>"+String(a.pass.plan).toUpperCase()+" pass active</strong> until "+new Date(a.pass.expires_at).toLocaleString()}else if(!a.active){b.hidden=false;b.innerHTML="<strong>No active pass</strong> — <a href=\\"/account/paywall\\">Choose a pass</a> to keep full access."}}fetch("/api/account/me",{credentials:"include"}).then(function(r){return r.json()}).then(function(j){showAccess((j&&j.data&&j.data.access)||null)}).catch(function(){});fetch("/api/dashboard",{credentials:"include"}).then(function(r){return r.json()}).then(function(j){var d=(j&&j.data)||{};set("statVerifiedVendors",d.verified_vendors||d.vendors||0);set("statGoogleListings",d.google_listings||0);set("statMyTrips",d.trips||0);set("statMyCheckins",d.checkins||0)}).catch(function(){});fetch("/api/vendors?limit=6",{credentials:"include"}).then(function(r){return r.json()}).then(function(j){var box=document.getElementById("dashPartnerVendors");if(!box)return;var rows=(j&&j.data)||[];if(!rows.length){box.innerHTML="<p class=\\"muted\\">No verified partners yet. Open Vendors for live Google listings — partners who sign up get promoted higher once verified.</p>";return}box.innerHTML=rows.map(function(v){var badge=v.verified?"Verified partner":"Partner";return "<a href=\\"/app/vendor/"+encodeURIComponent(v.id)+"\\" class=\\"mini-card glass\\"><div class=\\"mini-photo mini-photo-fallback\\">"+(v.name||"?").charAt(0)+"</div><div class=\\"mini-body\\"><h4>"+String(v.name||"Vendor").replace(/[<>&]/g,"")+"</h4><p>"+badge+(v.location_address?" · "+String(v.location_address).replace(/[<>&]/g,""):"")+"</p></div></a>"}).join("")}).catch(function(){var box=document.getElementById("dashPartnerVendors");if(box)box.innerHTML="<p class=\\"muted\\">Could not load partners.</p>"});try{var pending=localStorage.getItem("patwago_pending_order");if(pending){fetch("/api/account/claim-order",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:pending})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){localStorage.removeItem("patwago_pending_order");var b=document.getElementById("accessBanner");if(b){b.hidden=false;b.innerHTML="<strong>Payment linked</strong> — your pass is active."}}}).catch(function(){})}}catch(e){}})()</script>';

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
    '<span class="eyebrow">Jamaica marketplace</span>' +
    '<h1>Live local listings + verified PatWaGo partners.</h1>' +
    '<p>Browse real Google Maps businesses across Jamaica. PatWaGo partners who sign up are verified and promoted to the top of results.</p>' +
    '<form id="smartVendorForm" class="smart-search-bar"><input id="vendorIntent" name="intent" placeholder="Try: beach adventure in Negril under $60" autocomplete="off"><button class="btn btn-gold" type="submit">Smart search</button></form>' +
    '<div class="intent-chips"><button data-intent="airport taxi in Montego Bay">Airport taxi</button><button data-intent="waterfall adventure near Ocho Rios">Waterfalls</button><button data-intent="relaxed beach activity in Negril">Beach day</button><button data-intent="culture and music in Kingston">Culture</button></div></div>' +
    '<div class="vendor-filter-layout"><aside class="vendor-filters"><div class="filter-heading"><strong>Refine results</strong><button id="clearVendorFilters" type="button">Clear</button></div>' +
    '<label>Search by name<input type="search" id="vendorSearch" placeholder="Vendor or activity"></label>' +
    '<label>Category<select id="vendorCategory"><option value="">All categories</option><option value="food">Food</option><option value="water_sports">Water Sports</option><option value="tours">Tours</option><option value="adventure">Adventure</option><option value="transport">Transport</option><option value="lodging">Lodging</option><option value="beauty">Beauty</option><option value="crafts">Crafts</option></select></label>' +
    '<label>Area<select id="vendorRegion"><option value="">Anywhere in Jamaica</option><option>Kingston</option><option>Montego Bay</option><option>Negril</option><option>Ocho Rios</option><option>Port Antonio</option></select></label>' +
    '<label>Maximum price <strong id="vendorPriceLabel">$150</strong><input type="range" id="vendorMaxPrice" min="20" max="200" value="150" step="5"></label>' +
    '<label>Minimum rating<select id="vendorMinRating"><option value="0">Any rating</option><option value="4">4.0+</option><option value="4.5">4.5+</option><option value="4.7">4.7+</option></select></label>' +
    '<label class="verified-toggle"><input type="checkbox" id="vendorVerified"> Verified PatWaGo partners only</label></aside>' +
    '<section class="vendor-results"><div class="vendor-results-head"><div><span class="eyebrow">Smart matches</span><h2 id="vendorResultTitle">Recommended for you</h2></div><span id="vendorResultCount">Loading…</span></div><div id="vendorMatchSummary" class="match-summary" hidden></div>' +
    '<div id="vendorGrid" class="vendor-grid"><div class="vendor-skel"></div><div class="vendor-skel"></div><div class="vendor-skel"></div></div></section></div>';
  body += '<section class="app-section google-businesses glass"><div class="vendor-results-head"><div><span class="eyebrow">Live Google business listings</span><h2>Restaurants, shops, attractions, and services</h2></div></div>' +
    '<form id="googleBusinessForm" class="smart-search-bar"><input id="googleBusinessQuery" placeholder="Try: jerk chicken near Negril, pharmacy Montego Bay, rafting Martha Brae" value="jerk chicken Negril"><button class="btn btn-gold">Search Google Maps</button></form>' +
    '<div id="googleBusinessResults" class="vendor-grid"><div class="vendor-skel"></div><div class="vendor-skel"></div><div class="vendor-skel"></div></div></section>';
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
    '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(vendor.location_address || vendor.name + ' Jamaica') + '" class="btn btn-ghost" target="_blank" rel="noopener">Open in Google Maps</a>\n' +
    '<a href="tel:+18765550000" class="btn btn-ghost">Call</a>\n' +
    '</div>\n' +
    '</div>\n' +
    '<section class="app-section directions-panel glass"><span class="eyebrow">Real Google directions</span><h2>Get directions to ' + esc(vendor.name) + '</h2>' +
    '<form id="directionsForm" class="smart-search-bar" data-destination="' + esc(vendor.location_address || vendor.name + ' Jamaica') + '"><input id="directionsOrigin" placeholder="Your hotel, airport, or current town"><select id="directionsMode"><option value="driving">Driving</option><option value="walking">Walking</option><option value="transit">Transit</option></select><button class="btn btn-gold">Get directions</button></form>' +
    '<div id="directionsResult"><p class="muted">Enter where you are starting from to get real route distance, time, and turn-by-turn steps.</p></div></section>' +
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
    '<section class="app-section ai-callout glass"><div class="miss-cleo-inline"><img src="/images/miss-cleo-avatar-sm.png" alt="Miss Cleo" width="40" height="40"><div><span class="eyebrow">Miss Cleo</span><h2>Not sure where to go?</h2></div></div><p class="muted">Answer a short questionnaire and let Miss Cleo build the route around your interests.</p><a class="btn btn-gold" href="/app/trips/new">Build an AI itinerary</a></section>' +
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
  var body = '<div class="page-head"><div class="miss-cleo-inline" style="justify-content:flex-start;margin-bottom:12px"><img src="/images/miss-cleo-avatar-sm.png" alt="Miss Cleo" width="40" height="40"><div><span class="eyebrow">Miss Cleo · trip planner</span></div></div><h1>Tell us your vibe. Get a Jamaica plan.</h1><p>Answer a few quick questions. Miss Cleo uses our Jamaica place and verified vendor catalog to build a practical itinerary you can save.</p></div>' +
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
  var body = '<div class="page-head miss-cleo-hero">' +
    '<div class="miss-cleo-hero-card glass">' +
    '<img class="miss-cleo-hero-avatar" src="/images/miss-cleo-avatar.png" alt="Miss Cleo" width="88" height="88" loading="eager">' +
    '<div><span class="eyebrow">Miss Cleo · voice guide</span><h1>Ask Jamaica anything.</h1><p>Miss Cleo answers from our local catalog. Record or type a question — full conversation stays visible.</p></div>' +
    '</div></div>' +
    '<div class="voice-layout"><section class="voice-console glass"><div class="miss-cleo-inline"><img src="/images/miss-cleo-avatar-sm.png" alt="Miss Cleo" width="36" height="36"><div><strong>Miss Cleo</strong><span>Ready when you are</span></div></div><div id="voiceStatus" class="voice-status">Ready</div><button id="recordVoiceBtn" class="voice-orb" type="button" aria-label="Start recording">🎙️</button><p class="muted">Tap to start live transcription. Tap again to stop.</p><form id="voiceTextForm" class="voice-text-form"><input id="voiceTextInput" placeholder="Or type: We have 3 days near Montego Bay…" required><button class="btn btn-gold">Ask Miss Cleo</button></form></section>' +
    '<section class="glass transcript-panel"><div class="transcript-head"><h2>Chat with Miss Cleo</h2><button id="clearTranscriptBtn" class="btn btn-ghost" type="button">Clear</button></div><div id="voiceTranscript" class="voice-transcript"><p class="muted">Your conversation will appear here.</p></div></section></div>';
  return shell('Miss Cleo', body, '/app/voice');
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
    '<div class="pass-card glass" id="profilePassCard">\n' +
    '<div class="pass-status">\n<span class="pass-badge" id="profilePassPlan">Checking…</span>\n<span class="pass-active" id="profilePassState">—</span>\n</div>\n' +
    '<p class="muted" id="profilePassDetail">Loading your access…</p>\n' +
    '<a href="/account/paywall" class="btn btn-gold">Buy or renew pass →</a>\n' +
    '<a href="/support" class="btn btn-ghost">Help & refunds</a>\n' +
    '</div>\n' +
    '<section class="app-section">\n<h2>Quick links</h2>\n' +
    '<div class="quick-links">\n' +
    '<a href="/app/translate" class="link-card glass">🗣️ Translate Patois</a>\n' +
    '<a href="/app/vendors" class="link-card glass">🏪 Browse vendors</a>\n' +
    '<a href="/app/trips" class="link-card glass">🗺️ Plan a trip</a>\n' +
    '<a href="/app/guardian" class="link-card glass">🛡️ Guardian Mode</a>\n' +
    '<a href="/support" class="link-card glass">🛟 Support</a>\n' +
    '<a href="/" class="link-card glass">← Back to landing page</a>\n' +
    '</div>\n</section>\n' +
    '<script>(function(){fetch("/api/account/me",{credentials:"include"}).then(function(r){return r.json()}).then(function(j){var a=(j&&j.data&&j.data.access)||{};var plan=document.getElementById("profilePassPlan");var st=document.getElementById("profilePassState");var d=document.getElementById("profilePassDetail");if(!plan)return;if(a.pass){plan.textContent=(a.is_trial?"Trial":String(a.pass.plan).toUpperCase())+" pass";st.textContent="Active";d.textContent="Access until "+new Date(a.pass.expires_at).toLocaleString()+(a.is_trial?". Buy a paid pass before trial ends.":".")}else{plan.textContent="No pass";st.textContent="Inactive";d.textContent="Choose a Day or Trip pass to unlock the full app."}}).catch(function(){})})()</script>';

  return shell('Profile', body, '/app');
}

function supportPage() {
  var body =
    '<div class="page-head"><span class="eyebrow">Support</span><h1>Help, payments & refunds</h1>' +
    '<p class="muted">Fast answers for travelers. For emergencies in Jamaica call local services first — PatWaGo is not emergency dispatch.</p></div>' +
    '<section class="app-section glass" style="padding:22px;margin-bottom:16px"><h2>I paid but can\'t open the app</h2>' +
    '<ol style="color:#b7b7ad;line-height:1.6"><li>Sign in with the same email you used after PayPal.</li>' +
    '<li>Open this page or Dashboard — we auto-claim a pending PayPal order saved in your browser.</li>' +
    '<li>Still stuck? Email <a href="mailto:bookings@patwago.com">bookings@patwago.com</a> with your PayPal transaction ID / order id.</li></ol>' +
    '<form id="claimOrderForm" class="smart-search-bar" style="margin-top:12px"><input id="claimOrderId" placeholder="PayPal order id (e.g. 9YA26…)" required><button class="btn btn-gold" type="submit">Link payment to my account</button></form>' +
    '<p id="claimOrderMsg" class="muted" style="margin-top:10px"></p></section>' +
    '<section class="app-section glass" style="padding:22px;margin-bottom:16px"><h2>Refunds</h2>' +
    '<p class="muted">Day and Trip passes: email <a href="mailto:bookings@patwago.com">bookings@patwago.com</a> within 24 hours of purchase if you could not access the product due to a platform fault. Approved refunds are returned to the original PayPal method. Vendor bookings may have separate vendor policies.</p></section>' +
    '<section class="app-section glass" style="padding:22px;margin-bottom:16px"><h2>Privacy & EU data consent</h2>' +
    '<p class="muted">Withdraw consent by clearing site data for patwago.com or emailing <a href="mailto:privacy@patwago.com">privacy@patwago.com</a>. AI features stay off until you accept AI processing again.</p></section>' +
    '<section class="app-section glass" style="padding:22px"><h2>Contact</h2>' +
    '<p>Travelers: <a href="mailto:bookings@patwago.com">bookings@patwago.com</a><br>Vendors: <a href="mailto:vendors@patwago.com">vendors@patwago.com</a><br>Privacy: <a href="mailto:privacy@patwago.com">privacy@patwago.com</a></p></section>' +
    '<script>(function(){var f=document.getElementById("claimOrderForm");if(!f)return;f.addEventListener("submit",function(e){e.preventDefault();var id=document.getElementById("claimOrderId").value.trim();var msg=document.getElementById("claimOrderMsg");msg.textContent="Linking…";fetch("/api/account/claim-order",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:id})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(res){if(!res.ok||!res.j.ok)throw new Error((res.j&&res.j.message)||"Could not link payment");msg.textContent="Pass activated. Opening app…";try{localStorage.removeItem("patwago_pending_order")}catch(e){}setTimeout(function(){location.href="/app"},800)}).catch(function(err){msg.textContent=err.message||"Failed"})})}())</script>';
  return shell('Support', body, '/app/profile');
}

module.exports = {
  dashboard,
  translatePage,
  vendorsPage,
  vendorDetailPage,
  tripsPage,
  guardianPage,
  profilePage,
  supportPage,
  aiPlannerPage,
  voicePage,
  adminAnalyticsPage,
  accountPage,
};
