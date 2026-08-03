#!/usr/bin/env python3
"""Wire Google Maps config endpoint + rebuild frontend map with real markers + GPS nav."""
from pathlib import Path
import re
import shutil
from datetime import datetime

API_INDEX = Path("/opt/patwago/api/src/index.ts")
MAPS_TS = Path("/opt/patwago/api/src/routes/maps.ts")
WEB = Path("/opt/patwago/web/index.html")

bak = WEB.with_suffix(WEB.suffix + f".bak-gmaps-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}")
shutil.copy2(WEB, bak)
print("backed up web to", bak)


def patch_maps_route():
    t = MAPS_TS.read_text(encoding="utf-8")
    if "/config" in t and "browserKey" in t:
        print("maps config already present")
    else:
        insert = r'''
// ---------- GET /api/maps/config ----------
// Browser Maps JS key for the web frontend. Restrict this key by HTTP referrer
// in Google Cloud Console to https://patwago.com/* and https://www.patwago.com/*
router.get('/config', async (_req: Request, res: Response) => {
  const browserKey =
    process.env.GOOGLE_MAPS_BROWSER_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  if (!browserKey || browserKey === 'placeholder') {
    return apiError(res, 503, 'maps_not_configured', 'Google Maps is not configured.');
  }
  res.json({
    data: {
      browserKey,
      defaultCenter: { lat: 18.1096, lng: -77.2975 },
      defaultZoom: 9,
      country: 'JM',
    },
  });
});

'''
        # insert before export default
        if "export default router" not in t:
            raise SystemExit("no export default in maps.ts")
        t = t.replace("export default router;", insert + "export default router;")
        MAPS_TS.write_text(t, encoding="utf-8")
        print("OK maps config endpoint")

    # also fix error leaking raw message in maps
    t = MAPS_TS.read_text(encoding="utf-8")
    t = t.replace(
        "res.status(502).json({ error: 'maps_request_failed', message: (err as Error).message });",
        "res.status(502).json({ error: 'maps_request_failed', message: 'Maps request failed.' });",
    )
    MAPS_TS.write_text(t, encoding="utf-8")


def patch_web():
    html = WEB.read_text(encoding="utf-8")

    # 1) Replace map section HTML
    old_map_section = re.search(
        r'<section class="map-section" id="map">[\s\S]*?</section>\s*<!-- VENDOR SIGNUP -->',
        html,
    )
    if not old_map_section:
        raise SystemExit("map section not found")

    new_map_section = r'''<section class="map-section" id="map">
  <div class="wrap">
    <div class="section-head fade">
      <span class="eyebrow">Vendor map + GPS</span>
      <h2>Find places across Jamaica — navigate like a local</h2>
      <p>Real pins from our vendor database. Tap a pin for details, get directions, or start GPS navigation.</p>
    </div>
    <div class="glass fade pwg-map-shell">
      <div class="pwg-map-toolbar">
        <div class="pwg-map-search">
          <input id="pwgMapSearch" type="search" placeholder="Search vendors or places…" autocomplete="off" />
          <button type="button" id="pwgMapSearchBtn" aria-label="Search">Search</button>
        </div>
        <div class="pwg-map-actions">
          <button type="button" id="pwgMapMe" class="pwg-map-btn gold">📍 My location</button>
          <select id="pwgMapCat" aria-label="Filter category">
            <option value="">All categories</option>
            <option value="food">Food</option>
            <option value="water_sports">Water Sports</option>
            <option value="tours">Tours</option>
            <option value="adventure">Adventure</option>
            <option value="transport">Transport</option>
            <option value="lodging">Lodging</option>
            <option value="beauty">Beauty</option>
            <option value="crafts">Crafts</option>
          </select>
          <select id="pwgMapMode" aria-label="Travel mode">
            <option value="DRIVING">Drive</option>
            <option value="WALKING">Walk</option>
            <option value="TRANSIT">Transit</option>
            <option value="TWO_WHEELER">Bike / moto</option>
          </select>
          <button type="button" id="pwgMapClearRoute" class="pwg-map-btn">Clear route</button>
        </div>
      </div>
      <div id="vendorMap" role="application" aria-label="Interactive Jamaica vendor map"></div>
      <div id="pwgMapStatus" class="pwg-map-status">Loading Google Maps…</div>
      <div id="pwgMapDirections" class="pwg-map-directions" hidden>
        <div class="pwg-map-dir-head">
          <strong id="pwgMapDirTitle">Directions</strong>
          <span id="pwgMapDirMeta"></span>
        </div>
        <ol id="pwgMapDirSteps"></ol>
        <div class="pwg-map-dir-actions">
          <a id="pwgMapOpenGoogle" href="#" target="_blank" rel="noopener">Open in Google Maps</a>
          <button type="button" id="pwgMapNavigate" class="pwg-map-btn gold">Start navigation</button>
        </div>
      </div>
    </div>
    <div class="map-legend fade">
      <span class="lg-chip"><span class="lg-dot" style="background:#FFD700"></span> Vendor pin</span>
      <span class="lg-chip"><span class="lg-dot" style="background:#4285F4"></span> Your GPS</span>
      <span class="lg-chip"><span class="lg-dot" style="background:#E63946"></span> Selected destination</span>
      <span class="lg-chip">Pins stay locked to real coordinates when you zoom/pan</span>
    </div>
  </div>
</section>

<!-- VENDOR SIGNUP -->'''

    html = html[: old_map_section.start()] + new_map_section + html[old_map_section.end() :]

    # 2) CSS for map shell
    css = r'''
/* ---------- Google Maps shell ---------- */
.pwg-map-shell{padding:0;overflow:hidden;border-radius:16px}
.pwg-map-toolbar{display:flex;flex-direction:column;gap:10px;padding:14px;border-bottom:1px solid rgba(255,215,0,0.1);background:rgba(10,10,10,0.92)}
.pwg-map-search{display:flex;gap:8px}
.pwg-map-search input{flex:1;min-width:0;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,215,0,0.15);background:rgba(20,20,20,0.9);color:#F8F9FA;font-size:14px;outline:none}
.pwg-map-search button,.pwg-map-btn{padding:12px 14px;border-radius:12px;border:1px solid rgba(255,215,0,0.2);background:rgba(255,255,255,0.05);color:#F8F9FA;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px}
.pwg-map-btn.gold,.pwg-map-search button{background:linear-gradient(135deg,#FFD700,#E6C200);color:#0A0A0A;border-color:transparent}
.pwg-map-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.pwg-map-actions select{padding:11px 12px;border-radius:12px;border:1px solid rgba(255,215,0,0.15);background:rgba(20,20,20,0.9);color:#F8F9FA;font-size:13px}
#vendorMap{width:100%;height:520px;background:#0F0F0F}
.pwg-map-status{padding:10px 14px;font-size:13px;color:#ADB5BD;border-top:1px solid rgba(255,255,255,0.06)}
.pwg-map-directions{padding:14px;border-top:1px solid rgba(255,215,0,0.12);background:rgba(15,15,15,0.96);max-height:240px;overflow:auto}
.pwg-map-dir-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;color:#FFD700;font-size:14px}
.pwg-map-dir-head span{color:#ADB5BD;font-weight:500}
#pwgMapDirSteps{margin:0 0 12px 18px;padding:0;color:#F8F9FA;font-size:13px;line-height:1.45}
#pwgMapDirSteps li{margin:0 0 8px}
.pwg-map-dir-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.pwg-map-dir-actions a{color:#FFD700;font-weight:700;font-size:13px}
.pwg-gm-info{min-width:200px;max-width:260px;color:#111}
.pwg-gm-info h4{margin:0 0 6px;font-size:15px}
.pwg-gm-info p{margin:0 0 8px;font-size:12px;color:#444}
.pwg-gm-info .btns{display:flex;flex-wrap:wrap;gap:6px}
.pwg-gm-info button{padding:8px 10px;border:0;border-radius:8px;background:#FFD700;color:#0A0A0A;font-weight:700;cursor:pointer;font-size:12px}
.pwg-gm-info button.secondary{background:#111;color:#FFD700}
.vendor-ph{width:100%;height:170px;display:flex;align-items:flex-end;justify-content:flex-start;padding:14px;border-radius:12px 12px 0 0;position:relative;overflow:hidden}
.vendor-ph::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 20%,rgba(0,0,0,0.72) 100%)}
.vendor-ph .ph-cat{position:relative;z-index:1;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#FFD700}
.vendor-ph .ph-icon{position:absolute;right:14px;top:14px;font-size:34px;opacity:.85}
@media (max-width:820px){
  #vendorMap{height:420px}
  .pwg-map-actions{flex-direction:column;align-items:stretch}
  .pwg-map-actions select,.pwg-map-btn{width:100%}
}
'''

    if "pwg-map-shell" not in html.split("/* ---------- Google Maps shell")[0] if False else True:
        # inject before </style> nearest leaflet section or first </style>
        if "pwg-map-shell{" not in html:
            html = html.replace("</style>", css + "\n</style>", 1)

    # 3) Replace broken map JS block
    old_js_pat = re.compile(
        r"/\* ---------- Vendor map \(Google Maps iframe \+ vendor dot overlay\) ---------- \*/\s*\(function\(\)\{[\s\S]*?\}\)\(\);\s*",
        re.M,
    )
    if not old_js_pat.search(html):
        # try alternate
        old_js_pat = re.compile(
            r"/\* ---------- Vendor map[\s\S]*?loadVendorDots\(\);\s*\}\s*\}\)\(\);\s*",
            re.M,
        )
    if not old_js_pat.search(html):
        raise SystemExit("old map JS block not found")

    new_js = r'''
/* ---------- Real Google Maps + GPS navigation ---------- */
(function(){
  var mapEl=document.getElementById('vendorMap');
  if(!mapEl)return;

  var state={
    map:null, markers:[], markerById:{}, info:null, userMarker:null, userPos:null,
    directionsService:null, directionsRenderer:null, vendors:[], selected:null, ready:false
  };
  var CAT_COLORS={water_sports:'#00B4D8',tours:'#FFD700',food:'#FF6B35',adventure:'#E63946',transport:'#2D6A4F',beauty:'#E0AAFF',crafts:'#F4A261',lodging:'#457B9D'};
  var CAT_LABELS={water_sports:'Water Sports',tours:'Tours',food:'Food',adventure:'Adventure',transport:'Transport',beauty:'Beauty',crafts:'Crafts',lodging:'Lodging'};

  function setStatus(msg){var el=document.getElementById('pwgMapStatus'); if(el) el.textContent=msg;}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&','<':'<','>':'>','"':'&quot;',"'":'&#39;'}[c]||c})}

  function loadScript(src){
    return new Promise(function(resolve,reject){
      if(window.google && window.google.maps){resolve();return;}
      var s=document.createElement('script');
      s.src=src; s.async=true; s.defer=true;
      s.onload=function(){resolve()};
      s.onerror=function(){reject(new Error('Maps script failed'))};
      document.head.appendChild(s);
    });
  }

  function pinSvg(color){
    var c=encodeURIComponent(color||'#FFD700');
    return 'data:image/svg+xml;utf8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48"><path fill="'+decodeURIComponent(c)+'" stroke="#0A0A0A" stroke-width="2" d="M18 1C9.7 1 3 7.7 3 16.1 3 27.4 18 47 18 47s15-19.6 15-30.9C33 7.7 26.3 1 18 1z"/><circle cx="18" cy="16" r="6" fill="#0A0A0A"/></svg>');
  }

  function clearMarkers(){
    state.markers.forEach(function(m){ m.setMap(null); });
    state.markers=[]; state.markerById={};
  }

  function visibleVendors(){
    var q=(document.getElementById('pwgMapSearch').value||'').trim().toLowerCase();
    var cat=document.getElementById('pwgMapCat').value||'';
    return state.vendors.filter(function(v){
      var lat=parseFloat(v.location_lat), lng=parseFloat(v.location_lng);
      if(!isFinite(lat)||!isFinite(lng)) return false;
      if(cat && v.category!==cat) return false;
      if(!q) return true;
      var hay=((v.name||'')+' '+(v.location_address||'')+' '+(v.category||'')+' '+(v.description||'')).toLowerCase();
      return hay.indexOf(q)>-1;
    });
  }

  function openInfo(v, marker){
    state.selected=v;
    if(state.info) state.info.close();
    var rating=parseFloat(v.avg_rating)||0;
    var html='<div class="pwg-gm-info">'
      +'<h4>'+esc(v.name)+'</h4>'
      +'<p>'+esc(CAT_LABELS[v.category]||v.category||'Place')
      +(rating?(' · ★ '+rating.toFixed(1)):'')
      +'<br>'+esc(v.location_address||'Jamaica')+'</p>'
      +'<div class="btns">'
      +'<button type="button" id="gmDirBtn">Directions</button>'
      +'<button type="button" class="secondary" id="gmNavBtn">Navigate</button>'
      +'</div></div>';
    state.info=new google.maps.InfoWindow({content:html});
    state.info.open({map:state.map, anchor:marker});
    google.maps.event.addListenerOnce(state.info,'domready',function(){
      var d=document.getElementById('gmDirBtn');
      var n=document.getElementById('gmNavBtn');
      if(d) d.onclick=function(){ routeTo(v,false); };
      if(n) n.onclick=function(){ routeTo(v,true); };
    });
  }

  function renderMarkers(){
    if(!state.map) return;
    clearMarkers();
    var list=visibleVendors();
    var bounds=new google.maps.LatLngBounds();
    list.forEach(function(v){
      var lat=parseFloat(v.location_lat), lng=parseFloat(v.location_lng);
      var color=CAT_COLORS[v.category]||'#FFD700';
      var marker=new google.maps.Marker({
        map: state.map,
        position: {lat:lat, lng:lng},
        title: v.name,
        icon: {
          url: pinSvg(color),
          scaledSize: new google.maps.Size(32,42),
          anchor: new google.maps.Point(16,42)
        }
      });
      marker.addListener('click', function(){ openInfo(v, marker); });
      state.markers.push(marker);
      state.markerById[v.id]=marker;
      bounds.extend({lat:lat,lng:lng});
    });
    setStatus(list.length+' places pinned · zoom/pan keeps markers locked to GPS coordinates');
    if(list.length===1){ state.map.setCenter({lat:parseFloat(list[0].location_lat), lng:parseFloat(list[0].location_lng)}); state.map.setZoom(13); }
    else if(list.length>1){ state.map.fitBounds(bounds, 48); }
  }

  function ensureUserPos(){
    return new Promise(function(resolve,reject){
      if(state.userPos){ resolve(state.userPos); return; }
      if(!navigator.geolocation){ reject(new Error('Geolocation not supported')); return; }
      setStatus('Getting your GPS…');
      navigator.geolocation.getCurrentPosition(function(pos){
        state.userPos={lat:pos.coords.latitude, lng:pos.coords.longitude};
        if(state.userMarker) state.userMarker.setMap(null);
        state.userMarker=new google.maps.Marker({
          map:state.map,
          position:state.userPos,
          title:'You are here',
          zIndex:999,
          icon:{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: '#4285F4',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3
          }
        });
        resolve(state.userPos);
      }, function(err){ reject(err||new Error('Location denied')); }, {enableHighAccuracy:true, timeout:12000, maximumAge:15000});
    });
  }

  function travelMode(){
    var m=(document.getElementById('pwgMapMode').value||'DRIVING');
    return google.maps.TravelMode[m] || google.maps.TravelMode.DRIVING;
  }

  function routeTo(v, startNav){
    if(!v) return;
    var dest={lat:parseFloat(v.location_lat), lng:parseFloat(v.location_lng)};
    ensureUserPos().then(function(origin){
      setStatus('Building route to '+v.name+'…');
      if(!state.directionsService){
        state.directionsService=new google.maps.DirectionsService();
        state.directionsRenderer=new google.maps.DirectionsRenderer({
          map: state.map,
          suppressMarkers: false,
          polylineOptions: { strokeColor:'#FFD700', strokeWeight:5, strokeOpacity:0.9 }
        });
      }
      state.directionsService.route({
        origin: origin,
        destination: dest,
        travelMode: travelMode(),
        provideRouteAlternatives: false
      }, function(result, status){
        if(status!=='OK' || !result){
          setStatus('Could not build directions ('+status+'). Opening Google Maps…');
          openExternalNav(origin, dest, v.name);
          return;
        }
        state.directionsRenderer.setDirections(result);
        var leg=result.routes[0].legs[0];
        var panel=document.getElementById('pwgMapDirections');
        panel.hidden=false;
        document.getElementById('pwgMapDirTitle').textContent='To '+v.name;
        document.getElementById('pwgMapDirMeta').textContent=(leg.distance&&leg.distance.text||'')+' · '+(leg.duration&&leg.duration.text||'');
        var steps=document.getElementById('pwgMapDirSteps');
        steps.innerHTML=(leg.steps||[]).slice(0,12).map(function(s){
          return '<li>'+ (s.instructions||'') + ' <span style="color:#ADB5BD">('+(s.distance&&s.distance.text||'')+')</span></li>';
        }).join('');
        var ext='https://www.google.com/maps/dir/?api=1'
          +'&origin='+encodeURIComponent(origin.lat+','+origin.lng)
          +'&destination='+encodeURIComponent(dest.lat+','+dest.lng)
          +'&travelmode='+encodeURIComponent((document.getElementById('pwgMapMode').value||'DRIVING').toLowerCase());
        document.getElementById('pwgMapOpenGoogle').href=ext;
        setStatus('Route ready · markers stay fixed to map coordinates');
        if(startNav){ window.open(ext,'_blank','noopener'); }
      });
    }).catch(function(err){
      setStatus('Enable location permission for GPS navigation.');
      // still allow external maps without origin
      var dest={lat:parseFloat(v.location_lat), lng:parseFloat(v.location_lng)};
      openExternalNav(null, dest, v.name);
    });
  }

  function openExternalNav(origin, dest, name){
    var url='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(dest.lat+','+dest.lng)+'&destination_place_id=&travelmode=driving';
    if(origin) url='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin.lat+','+origin.lng)+'&destination='+encodeURIComponent(dest.lat+','+dest.lng)+'&travelmode=driving';
    window.open(url,'_blank','noopener');
  }

  function clearRoute(){
    if(state.directionsRenderer){ state.directionsRenderer.set('directions', null); }
    document.getElementById('pwgMapDirections').hidden=true;
    setStatus(state.markers.length+' places pinned');
  }

  function goMyLocation(){
    ensureUserPos().then(function(pos){
      state.map.panTo(pos);
      state.map.setZoom(Math.max(state.map.getZoom(), 14));
      setStatus('Centered on your GPS location');
    }).catch(function(){ setStatus('Location permission needed for My location'); });
  }

  function fetchVendors(){
    // Prefer larger sample for map density
    return fetch('/api/vendors?limit=200',{headers:{'Accept':'application/json'}})
      .then(function(r){ if(!r.ok) throw new Error('vendor fetch '+r.status); return r.json(); })
      .then(function(res){
        state.vendors=(res && res.data) ? res.data : [];
        renderMarkers();
      });
  }

  function initMap(center){
    state.map=new google.maps.Map(mapEl,{
      center: center || {lat:18.1096, lng:-77.2975},
      zoom: 9,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      styles: [
        {elementType:'geometry', stylers:[{color:'#1d1d1d'}]},
        {elementType:'labels.text.stroke', stylers:[{color:'#1d1d1d'}]},
        {elementType:'labels.text.fill', stylers:[{color:'#8a8a8a'}]},
        {featureType:'road', elementType:'geometry', stylers:[{color:'#2c2c2c'}]},
        {featureType:'water', elementType:'geometry', stylers:[{color:'#0b3c4a'}]},
        {featureType:'poi', stylers:[{visibility:'off'}]},
        {featureType:'transit', stylers:[{visibility:'off'}]}
      ]
    });
    state.ready=true;
    document.getElementById('pwgMapSearchBtn').onclick=function(){ renderMarkers(); };
    document.getElementById('pwgMapSearch').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); renderMarkers(); }});
    document.getElementById('pwgMapCat').onchange=function(){ renderMarkers(); };
    document.getElementById('pwgMapMe').onclick=goMyLocation;
    document.getElementById('pwgMapClearRoute').onclick=clearRoute;
    document.getElementById('pwgMapNavigate').onclick=function(){ if(state.selected) routeTo(state.selected,true); };
    fetchVendors().catch(function(err){ console.warn(err); setStatus('Could not load vendor pins'); });
  }

  function boot(){
    setStatus('Connecting Google Maps…');
    fetch('/api/maps/config',{headers:{'Accept':'application/json'}})
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error((j&&j.message)||'maps config failed'); return j; }); })
      .then(function(cfg){
        var key=(cfg.data&&cfg.data.browserKey)||'';
        if(!key) throw new Error('No browser maps key');
        var center=(cfg.data&&cfg.data.defaultCenter)||{lat:18.1096,lng:-77.2975};
        // callback name unique
        window.__pwgInitGmap=function(){ initMap(center); };
        return loadScript('https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&libraries=places,geometry&callback=__pwgInitGmap');
      })
      .catch(function(err){
        console.error('[PatWaGo map]', err);
        setStatus('Google Maps unavailable right now. Using offline OSM fallback…');
        // Leaflet fallback so pins still stick to coordinates
        function leafletBoot(){
          if(!window.L){
            var s=document.createElement('script');
            s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            s.onload=leafletBoot; document.head.appendChild(s); return;
          }
          var map=L.map(mapEl,{zoomControl:true}).setView([18.1096,-77.2975],9);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OSM'}).addTo(map);
          fetch('/api/vendors?limit=200').then(function(r){return r.json()}).then(function(res){
            (res.data||[]).forEach(function(v){
              var lat=parseFloat(v.location_lat), lng=parseFloat(v.location_lng);
              if(!isFinite(lat)||!isFinite(lng)) return;
              L.circleMarker([lat,lng],{radius:7,color:'#0A0A0A',weight:2,fillColor:'#FFD700',fillOpacity:0.95})
                .addTo(map)
                .bindPopup('<strong>'+esc(v.name)+'</strong><br>'+esc(v.location_address||''));
            });
            setStatus('Offline map active · pins locked to coordinates (Google Maps key/referrer may need allowlisting for full navigation)');
          });
          document.getElementById('pwgMapMe').onclick=function(){
            navigator.geolocation.getCurrentPosition(function(pos){
              map.setView([pos.coords.latitude,pos.coords.longitude],14);
              L.circleMarker([pos.coords.latitude,pos.coords.longitude],{radius:8,color:'#fff',weight:2,fillColor:'#4285F4',fillOpacity:1}).addTo(map);
            });
          };
        }
        leafletBoot();
      });
  }

  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if(en.isIntersecting){ io.disconnect(); boot(); } });
    },{threshold:0.05});
    io.observe(mapEl);
  } else { boot(); }
})();

'''
    html = old_js_pat.sub(new_js + "\n", html, count=1)

    # 4) Vendor photos → clean branded placeholders (no cropped random junk photos)
    old_img_block = re.compile(
        r"// Category → placeholder hero image URL\.[\s\S]*?function imgFor\(cat,i\)\{return CAT_IMG\[cat\]\|\|\('https://loremflickr\.com/400/300/beach,caribbean\?lock='\+\(i\|\|0\)\);\}",
        re.M,
    )
    new_img = r'''// Clean branded gradient placeholders (no cropped stock photos).
  var CAT_PH={
    water_sports:['#0077B6','#00B4D8','🚤'],
    tours:['#2D6A4F','#40916C','🗺️'],
    food:['#9B2226','#EE9B00','🍗'],
    adventure:['#6A040F','#E85D04','🪂'],
    transport:['#1B4332','#52B788','🚕'],
    beauty:['#5A189A','#C77DFF','💅'],
    crafts:['#7F4F24','#D4A373','🎨'],
    lodging:['#023E8A','#48CAE4','🏝️']
  };
  function phStyle(cat){
    var c=CAT_PH[cat]||['#2D6A4F','#FFD700','🇯🇲'];
    return 'background:linear-gradient(135deg,'+c[0]+','+c[1]+')';
  }
  function phIcon(cat){ var c=CAT_PH[cat]||['','','🇯🇲']; return c[2]; }
'''
    if old_img_block.search(html):
        html = old_img_block.sub(new_img, html, count=1)
        print("photo placeholders replaced")
    else:
        print("WARN photo block not found")

    # replace vendor card image markup to use gradient placeholders
    html = html.replace(
        "var fb='https://picsum.photos/seed/patwago-'+idx+'/400/300';\n"
        "        return '<div class=\"vendor-card glass fade in\">'\n"
        "          + '<div class=\"vendor-img-wrap\"><img class=\"vendor-img\" loading=\"lazy\" alt=\"'+escape(v.name)+' — '+escape(cat)+' in Jamaica\" src=\"'+imgFor(v.category,idx)+'\" onerror=\"if(this.dataset.fb){this.style.display=\\'none\\'}else{this.dataset.fb=1;this.src=\\''+fb+'\\'}\"/></div>'",
        "return '<div class=\"vendor-card glass fade in\">'\n"
        "          + '<div class=\"vendor-img-wrap\"><div class=\"vendor-ph\" style=\"'+phStyle(v.category)+'\"><span class=\"ph-icon\">'+phIcon(v.category)+'</span><span class=\"ph-cat\">'+escape(cat)+'</span></div></div>'",
    )

    WEB.write_text(html, encoding="utf-8")
    print("OK web map patched, size", WEB.stat().st_size)


def main():
    patch_maps_route()
    patch_web()
    print("DONE")


if __name__ == "__main__":
    main()
