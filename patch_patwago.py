#!/usr/bin/env python3
"""Patch /opt/patwago/web/index.html on trini for PatWaGo landing fixes."""
import sys, re, html

PATH = "/opt/patwago/web/index.html"

with open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

orig_len = len(src)
report = []

def must_replace(label, old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        report.append(f"FAIL [{label}]: expected {count} match(es), found {n}")
        return False
    src = src.replace(old, new, 1) if count == 1 else src.replace(old, new)
    report.append(f"OK   [{label}]")
    return True

# ---------------------------------------------------------------------------
# PATCH 1: Add Leaflet CSS + JS to <head> (for vendor map, no API key needed)
# ---------------------------------------------------------------------------
must_replace("leaflet-css",
'  html{scroll-behavior:auto}\n}\n</style>',
'  html{scroll-behavior:auto}\n}\n'
'/* ---------- CHAT LAYOUT FIX ---------- */\n'
'#chatBubbles{position:absolute;top:86px;left:0;right:0;bottom:100px;overflow-y:auto;'
'padding:2px 4px 10px;scrollbar-width:thin;scrollbar-color:rgba(255,215,0,0.25) transparent}\n'
'#chatBubbles::-webkit-scrollbar{width:4px}\n'
'#chatBubbles::-webkit-scrollbar-track{background:transparent}\n'
'#chatBubbles::-webkit-scrollbar-thumb{background:rgba(255,215,0,0.25);border-radius:2px}\n'
'.ts-bubble{display:flex;flex-direction:column;gap:2px}\n'
'.ts-bubble .bubble-row{display:flex;align-items:center;gap:8px}\n'
'.ts-bubble .bubble-row .btext{flex:1}\n'
'.spk-btn{flex-shrink:0;width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,215,0,0.3);'
'background:rgba(255,215,0,0.08);color:var(--gold);cursor:pointer;display:flex;align-items:center;'
'justify-content:center;padding:0;transition:background .2s,border-color .2s,transform .15s}\n'
'.spk-btn:hover{background:rgba(255,215,0,0.18);border-color:var(--gold);transform:scale(1.1)}\n'
'.spk-btn:disabled{opacity:0.4;cursor:wait}\n'
'.spk-btn svg{width:13px;height:13px}\n'
'.spk-btn .spin{display:none;width:13px;height:13px;border:2px solid rgba(255,215,0,0.3);'
'border-top-color:var(--gold);border-radius:50%;animation:spin 0.7s linear infinite}\n'
'.spk-btn.loading svg{display:none}\n'
'.spk-btn.loading .spin{display:block}\n'
'@keyframes spin{to{transform:rotate(360deg)}}\n'
'/* ---------- PAIN POINTS ---------- */\n'
'.painpoints{padding:90px 0 40px}\n'
'.pain-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}\n'
'.pain-card{padding:28px 22px;position:relative;overflow:hidden}\n'
'.pain-card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;'
'background:linear-gradient(90deg,var(--gold),transparent);opacity:0.5}\n'
'.pain-icon{width:50px;height:50px;border-radius:14px;display:flex;align-items:center;justify-content:center;'
'background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.25);margin-bottom:18px}\n'
'.pain-icon svg{width:26px;height:26px;color:var(--gold)}\n'
'.pain-card h3{font-size:18px;margin-bottom:8px;color:var(--text);line-height:1.2}\n'
'.pain-card p{font-size:14px;color:var(--text-muted);line-height:1.5}\n'
'.pain-card .pain-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.08em;'
'text-transform:uppercase;color:var(--gold);margin-bottom:10px}\n'
'/* ---------- MAP SECTION ---------- */\n'
'.map-section{padding:80px 0}\n'
'#vendorMap{height:480px;border-radius:14px;background:#0F0F0F;z-index:1}\n'
'.leaflet-container{background:#0F0F0F}\n'
'.map-legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;justify-content:center}\n'
'.map-legend .lg-chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);'
'padding:6px 14px;border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)}\n'
'.map-legend .lg-dot{width:10px;height:10px;border-radius:50%;background:var(--gold)}\n'
'/* ---------- MOBILE FIXES ---------- */\n'
'@media (max-width:820px){\n'
'  .pain-grid{grid-template-columns:repeat(2,1fr)}\n'
'  .ts-title{font-size:16px}\n'
'  .ts-sub{font-size:10px}\n'
'  .ts-bubble{font-size:12px}\n'
'  #chatBubbles{top:78px;bottom:92px}\n'
'}\n'
'@media (max-width:560px){\n'
'  .pain-grid{grid-template-columns:1fr}\n'
'  .ts-title{font-size:15px}\n'
'  .ts-header{padding:6px 14px 10px}\n'
'  .ts-bubble{margin:0 14px 10px;font-size:11.5px;max-width:88%}\n'
'  #chatBubbles{top:74px;bottom:88px}\n'
'  #vendorMap{height:340px}\n'
'}\n'
'</style>\n'
'<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"\n'
'  integrity="sha256-p4NxAoJBhIIN+hmNHrzVCf8U8s0Z7Xa3K8lN7P2vc=" crossorigin="" />\n'
'<link rel="preconnect" href="https://unpkg.com" />')

# ---------------------------------------------------------------------------
# PATCH 2: Remove app store buttons in hero -> "Try the Live Demo"
# ---------------------------------------------------------------------------
old_ctas = '''      <div class="hero-ctas">
        <a href="https://apps.apple.com/app/patwago" target="_blank" rel="noopener" class="store-badge" aria-label="Download on the App Store">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.82 0-2.07-.92-3.41-.89-1.75.03-3.38 1.02-4.28 2.58-1.83 3.17-.47 7.86 1.31 10.43.87 1.26 1.91 2.67 3.27 2.62 1.32-.05 1.82-.85 3.41-.85 1.59 0 2.04.85 3.43.82 1.42-.02 2.31-1.28 3.18-2.55 1-1.47 1.42-2.9 1.44-2.97-.03-.01-2.76-1.06-2.79-4.2zM14.5 4.5c.72-.88 1.21-2.1 1.08-3.31-1.04.04-2.31.7-3.06 1.57-.67.77-1.26 2.01-1.1 3.2 1.16.09 2.35-.59 3.08-1.46z"/></svg>
          <span><span class="sb-small">Download on the</span><span class="sb-big">App Store</span></span>
        </a>
        <a href="https://play.google.com/store/apps/details?id=com.patwago.app" target="_blank" rel="noopener" class="store-badge" aria-label="Get it on Google Play">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.6 2.3c-.36.36-.6.92-.6 1.66v18.08c0 .74.24 1.3.62 1.66L13.2 14.1 3.6 2.3zm10.7 12.9l2.5 2.5-9.4 5.4c-.46.26-.9.32-1.3.16l8.2-8.06zm6.1-3.5c.64.45.64 1.55 0 2l-2.9 1.66-2.8-2.8 2.8-2.8 2.9 1.94zM13.3 11.2l-8.2-8.06c.4-.16.84-.1 1.3.16l9.4 5.4-2.5 2.5z"/></svg>
          <span><span class="sb-small">Get it on</span><span class="sb-big">Google Play</span></span>
        </a>
      </div>'''

new_ctas = '''      <div class="hero-ctas">
        <a href="#translator" class="btn btn-gold" aria-label="Try the live translator demo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          Try the Live Demo
        </a>
        <a href="#pricing" class="btn btn-ghost">Start free trial</a>
      </div>'''

must_replace("hero-ctas", old_ctas, new_ctas)

# ---------------------------------------------------------------------------
# PATCH 3: Add id="translator" to phone-wrap div
# ---------------------------------------------------------------------------
must_replace("phone-wrap-id",
'<div class="phone-wrap fade">',
'<div class="phone-wrap fade" id="translator">')

# ---------------------------------------------------------------------------
# PATCH 4: Remove "Open in app" buttons in pricing (2 occurrences)
# ---------------------------------------------------------------------------
must_replace("pricing-openinapp-1",
'        <a href="https://apps.apple.com/app/patwago" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:10px">Open in app</a>\n',
'')
must_replace("pricing-openinapp-2",
'        <a href="https://apps.apple.com/app/patwago" target="_blank" rel="noopener" class="btn btn-gold" style="margin-top:10px">Open in app</a>\n',
'')

# ---------------------------------------------------------------------------
# PATCH 5: Fix "Download PatWaGo" step text (step 1 mentions app stores)
# ---------------------------------------------------------------------------
must_replace("step1-text",
'<h3>Download PatWaGo</h3>\n        <p>Grab the app on the App Store or Google Play. It\'s free to install and takes seconds.</p>',
'<h3>Try the live demo</h3>\n        <p>Use the translator demo right here in your browser — no download needed. Speak English, hear Patois back instantly.</p>')

# ---------------------------------------------------------------------------
# PATCH 6: Add "Why PatWaGo?" pain points section after hero </header>
# ---------------------------------------------------------------------------
pain_section = '''
<!-- WHY PATWAGO - PAIN POINTS -->
<section class="painpoints" id="why">
  <div class="wrap">
    <div class="section-head fade">
      <span class="eyebrow">Why PatWaGo?</span>
      <h2>Jamaica is amazing. The tourist traps aren\'t.</h2>
      <p>Every traveller hits the same walls. PatWaGo removes them — so you explore like a local from day one.</p>
    </div>
    <div class="pain-grid">
      <div class="pain-card glass fade">
        <div class="pain-tag">Problem</div>
        <div class="pain-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </div>
        <h3>Harassed by vendors</h3>
        <p>Verified vendors only. No hustlers, no scams. Every listing is checked and rated by real travellers.</p>
      </div>
      <div class="pain-card glass fade">
        <div class="pain-tag">Problem</div>
        <div class="pain-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <h3>Taxi price scams</h3>
        <p>Fixed fair prices. Know before you go. No surprise charges, no "tourist rate" — just honest, upfront pricing.</p>
      </div>
      <div class="pain-card glass fade">
        <div class="pain-tag">Problem</div>
        <div class="pain-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </div>
        <h3>Can\'t understand Patois</h3>
        <p>Real-time voice translation. Speak English, hear Patois. Connect with locals without missing a beat.</p>
      </div>
      <div class="pain-card glass fade">
        <div class="pain-tag">Problem</div>
        <div class="pain-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h3>Is it safe here?</h3>
        <p>Live safety alerts. Know which areas to avoid. Real-time updates so you explore with confidence.</p>
      </div>
    </div>
  </div>
</section>

'''

must_replace("pain-section-insert",
'</header>\n\n<!-- FEATURES -->',
'</header>\n' + pain_section + '<!-- FEATURES -->')

# ---------------------------------------------------------------------------
# PATCH 7: Add map section after vendors </section>
# ---------------------------------------------------------------------------
map_section = '''
<!-- VENDOR MAP -->
<section class="map-section" id="map">
  <div class="wrap">
    <div class="section-head fade">
      <span class="eyebrow">Vendor map</span>
      <h2>Find verified vendors across Jamaica</h2>
      <p>Real vendors, real locations. Tap a pin to see name, category and rating.</p>
    </div>
    <div class="glass fade" style="padding:8px;overflow:hidden">
      <div id="vendorMap"></div>
    </div>
    <div class="map-legend fade">
      <span class="lg-chip"><span class="lg-dot"></span> Verified vendor</span>
      <span class="lg-chip">Pin color: gold = top rated</span>
    </div>
  </div>
</section>

'''

# Insert after the vendors section closes, before vendor-signup
must_replace("map-section-insert",
'<!-- VENDOR SIGNUP -->',
map_section + '<!-- VENDOR SIGNUP -->')

# ---------------------------------------------------------------------------
# PATCH 8: Rewrite the voice demo JS block to use TTS endpoint + speaker buttons
# ---------------------------------------------------------------------------
# Find the voice button block and replace it entirely.
voice_start_marker = "/* ---------- Voice button: Web Speech API (SpeechRecognition) ---------- */"
paypal_marker = "/* ---------- PayPal checkout buttons ---------- */"

vi = src.find(voice_start_marker)
pi = src.find(paypal_marker)
if vi == -1 or pi == -1:
    report.append("FAIL [voice-js]: markers not found")
else:
    new_voice_js = '''/* ---------- Voice demo: SpeechRecognition + TTS audio playback ---------- */
(function(){
  var micBtn=document.getElementById('micBtn');
  var status=document.getElementById('micStatus');
  var chat=document.getElementById('chatBubbles');
  if(!micBtn||!chat)return;

  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  var recog=null,listening=false;
  var audioCache={};   // text -> {url}  (object URLs for replay)
  var currentAudio=null;

  // Lightweight English->Patois phrase map for the in-page demo. The real
  // translation runs server-side via /api/lexicon/translate; this is a showpiece.
  var PATOIS=[
    [/where can i get/gi,'weh mi can get'],
    [/where can i find/gi,'weh mi can find'],
    [/how much (is|does|are)/gi,'how much dis'],
    [/is it open now/gi,'im open now'],
    [/what time/gi,'wahtaim'],
    [/thank you/gi,'tanks mon'],
    [/good morning/gi,'good mawnin'],
    [/good night/gi,'good nite'],
    [/i want to go/gi,'mi waah go'],
    [/i would like/gi,'mi would like'],
    [/can you help me/gi,'yuh can help mi'],
    [/how are you/gi,'how yuh deh'],
    [/what is your name/gi,'wah yuh name'],
    [/my name is/gi,'mi name is'],
    [/please/gi,'please'],
    [/(^|\\s)yes(\\s|$)/gi,'$1yeah man$2'],
    [/(^|\\s)no(\\s|$)/gi,'$1no mon$2'],
    [/beach/gi,'beach'],
    [/food/gi,'nyam'],
    [/(^|\\s)eat(\\s|$)/gi,'$1nyam$2'],
    [/money/gi,'chetta'],
    [/friend/gi,'fren'],
    [/crazy/gi,'bumbaclot'],
    [/very good/gi,'tun up'],
    [/let's go/gi,'mek wi go'],
    [/where is/gi,'weh deh']
  ];
  function toPatois(text){
    var t=text;
    PATOIS.forEach(function(p){t=t.replace(p[0],p[1])});
    if(t===text){ // no rule matched - apply a light accent fallback
      t=text.replace(/\\b(the|a|an)\\b/gi,'').replace(/\\b(is|are)\\b/gi,'deh');
    }
    return t.charAt(0).toUpperCase()+t.slice(1);
  }

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

  function speakerSVG(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'}

  function addBubble(cls,label,text,withSpeaker){
    var div=document.createElement('div');
    div.className='ts-bubble '+cls;
    if(cls==='them'&&withSpeaker){
      div.innerHTML='<span class="lbl">'+esc(label)+'</span>'
        +'<div class="bubble-row"><span class="btext">'+esc(text)+'</span>'
        +'<button class="spk-btn" data-text="'+esc(text)+'" title="Play audio" aria-label="Play audio">'
        +speakerSVG()+'<span class="spin"></span></button></div>';
    }else{
      div.innerHTML='<span class="lbl">'+esc(label)+'</span>'+esc(text);
    }
    chat.appendChild(div);
    // keep only last 8 bubbles
    while(chat.children.length>8){chat.removeChild(chat.firstChild)}
    // scroll to bottom
    chat.scrollTop=chat.scrollHeight;
    return div;
  }

  function stopCurrentAudio(){
    if(currentAudio){try{currentAudio.pause()}catch(e){}currentAudio=null}
  }

  // Fetch TTS mp3, cache it, and play it. Returns a promise.
  function fetchAndPlayTTS(text,btn){
    var key=text.trim().toLowerCase();
    if(audioCache[key]&&audioCache[key].url){
      playURL(audioCache[key].url);
      return Promise.resolve();
    }
    if(btn){btn.classList.add('loading');btn.disabled=true}
    return fetch('/api/voice/demo-tts',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:text})
    }).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.blob();
    }).then(function(blob){
      var url=URL.createObjectURL(blob);
      audioCache[key]={url:url};
      playURL(url);
    }).catch(function(err){
      console.warn('[PatWaGo TTS] failed:',err);
      // fallback to browser speech synthesis
      try{if('speechSynthesis' in window){var u=new SpeechSynthesisUtterance(text);u.lang='en-JM';u.rate=0.95;speechSynthesis.speak(u)}}catch(e){}
    }).finally(function(){
      if(btn){btn.classList.remove('loading');btn.disabled=false}
    });
  }

  function playURL(url){
    stopCurrentAudio();
    var a=new Audio(url);
    currentAudio=a;
    a.play().catch(function(e){console.warn('[PatWaGo] audio play blocked:',e)});
    a.onended=function(){currentAudio=null};
  }

  // Wire up speaker buttons (event delegation)
  chat.addEventListener('click',function(e){
    var btn=e.target.closest('.spk-btn');
    if(!btn)return;
    var text=btn.getAttribute('data-text');
    if(!text)return;
    stopCurrentAudio();
    fetchAndPlayTTS(text,btn);
  });

  function setStatus(msg,show){status.textContent=msg||'';if(show!==false){status.classList.add('show')}else{status.classList.remove('show')}}

  function startRecog(){
    if(!SR){setStatus('Voice input not supported in this browser',true);return}
    recog=new SR();
    recog.lang='en-US';
    recog.interimResults=true;
    recog.continuous=false;
    recog.onstart=function(){listening=true;micBtn.classList.add('listening');setStatus('Listening\\u2026 speak now',true)};
    recog.onerror=function(e){
      listening=false;micBtn.classList.remove('listening');
      var msg='Microphone error';
      if(e.error==='not-allowed'||e.error==='permission-denied'){msg='Mic access denied \\u2014 allow microphone permission'}
      else if(e.error==='no-speech'){msg='No speech detected \\u2014 try again'}
      else if(e.error==='network'){msg='Network error during recognition'}
      else{msg='Error: '+e.error}
      setStatus(msg,true);
    };
    recog.onend=function(){listening=false;micBtn.classList.remove('listening');if(status.textContent==='Listening\\u2026 speak now'){setStatus('Tap mic, then speak',true)}};
    recog.onresult=function(ev){
      var interim='',finalT='';
      for(var i=ev.resultIndex;i<ev.results.length;i++){
        var r=ev.results[i];
        if(r.isFinal){finalT+=r[0].transcript}else{interim+=r[0].transcript}
      }
      if(interim){setStatus('\\u2026 '+interim.slice(0,60),true)}
      if(finalT){
        var spoken=finalT.trim();
        addBubble('me','You \\u00b7 English',spoken,false);
        var patois=toPatois(spoken);
        setStatus('Translating\\u2026',true);
        setTimeout(function(){
          var bub=addBubble('them','PatWaGo \\u00b7 Patois',patois,true);
          setStatus('Tap mic, then speak',true);
          // auto-play TTS audio of the Patois translation
          var btn=bub.querySelector('.spk-btn');
          fetchAndPlayTTS(patois,btn);
        },400);
      }
    };
    try{recog.start()}catch(e){setStatus('Could not start mic',true)}
  }
  function stopRecog(){if(recog){try{recog.stop()}catch(e){}}listening=false;micBtn.classList.remove('listening')}

  micBtn.addEventListener('click',function(){
    if(listening){stopRecog()}else{stopCurrentAudio();startRecog()}
  });
  if(!SR){
    micBtn.addEventListener('click',function(){setStatus('Your browser does not support voice input (try Chrome/Edge)',true)},{once:true});
  }
  setStatus('Tap mic, then speak',true);

  // Enhance the existing static "them" bubbles with speaker buttons
  Array.prototype.forEach.call(chat.querySelectorAll('.ts-bubble.them'),function(b){
    if(b.querySelector('.spk-btn'))return; // already has one
    var txtNode=b.querySelector('.lbl');
    var text=txtNode?txtNode.nextSibling&&txtNode.nextSibling.nodeValue?txtNode.nextSibling.nodeValue.trim():'':'';
    if(!text)return;
    // wrap existing text in bubble-row with a speaker button
    var lbl=b.querySelector('.lbl');
    var raw=b.innerHTML;
    // extract label + text
    var m=raw.match(/<span class="lbl">([\s\S]*?)<\/span>([\s\S]*)$/);
    if(!m)return;
    var label=m[1],text2=m[2].trim();
    b.innerHTML='<span class="lbl">'+label+'</span>'
      +'<div class="bubble-row"><span class="btext">'+esc(text2)+'</span>'
      +'<button class="spk-btn" data-text="'+esc(text2)+'" title="Play audio" aria-label="Play audio">'
      +speakerSVG()+'<span class="spin"></span></button></div>';
  });
})();

'''
    src = src[:vi] + new_voice_js + src[pi:]
    report.append("OK   [voice-js-rewrite]")

# ---------------------------------------------------------------------------
# PATCH 9: Add Leaflet JS + map init script before </script></body>
# ---------------------------------------------------------------------------
map_js = '''
/* ---------- Vendor map (Leaflet + OpenStreetMap, no API key) ---------- */
(function(){
  var mapEl=document.getElementById('vendorMap');
  if(!mapEl)return;
  var CAT_LABELS={water_sports:'Water Sports',tours:'Tours',food:'Food',adventure:'Adventure',transport:'Transport',beauty:'Beauty',crafts:'Crafts',lodging:'Lodging'};

  // Lazy-load Leaflet JS then init
  function loadScript(src,cb){
    var s=document.createElement('script');
    s.src=src;s.crossOrigin='';
    s.onload=cb;s.onerror=function(){mapEl.innerHTML='<p class="muted" style="display:flex;align-items:center;justify-content:center;height:100%">Map failed to load.</p>'};
    document.head.appendChild(s);
  }

  function initMap(){
    if(!window.L){mapEl.innerHTML='<p class="muted" style="display:flex;align-items:center;justify-content:center;height:100%">Map unavailable.</p>';return}
    // Center on Jamaica
    var map=L.map('vendorMap',{scrollWheelZoom:false,zoomControl:true}).setView([18.2,-77.3],8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:18,
      attribution:'&copy; OpenStreetMap',
      subdomains:'a b c'.split(' ')
    }).addTo(map);

    var goldIcon=L.divIcon({className:'',html:
      '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#FFD700;border:2px solid #0A0A0A;'
      'transform:rotate(-45deg);box-shadow:0 2px 8px rgba(255,215,0,0.6)"></div>',
      iconSize:[18,18],iconAnchor:[9,18],popupAnchor:[0,-18]});

    var greenIcon=L.divIcon({className:'',html:
      '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#40916C;border:2px solid #0A0A0A;'
      'transform:rotate(-45deg);box-shadow:0 2px 8px rgba(64,145,108,0.6)"></div>',
      iconSize:[18,18],iconAnchor:[9,18],popupAnchor:[0,-18]});

    fetch('/api/vendors?limit=6',{headers:{'Accept':'application/json'}})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
      .then(function(res){
        var vendors=(res&&res.data)?res.data:[];
        if(!vendors.length){
          var note=L.popup().setLatLng([18.2,-77.3]).setContent('No vendors mapped yet.').openOn(map);return;
        }
        var bounds=[];
        vendors.forEach(function(v){
          var lat=parseFloat(v.location_lat),lng=parseFloat(v.location_lng);
          if(isNaN(lat)||isNaN(lng))return;
          var rating=parseFloat(v.avg_rating)||0;
          var icon=rating>=4.5?goldIcon:greenIcon;
          var cat=CAT_LABELS[v.category]||(v.category||'');
          var stars='';
          for(var i=0;i<5;i++){stars+= i<Math.round(rating)?'\\u2605':'\\u2606'}
          var verified=v.verified?'<span style="color:#40916C;font-size:11px;font-weight:600">\\u2713 Verified</span><br>':'';
          var popup='<div style="font-family:Inter,sans-serif;min-width:160px">'
            +'<strong style="font-size:15px;color:#0A0A0A">'+esc(v.name)+'</strong><br>'
            +'<span style="font-size:12px;color:#B8860B;text-transform:uppercase;font-weight:700;letter-spacing:0.06em">'+esc(cat)+'</span><br>'
            +verified
            +'<span style="color:#FFD700">'+stars+'</span> '
            +'<span style="font-size:12px;color:#6C757D">'+rating.toFixed(1)+'</span><br>'
            +'<span style="font-size:12px;color:#6C757D">'+esc(v.location_address||'Jamaica')+'</span>'
            +'</div>';
          var m=L.marker([lat,lng],{icon:icon}).addTo(map).bindPopup(popup);
          bounds.push([lat,lng]);
        });
        if(bounds.length>1){map.fitBounds(bounds,{padding:[40,40]})}
        else if(bounds.length===1){map.setView(bounds[0],10)}
      })
      .catch(function(err){
        console.warn('[PatWaGo map] vendor fetch failed:',err);
        mapEl.innerHTML='<p class="muted" style="display:flex;align-items:center;justify-content:center;height:100%">Couldn\\'t load vendor locations.</p>';
      });
  }

  // Load leaflet when map section scrolls into view (lazy)
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){
          io.unobserve(mapEl);
          loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',initMap);
        }
      });
    },{threshold:0.05});
    io.observe(mapEl);
  }else{
    loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',initMap);
  }
})();

'''

must_replace("map-js-insert",
"</script>\n</body>\n</html>",
map_js + "</script>\n</body>\n</html>")

# ---------------------------------------------------------------------------
# Write result
# ---------------------------------------------------------------------------
with open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("Patch report:")
for line in report:
    print("  " + line)
print(f"Original length: {orig_len}  New length: {len(src)}  Delta: {len(src)-orig_len}")
fails = [r for r in report if r.startswith("FAIL")]
if fails:
    print("ERRORS:", len(fails))
    sys.exit(1)
print("ALL PATCHES APPLIED OK")
