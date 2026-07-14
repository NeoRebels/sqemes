export default function handler(req, res) {
  // .trim() — env vars pasted into Vercel can carry a trailing newline; injected raw
  // into the inline <script> below, that breaks the JS string literal (SyntaxError).
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const oauthBase = `${supabaseUrl}/functions/v1/mcp-oauth`;
  const projectRef = supabaseUrl.split('//')[1]?.split('.')[0] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'DENY');
  // SQEM-111 — this consent page needs its own CSP (it serves an inline <script>/<style>).
  // Verified clean in Report-Only on staging, now enforcing.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
    "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    `connect-src 'self' ${supabaseUrl || "https://api.sqemes.com"} https://*.supabase.co`
  );
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Sqemes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:#f0f6fc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;-webkit-font-smoothing:antialiased}

.card{background:#fff;border-radius:22px;box-shadow:0 12px 40px rgba(12,42,82,0.22);padding:44px 40px;width:100%;max-width:440px}

/* Logo */
.logo{display:flex;align-items:center;gap:12px;margin-bottom:32px}
.logo-img{width:40px;height:40px;border-radius:10px}
.logo-name{font-family:'DM Sans',sans-serif;font-weight:700;font-size:24px;letter-spacing:-0.96px;color:#0c2a52;line-height:1}

/* Headings */
h1{font-family:'DM Sans',sans-serif;font-weight:700;font-size:22px;line-height:22px;letter-spacing:-0.88px;color:#0c2a52;margin-bottom:8px}
.sub{font-size:14px;line-height:1.7;letter-spacing:-0.154px;color:rgba(12,42,82,0.65);margin-bottom:24px}

/* User row */
.user-row{display:flex;align-items:center;gap:10px;background:#ebf6ff;border-radius:100px;padding:8px 14px;margin-bottom:20px}
.user-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0}
.user-email{font-size:13px;font-weight:500;color:#0c2a52;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-0.1px}

/* Workspace list */
.ws-list{list-style:none;margin-bottom:20px}
.ws-item{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1.5px solid #e9eaec;border-radius:14px;cursor:pointer;transition:border-color .15s,background .15s;margin-bottom:8px}
.ws-item:hover{border-color:#857aff;background:#f0f6fc}
.ws-item.sel{border-color:#857aff;background:#ebf6ff}
.ws-av{width:38px;height:38px;background:linear-gradient(135deg,#857aff,#a78bfa);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;flex-shrink:0;letter-spacing:-0.3px}
.ws-name{font-size:14px;font-weight:600;color:#0c2a52;letter-spacing:-0.154px}

/* Connection name */
.conn-name{margin-bottom:24px}
.name-title{font-size:12px;font-weight:700;color:rgba(12,42,82,0.55);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;display:block}
#sc-name{width:100%;padding:11px 14px;border:1.5px solid #e9eaec;border-radius:12px;font-family:'DM Sans',sans-serif;font-size:14px;color:#0c2a52;background:#fff;outline:none}
#sc-name:focus{border-color:#857aff}
.name-note{font-size:12px;line-height:1.6;color:rgba(12,42,82,0.5);margin-top:8px;letter-spacing:-0.1px}

/* Primary button — purple pill with arrow pip */
.btn{width:100%;height:50px;padding:0 8px 0 24px;background:#857aff;border:0;border-radius:100px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:background .15s;font-family:'DM Sans',sans-serif}
.btn:hover:not(:disabled){background:#743de6}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-label{font-size:16px;font-weight:500;color:#fff;letter-spacing:-0.4px;padding-right:4px}
.btn-pip{width:38px;height:38px;border-radius:100px;background:rgba(255,255,255,0.54);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.btn-pip svg{width:16px;height:16px;color:#fff}

/* Sign-in button (outline variant) */
.btn-outline{background:#fff;border:1.5px solid #857aff}
.btn-outline:hover:not(:disabled){background:#f8f5ff;border-color:#743de6}
.btn-outline .btn-label{color:#857aff}
.btn-outline .btn-pip{background:#857aff}

/* Loading spinner */
.spinner{display:flex;align-items:center;justify-content:center;gap:12px;padding:24px 0;color:rgba(12,42,82,0.45);font-size:14px;letter-spacing:-0.154px}
.spin{width:22px;height:22px;border-radius:50%;border:2.5px solid #e9eaec;border-top-color:#857aff;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* Error */
.err{color:#d90000;font-size:13px;margin-bottom:16px;padding:10px 14px;background:#fff5f5;border-radius:10px;display:none;letter-spacing:-0.1px}
.err.show{display:block}

.hidden{display:none}
</style>
</head>
<body>
<div class="card">

  <div class="logo">
    <img src="/logo-favicon-V2.png" alt="sqemes" class="logo-img">
    <span class="logo-name">sqemes</span>
  </div>

  <!-- State: checking session -->
  <div id="s-loading">
    <div class="spinner">
      <div class="spin"></div>
      Checking session…
    </div>
  </div>

  <!-- State: signed in — workspace approval -->
  <div id="s-approve" class="hidden">
    <h1>Approve access</h1>
    <p class="sub">An AI assistant is requesting access to your Sqemes workspace.</p>
    <div id="user-row" class="user-row hidden">
      <div class="user-dot"></div>
      <span id="user-email" class="user-email"></span>
    </div>
    <div id="e-approve" class="err"></div>
    <ul class="ws-list" id="wsl"></ul>
    <div class="conn-name">
      <label class="name-title" for="sc-name">Connection name</label>
      <input id="sc-name" type="text" value="Claude Desktop" maxlength="60" autocomplete="off">
      <p class="name-note">Connects with <strong>read-only</strong> access. Expand permissions or set an expiry anytime in Sqemes&nbsp;&rarr;&nbsp;Settings&nbsp;&rarr;&nbsp;Integrations.</p>
    </div>
    <button class="btn" id="b-approve" disabled onclick="doApprove()">
      <span class="btn-label">Approve access</span>
      <span class="btn-pip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </span>
    </button>
  </div>

  <!-- State: not signed in -->
  <div id="s-signin" class="hidden">
    <h1>Sign in to connect</h1>
    <p class="sub">Sign in to Sqemes to allow this AI assistant to access your workspace.</p>
    <button class="btn btn-outline" onclick="goSignIn()">
      <span class="btn-label">Open Sqemes to sign in</span>
      <span class="btn-pip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </span>
    </button>
  </div>

</div>
<script>
var SUPA='${supabaseUrl}',KEY='${anonKey}',BASE='${oauthBase}';
var sp=new URLSearchParams(location.search);
var RU=sp.get('redirect_uri')||'',CC=sp.get('code_challenge')||'',CCM=sp.get('code_challenge_method')||'S256',ST=sp.get('state')||'',CID=sp.get('client_id')||'';
var tok=null,wsId=null;

function show(id){['s-loading','s-approve','s-signin'].forEach(function(s){document.getElementById(s).classList.toggle('hidden',s!==id)});}
function errShow(id,m){var e=document.getElementById(id);e.textContent=m;e.classList.add('show');}

function readLocalSession(){
  var base='sb-${projectRef}-auth-token';
  var raw=localStorage.getItem(base);
  if(!raw){
    var chunks=[];
    for(var i=0;;i++){var c=localStorage.getItem(base+'.'+i);if(!c)break;chunks.push(c);}
    if(chunks.length)raw=chunks.join('');
  }
  if(!raw)return null;
  if(raw.slice(0,7)==='base64-'){try{raw=atob(raw.slice(7));}catch(e){return null;}}
  try{
    var p=JSON.parse(raw);
    if(Array.isArray(p)&&typeof p[0]==='string'&&p[0].split('.').length===3)
      return{access_token:p[0],refresh_token:p[1],user:p[7]};
    if(p&&p.access_token)return p;
    if(p&&p.session&&p.session.access_token)return p.session;
  }catch(e){}
  return null;
}

function jwtPayload(token){
  try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}
  catch(e){return null;}
}

function goSignIn(){
  localStorage.setItem('sqm_mcp_oauth_return',window.location.href);
  window.location.href='/';
}

async function init(){
  var s=readLocalSession();
  if(!s||!s.access_token){show('s-signin');return;}
  var payload=jwtPayload(s.access_token);
  var exp=(payload&&payload.exp||0)*1000;
  if(exp>0&&exp<Date.now()){show('s-signin');return;}
  tok=s.access_token;
  var email=(s.user&&s.user.email)||(payload&&payload.email)||'';
  if(email){document.getElementById('user-email').textContent=email;document.getElementById('user-row').classList.remove('hidden');}
  var uid=(s.user&&s.user.id)||(payload&&payload.sub)||'';
  try{
    var mr=await fetch(SUPA+'/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+uid,{headers:{'Authorization':'Bearer '+tok,'apikey':KEY}});
    var ms=await mr.json();
    if(!Array.isArray(ms)||!ms.length){show('s-signin');return;}
    var ids=ms.map(function(m){return m.workspace_id;}).join(',');
    var wr=await fetch(SUPA+'/rest/v1/workspaces?select=id,name&id=in.('+ids+')',{headers:{'Authorization':'Bearer '+tok,'apikey':KEY}});
    var ws=await wr.json();
    var ul=document.getElementById('wsl');ul.innerHTML='';
    ws.forEach(function(w){
      var li=document.createElement('li');li.className='ws-item';li.dataset.id=w.id;
      // SQEM-019: build with textContent, never innerHTML — workspace name is user-editable
      // and a member could inject markup to attack another member on this same-origin page.
      var nm=(w.name||'').toString();
      var av=document.createElement('div');av.className='ws-av';av.textContent=(nm.charAt(0)||'?').toUpperCase();
      var sp=document.createElement('span');sp.className='ws-name';sp.textContent=nm;
      li.appendChild(av);li.appendChild(sp);
      li.onclick=function(){document.querySelectorAll('.ws-item').forEach(function(e){e.classList.remove('sel');});li.classList.add('sel');wsId=w.id;document.getElementById('b-approve').disabled=false;};
      ul.appendChild(li);
    });
    if(ws.length===1)ul.firstElementChild.click();
    show('s-approve');
  }catch(e){show('s-signin');}
}

async function doApprove(){
  if(!wsId||!tok)return;
  var btn=document.getElementById('b-approve');
  btn.disabled=true;
  btn.querySelector('.btn-label').textContent='Connecting…';
  try{
    var connName=(document.getElementById('sc-name').value||'').trim()||'Claude Desktop';
    var r=await fetch(BASE+'/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:tok,workspace_id:wsId,code_challenge:CC,code_challenge_method:CCM,redirect_uri:RU,state:ST,client_id:CID,name:connName})});
    var d=await r.json();
    if(!r.ok)throw new Error(d.error_description||d.error||'Failed to authorize');
    window.location.href=d.redirect_url;
  }catch(e){errShow('e-approve',e.message);btn.disabled=false;btn.querySelector('.btn-label').textContent='Approve access';}
}

init();
</script>
</body>
</html>`);
}
