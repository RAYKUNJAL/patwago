(function () {
  function toast(message, error) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var node = document.createElement('div');
    node.className = 'toast' + (error ? ' error' : '');
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 3500);
  }

  function jsonFetch(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || payload.ok === false) throw new Error(payload.message || 'Request failed');
        return payload;
      });
    });
  }

  var translateBtn = document.getElementById('translateBtn');
  var translateInput = document.getElementById('translateInput');
  var translateResult = document.getElementById('translateResult');
  if (translateBtn && translateInput && translateResult) {
    translateBtn.addEventListener('click', function () {
      var query = translateInput.value.trim();
      if (!query) return toast('Enter something to translate.', true);
      translateBtn.disabled = true;
      translateBtn.textContent = 'Translating…';
      jsonFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query, from: 'en', to: 'patois' })
      })
        .then(function (result) {
          var value = result.data && result.data.translation;
          translateResult.innerHTML = '<span class="eyebrow">Patois · AI translation</span><p class="translation-text"></p>';
          translateResult.querySelector('.translation-text').textContent = value;
        })
        .catch(function (error) {
          translateResult.innerHTML = '<p class="muted">AI translation is temporarily unavailable. Your text was not replaced with an unreliable word-for-word guess.</p>';
          toast(error.message, true);
        })
        .finally(function () { translateBtn.disabled = false; translateBtn.textContent = 'Translate →'; });
    });
    document.querySelectorAll('.phrase[data-q]').forEach(function (phrase) {
      phrase.addEventListener('click', function () {
        translateInput.value = phrase.getAttribute('data-q');
        translateBtn.click();
      });
    });
  }

  var micBtn = document.getElementById('micBtn');
  if (micBtn && translateInput) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) micBtn.style.display = 'none';
    else micBtn.addEventListener('click', function () {
      var recognition = new Recognition();
      recognition.lang = 'en-US';
      recognition.onresult = function (event) { translateInput.value = event.results[0][0].transcript; };
      recognition.onerror = function () { toast('Microphone recognition was unavailable.', true); };
      recognition.start();
    });
  }

  var vendorGrid=document.getElementById('vendorGrid'),vendorSearch=document.getElementById('vendorSearch'),vendorCategory=document.getElementById('vendorCategory'),vendorRegion=document.getElementById('vendorRegion'),vendorIntent=document.getElementById('vendorIntent'),vendorMaxPrice=document.getElementById('vendorMaxPrice'),vendorMinRating=document.getElementById('vendorMinRating'),vendorVerified=document.getElementById('vendorVerified');
  if(vendorGrid){
    var timer,smartForm=document.getElementById('smartVendorForm'),countEl=document.getElementById('vendorResultCount'),summaryEl=document.getElementById('vendorMatchSummary'),priceLabel=document.getElementById('vendorPriceLabel');
    function escHtml(s){var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML}
    function loadVendors(){
      var body={q:vendorSearch&&vendorSearch.value.trim(),intent:vendorIntent&&vendorIntent.value.trim(),category:vendorCategory&&vendorCategory.value,region:vendorRegion&&vendorRegion.value,maxPrice:vendorMaxPrice&&Number(vendorMaxPrice.value),minRating:vendorMinRating&&Number(vendorMinRating.value),verified:vendorVerified&&vendorVerified.checked};
      vendorGrid.innerHTML='<div class="vendor-skel"></div><div class="vendor-skel"></div><div class="vendor-skel"></div>';
      jsonFetch('/api/vendors/smart-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(payload){
        if(countEl)countEl.textContent=payload.meta.total+' matches';
        if(summaryEl){summaryEl.hidden=!body.intent;summaryEl.textContent=body.intent?'PatWaGo matched these vendors to “'+body.intent+'” using category, location, price, verification, and traveler ratings.':''}
        if(!payload.data.length){vendorGrid.innerHTML='<div class="empty-results"><h3>No exact match yet</h3><p>Try a wider area, higher budget, or remove a filter.</p></div>';return}
        vendorGrid.innerHTML=payload.data.map(function(v){var reasons=(v.match_reasons||[]).map(function(r){return '<span>'+escHtml(r)+'</span>'}).join('');return '<a class="vendor-card glass" data-vendor-id="'+encodeURIComponent(v.id)+'" href="/app/vendor/'+encodeURIComponent(v.id)+'">'+(v.photo_url?'<img src="'+encodeURI(v.photo_url)+'" alt="'+escHtml(v.name)+'" loading="lazy">':'')+'<div class="vendor-card-body"><div class="vendor-card-meta"><span class="eyebrow">'+escHtml(String(v.category||'').replace(/_/g,' '))+'</span><strong>From $'+Number(v.price_from||0).toFixed(0)+'</strong></div><h3>'+escHtml(v.name)+'</h3><p class="vendor-summary">'+escHtml(v.summary)+'</p><div class="vendor-rating"><span class="stars">★★★★★</span><span>'+Number(v.avg_rating||0).toFixed(1)+' · '+Number(v.review_count||0)+' reviews</span></div><p class="muted">'+escHtml(v.location_address||'Jamaica')+'</p><div class="match-reasons">'+reasons+'</div></div></a>'}).join('');
      }).catch(function(e){vendorGrid.innerHTML='<p class="muted">'+escHtml(e.message)+'</p>'})
    }
    function queue(){clearTimeout(timer);timer=setTimeout(loadVendors,220)}
    if(smartForm)smartForm.addEventListener('submit',function(e){e.preventDefault();loadVendors()});
    [vendorSearch,vendorCategory,vendorRegion,vendorMinRating,vendorVerified].forEach(function(el){if(el)el.addEventListener(el.tagName==='INPUT'?'input':'change',queue)});
    if(vendorMaxPrice)vendorMaxPrice.addEventListener('input',function(){if(priceLabel)priceLabel.textContent='$'+vendorMaxPrice.value;queue()});
    document.querySelectorAll('[data-intent]').forEach(function(btn){btn.addEventListener('click',function(){vendorIntent.value=btn.getAttribute('data-intent');loadVendors()})});
    var clear=document.getElementById('clearVendorFilters');if(clear)clear.addEventListener('click',function(){vendorSearch.value='';vendorIntent.value='';vendorCategory.value='';vendorRegion.value='';vendorMaxPrice.value='150';vendorMinRating.value='0';vendorVerified.checked=true;if(priceLabel)priceLabel.textContent='$150';loadVendors()});
    vendorGrid.addEventListener('click',function(e){var card=e.target.closest('[data-vendor-id]');if(card&&window.patwagoAnalytics)window.patwagoAnalytics.track('vendor_view',{vendor_id:card.getAttribute('data-vendor-id')})});
    loadVendors();
  }

  var googleBusinessForm = document.getElementById('googleBusinessForm');
  var googleBusinessQuery = document.getElementById('googleBusinessQuery');
  var googleBusinessResults = document.getElementById('googleBusinessResults');
  if (googleBusinessForm && googleBusinessQuery && googleBusinessResults) {
    googleBusinessForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var q = googleBusinessQuery.value.trim();
      if (!q) return toast('Enter a business, food, shop, or attraction to search.', true);
      googleBusinessResults.innerHTML = '<div class="vendor-skel"></div><div class="vendor-skel"></div><div class="vendor-skel"></div>';
      jsonFetch('/api/maps/businesses?q=' + encodeURIComponent(q) + '&region=Jamaica&limit=9')
        .then(function (payload) {
          if (!payload.data.length) {
            googleBusinessResults.innerHTML = '<div class="empty-results"><h3>No Google listing found</h3><p>Try a different area or business type.</p></div>';
            return;
          }
          googleBusinessResults.innerHTML = payload.data.map(function (p) {
            var status = p.open_now === null ? 'Hours not listed' : (p.open_now ? 'Open now' : 'May be closed');
            var photo = p.photo_url ? '<img src="' + escHtml(p.photo_url) + '" alt="' + escHtml(p.name) + '" loading="lazy">' : '';
            return '<article class="vendor-card glass">' + photo + '<div class="vendor-card-body"><div class="vendor-card-meta"><span class="eyebrow">Google Maps</span><strong>' + status + '</strong></div><h3>' + escHtml(p.name) + '</h3><p class="vendor-summary">' + escHtml(p.address) + '</p><div class="vendor-rating"><span class="stars">★★★★★</span><span>' + (p.rating || '—') + ' · ' + Number(p.user_ratings_total || 0) + ' Google reviews</span></div><div class="vendor-actions"><a class="btn btn-gold" href="' + escHtml(p.maps_url || '#') + '" target="_blank" rel="noopener">Open listing</a><a class="btn btn-ghost" href="/app/vendors?q=' + encodeURIComponent(p.name) + '">Find PatWaGo vendors</a></div></div></article>';
          }).join('');
        })
        .catch(function (error) { googleBusinessResults.innerHTML = '<p class="muted">' + escHtml(error.message) + '</p>'; });
    });
  }

  var directionsForm = document.getElementById('directionsForm');
  var directionsOrigin = document.getElementById('directionsOrigin');
  var directionsMode = document.getElementById('directionsMode');
  var directionsResult = document.getElementById('directionsResult');
  if (directionsForm && directionsOrigin && directionsResult) {
    directionsForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var origin = directionsOrigin.value.trim();
      var destination = directionsForm.getAttribute('data-destination') || '';
      var mode = directionsMode ? directionsMode.value : 'driving';
      if (!origin) return toast('Enter your starting point.', true);
      directionsResult.innerHTML = '<p class="muted">Getting Google directions…</p>';
      jsonFetch('/api/maps/directions?origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(destination) + '&mode=' + encodeURIComponent(mode))
        .then(function (payload) {
          if (!payload.data) {
            directionsResult.innerHTML = '<p class="muted">No route found. Try a more specific hotel, airport, or town.</p>';
            return;
          }
          var d = payload.data;
          var steps = (d.steps || []).slice(0, 8).map(function (step, index) {
            return '<li><strong>' + (index + 1) + '. ' + escHtml(step.instruction) + '</strong><span>' + escHtml(step.distance || '') + ' · ' + escHtml(step.duration || '') + '</span></li>';
          }).join('');
          directionsResult.innerHTML = '<div class="directions-summary"><h3>' + escHtml(d.distance || 'Route') + ' · ' + escHtml(d.duration || '') + '</h3><p class="muted">From ' + escHtml(d.origin) + ' to ' + escHtml(d.destination) + '</p><a class="btn btn-gold" href="' + escHtml(d.maps_url) + '" target="_blank" rel="noopener">Open full route in Google Maps</a></div><ol class="trip-items">' + steps + '</ol>';
        })
        .catch(function (error) { directionsResult.innerHTML = '<p class="muted">' + escHtml(error.message) + '</p>'; });
    });
  }

  function submitJson(form, url, successMessage) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var submit = form.querySelector('[type="submit"]');
      var body = Object.fromEntries(new FormData(form).entries());
      if (body.days) body.days = Number(body.days);
      if (body.hours) body.hours = Number(body.hours);
      if (body.rating) body.rating = Number(body.rating);
      submit.disabled = true;
      jsonFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function () { toast(successMessage); setTimeout(function () { location.reload(); }, 500); })
        .catch(function (error) { toast(error.message, true); submit.disabled = false; });
    });
  }

  var tripForm = document.getElementById('tripForm');
  if (tripForm) submitJson(tripForm, '/api/trips', 'Trip saved.');
  var guardianForm = document.getElementById('guardianForm');
  if (guardianForm) submitJson(guardianForm, '/api/guardian/checkins', 'Guardian check-in scheduled.');
  var reviewForm = document.getElementById('reviewForm');
  if (reviewForm) submitJson(reviewForm, '/api/reviews', 'Review submitted.');
  var safeBtn = document.getElementById('safeBtn');
  if (safeBtn) safeBtn.addEventListener('click', function () { toast('Your trusted contacts have been marked: I’m safe.'); });

  var aiPlannerForm = document.getElementById('aiPlannerForm');
  var aiItineraryResult = document.getElementById('aiItineraryResult');
  var lastProfile = null;
  var lastItinerary = null;
  if (aiPlannerForm && aiItineraryResult) {
    aiPlannerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(aiPlannerForm);
      lastProfile = Object.fromEntries(data.entries());
      lastProfile.days = Number(lastProfile.days);
      lastProfile.interests = data.getAll('interests');
      aiItineraryResult.hidden = false;
      aiItineraryResult.innerHTML = '<div class="ai-loading glass">PatWaGo AI is matching places, regions, and verified vendors…</div>';
      jsonFetch('/api/ai/itinerary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastProfile) })
        .then(function (payload) {
          lastItinerary = payload.data;
          var days = lastItinerary.days.map(function (day) {
            var stops = day.stops.map(function (stop) {
              return '<li><strong>' + stop.time + ' — ' + stop.place_name + '</strong><span>' + stop.reason + '</span></li>';
            }).join('');
            return '<article class="ai-day glass"><span class="eyebrow">Day ' + day.day + ' · ' + day.region + '</span><h3>' + day.title + '</h3><p>' + day.summary + '</p><ol>' + stops + '</ol><p class="local-tip">💡 ' + day.local_tip + '</p></article>';
          }).join('');
          aiItineraryResult.innerHTML = '<div class="itinerary-head"><div><span class="eyebrow">Built with ' + lastItinerary.model + '</span><h2>' + lastItinerary.title + '</h2><p class="muted">' + lastItinerary.overview + '</p></div><button id="saveAiTripBtn" class="btn btn-gold">Save to my trips</button></div><div class="ai-days">' + days + '</div>';
          document.getElementById('saveAiTripBtn').addEventListener('click', function () {
            jsonFetch('/api/ai/itinerary/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: lastProfile, itinerary: lastItinerary }) })
              .then(function () { toast('AI itinerary saved to your trips.'); setTimeout(function () { location.href = '/app/trips'; }, 700); })
              .catch(function (error) { toast(error.message, true); });
          });
        })
        .catch(function (error) { aiItineraryResult.innerHTML = '<div class="ai-loading glass">' + error.message + '</div>'; });
    });
  }

  var voiceForm = document.getElementById('voiceTextForm');
  var voiceInput = document.getElementById('voiceTextInput');
  var transcript = document.getElementById('voiceTranscript');
  var voiceStatus = document.getElementById('voiceStatus');
  var recordBtn = document.getElementById('recordVoiceBtn');
  var voiceSession = localStorage.getItem('patwago_voice_session') || ('voice-' + Date.now());
  localStorage.setItem('patwago_voice_session', voiceSession);
  function addTurn(role, content) {
    if (transcript.querySelector('.muted')) transcript.innerHTML = '';
    var turn = document.createElement('div');
    turn.className = 'voice-turn ' + role;
    var label = document.createElement('strong');
    label.textContent = role === 'assistant' ? 'PatWaGo AI' : 'You';
    var text = document.createElement('p');
    text.textContent = content;
    turn.appendChild(label); turn.appendChild(text); transcript.appendChild(turn);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function speak(text) {
    fetch('/api/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) })
      .then(function (response) { if (!response.ok) throw new Error('local TTS unavailable'); return response.blob(); })
      .then(function (blob) { var url = URL.createObjectURL(blob); var audio = new Audio(url); audio.onended = function () { URL.revokeObjectURL(url); }; return audio.play(); })
      .catch(function () {
        voiceStatus.textContent = 'Expressive Jamaican voice is unavailable. Text response remains below.';
      });
  }
  function askVoice(message, source) {
    addTurn('user', message); voiceStatus.textContent = 'PatWaGo AI is thinking…';
    return jsonFetch('/api/ai/concierge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: voiceSession, message: message, source: source || 'text' }) })
      .then(function (payload) { addTurn('assistant', payload.data.reply); speak(payload.data.reply); voiceStatus.textContent = 'Ready'; })
      .catch(function (error) { toast(error.message, true); voiceStatus.textContent = 'Try again'; });
  }
  if (voiceForm && voiceInput) voiceForm.addEventListener('submit', function (event) { event.preventDefault(); var message = voiceInput.value.trim(); if (!message) return; voiceInput.value = ''; askVoice(message, 'text'); });
  if (recordBtn) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = null; var listening = false; var finalText = '';
    if (Recognition) recordBtn.addEventListener('click', function () {
      if (listening && recognition) { recognition.stop(); return; }
      recognition = new Recognition(); recognition.lang = 'en-JM'; recognition.continuous = true; recognition.interimResults = true; finalText = '';
      recognition.onstart = function () { listening = true; recordBtn.classList.add('recording'); voiceStatus.textContent = 'Listening…'; };
      recognition.onresult = function (event) { var interim = ''; for (var i = event.resultIndex; i < event.results.length; i++) { if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' '; else interim += event.results[i][0].transcript; } voiceStatus.textContent = (finalText + interim).trim() || 'Listening…'; };
      recognition.onend = function () { listening = false; recordBtn.classList.remove('recording'); var message = finalText.trim(); if (message) askVoice(message, 'voice'); else voiceStatus.textContent = 'Ready'; };
      recognition.onerror = function () { listening = false; recordBtn.classList.remove('recording'); voiceStatus.textContent = 'Could not hear that. Try again.'; };
      recognition.start();
    });
    else if (navigator.mediaDevices && window.MediaRecorder) {
      var recorder = null; var chunks = [];
      recordBtn.addEventListener('click', function () {
        if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          chunks = []; recorder = new MediaRecorder(stream);
          recorder.ondataavailable = function (event) { if (event.data.size) chunks.push(event.data); };
          recorder.onstart = function () { recordBtn.classList.add('recording'); voiceStatus.textContent = 'Recording… tap again to transcribe'; };
          recorder.onstop = function () {
            recordBtn.classList.remove('recording'); voiceStatus.textContent = 'Transcribing locally…';
            stream.getTracks().forEach(function (track) { track.stop(); });
            var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })
              .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.message); return data; }); })
              .then(function (data) { if (data.text) askVoice(data.text, 'voice'); else voiceStatus.textContent = 'No speech detected.'; })
              .catch(function (error) { voiceStatus.textContent = error.message + '. Use text below.'; });
          };
          recorder.start();
        }).catch(function () { voiceStatus.textContent = 'Microphone permission was denied.'; });
      });
    } else { recordBtn.disabled = true; voiceStatus.textContent = 'Voice recording is not supported in this browser. Use text below.'; }
  }
  var clearTranscript = document.getElementById('clearTranscriptBtn');
  if (clearTranscript && transcript) clearTranscript.addEventListener('click', function () { voiceSession = 'voice-' + Date.now(); localStorage.setItem('patwago_voice_session', voiceSession); transcript.innerHTML = '<p class="muted">New conversation started.</p>'; });
})();
