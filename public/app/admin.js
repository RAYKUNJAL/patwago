(function(){
  var tokenKey='patwago_admin_analytics_token';
  var login=document.getElementById('adminLogin'), dashboard=document.getElementById('adminDashboard');
  if(!login||!dashboard)return;
  function token(){try{return sessionStorage.getItem(tokenKey)||''}catch(_){return''}}
  function headers(){return{Authorization:'Bearer '+token()}}
  function number(value){return Number(value||0).toLocaleString()}
  function fetchData(path){return fetch(path,{headers:headers()}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'Request failed');return j.data})})}
  function rank(items){return '<div class="rank-list">'+(items.length?items.map(function(item,i){return '<div class="rank-item"><b>'+(i+1)+'</b><span>'+item.key+'</span><strong>'+number(item.count)+'</strong></div>'}).join(''):'<p class="muted">No data yet.</p>')+'</div>'}
  function render(summary,events){
    var kpis=[['Sessions',summary.sessions],['Events',summary.events],['Vendor searches',summary.counts.vendor_search],['Itineraries saved',summary.counts.itinerary_save],['Checkout starts',summary.counts.checkout_start],['Purchases',summary.counts.checkout_complete],['Translations',summary.counts.translation],['Voice completions',summary.counts.voice_complete]];
    document.getElementById('analyticsKpis').innerHTML=kpis.map(function(k){return '<div class="admin-kpi"><span>'+k[0]+'</span><strong>'+number(k[1])+'</strong></div>'}).join('')+'<div class="admin-kpi"><span>Database</span><strong style="font-size:20px">'+summary.storage+'</strong></div>';
    var funnel=summary.funnel;var max=Math.max.apply(null,Object.values(funnel).concat([1]));
    document.getElementById('analyticsFunnel').innerHTML=Object.entries(funnel).map(function(entry){var h=Math.max(4,Math.round(entry[1]/max*170));return '<div class="funnel-step"><div class="funnel-bar" style="height:'+h+'px"></div><strong>'+number(entry[1])+'</strong><span>'+entry[0].replace(/_/g,' ')+'</span></div>'}).join('');
    document.getElementById('analyticsSearches').innerHTML=rank(summary.top_searches||[]);
    document.getElementById('analyticsVendors').innerHTML=rank(summary.top_vendors||[]);
    document.getElementById('analyticsEvents').innerHTML=events.length?events.slice(0,100).map(function(e){return '<div class="event-row"><time>'+new Date(e.created_at).toLocaleString()+'</time><code>'+e.name+'</code><span>'+Object.values(e.properties||{}).slice(0,2).join(' · ')+'</span></div>'}).join(''):'<p class="muted">No events recorded yet.</p>';
  }
  function load(){var days=document.getElementById('analyticsRange').value;return Promise.all([fetchData('/api/admin/analytics/summary?days='+days),fetchData('/api/admin/analytics/events?limit=200')]).then(function(data){login.hidden=true;dashboard.hidden=false;render(data[0],data[1])}).catch(function(error){dashboard.hidden=true;login.hidden=false;var old=login.querySelector('.admin-error');if(old)old.remove();var p=document.createElement('p');p.className='admin-error';p.textContent=error.message;login.appendChild(p)})}
  document.getElementById('adminLoginForm').addEventListener('submit',function(e){e.preventDefault();sessionStorage.setItem(tokenKey,document.getElementById('adminToken').value);load()});
  document.getElementById('analyticsRange').addEventListener('change',load);
  document.getElementById('adminLogout').addEventListener('click',function(){sessionStorage.removeItem(tokenKey);location.reload()});
  if(token())load();
})();
