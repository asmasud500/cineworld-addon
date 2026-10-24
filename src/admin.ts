import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { Request, Response, Router } from "express";
import { CINEMA_CATEGORIES } from "./catalog.js";
import type { Movie } from "./catalog.js";
import { getCuratedMovie, listCurated, replaceCurated } from "./curated.js";
import { getRememberedMovie } from "./providers/upstream.js";
import { getOverrides, movieKey, setOverrides } from "./overrides.js";
import { LEGAL_SOURCES, PLAYBACK_HOSTS, addLegalSource, removeLegalSource, replaceLegalSources } from "./sources.js";
import { SUBTITLES, SUBTITLE_HOSTS, addSubtitle, removeSubtitle, replaceSubtitles } from "./subtitles.js";

const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: Request, res: Response): boolean {
  const expected = process.env.ADMIN_API_TOKEN?.trim();
  if (!expected) { res.status(404).json({ error: "not_found" }); return false; } // admin is off without a token
  const ip = req.ip ?? "unknown";
  const record = failures.get(ip);
  if (record && record.resetAt > Date.now() && record.count >= FAIL_LIMIT) { res.status(429).json({ error: "too_many_attempts" }); return false; }
  const header = req.header("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!given || !tokenMatches(given, expected)) {
    const fresh = record && record.resetAt > Date.now() ? record : { count: 0, resetAt: Date.now() + FAIL_WINDOW_MS };
    fresh.count++;
    failures.set(ip, fresh);
    if (failures.size > 1000) failures.clear();
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  failures.delete(ip);
  return true;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CineWorld admin</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#111a2e;--panel2:#16223a;--line:#263653;--txt:#eef4ff;--mut:#9eacc5;--acc:#67a7ff;--acc2:#8c7bff;--ok:#4cdda0;--bad:#ff7185;--shadow:0 18px 50px #02061755}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:radial-gradient(ellipse at 10% 0%,#17284a 0,transparent 38%),var(--bg);color:var(--txt);min-height:100vh}
header{padding:18px clamp(16px,4vw,40px);border-bottom:1px solid #ffffff12;position:sticky;top:0;background:#0b1020eF;backdrop-filter:blur(18px);z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px}
h1{font-size:20px;letter-spacing:-.04em;margin:0;font-weight:800}h1:before{content:"CW";display:inline-grid;place-items:center;font-size:11px;letter-spacing:0;width:32px;height:32px;margin-right:10px;border-radius:10px;background:linear-gradient(135deg,var(--acc),var(--acc2));color:#071124;vertical-align:middle}
h3{margin:0 0 8px;font-size:16px;letter-spacing:-.02em}main{padding:clamp(16px,3vw,32px);max-width:1160px;margin:0 auto}
#bar{padding:9px 12px;border:1px solid #67a7ff55;border-radius:12px;display:flex;gap:10px;align-items:center;background:#15284a;max-width:540px}#bar .n{flex:1;min-width:0;overflow-wrap:anywhere;color:#cfe2ff}#bar b{color:var(--acc)}
#app:not(.hidden){animation:enter .25s ease-out}@keyframes enter{from{opacity:.4;transform:translateY(5px)}to{opacity:1;transform:none}}
.card{background:linear-gradient(145deg,#141e33f2,#10182af5);border:1px solid var(--line);border-radius:18px;padding:clamp(16px,2vw,24px);margin:16px 0;box-shadow:var(--shadow);min-width:0}
#login{max-width:560px;margin:10vh auto}.tabs{display:flex;gap:8px;overflow-x:auto;margin:18px 0;padding:3px 1px 8px;scrollbar-width:thin}.tabs button{flex:none}
input,select,button,textarea{font:inherit;padding:11px 13px;border-radius:11px;border:1px solid #30415f;background:#0b1325;color:var(--txt);width:100%;min-width:0;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}
input:focus,select:focus,textarea:focus{border-color:var(--acc);box-shadow:0 0 0 3px #67a7ff20}input::placeholder,textarea::placeholder{color:#657794}
button{width:auto;cursor:pointer;font-weight:650;white-space:nowrap}button:hover{border-color:#7899c8;background:#1a2943}button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}button.pri{background:linear-gradient(135deg,#69b4ff,#8c8aff);border-color:transparent;color:#071225;font-weight:800}button.pri:hover{filter:brightness(1.08)}button.on{border-color:var(--acc);color:var(--acc);background:#172846}button.del{color:var(--bad);border-color:#743445;background:#281622}
label{display:block;margin:13px 0 6px;color:#bac8df;font-size:13px;font-weight:650;letter-spacing:.01em}.row{display:flex;gap:10px;align-items:center}.row>*{flex:1}.row>button{flex:none}
.item{display:flex;gap:12px;align-items:center;padding:13px 10px;border-bottom:1px solid #ffffff0d;min-width:0}.item:last-child{border:0}.item.sel{outline:2px solid var(--acc);outline-offset:-2px;border-radius:12px;background:#1b2b47}.item .t{flex:1;min-width:0;overflow-wrap:anywhere}
.mut{color:var(--mut);font-size:13px}.msg{margin:10px 0;min-height:1.2em;overflow-wrap:anywhere}.ok{color:var(--ok)}.bad{color:var(--bad)}.chk{display:flex;gap:10px;align-items:flex-start;margin:14px 0;padding:12px;border:1px solid #ffffff12;border-radius:12px;background:#ffffff04}.chk input{width:17px;height:17px;flex:none;margin-top:4px;accent-color:var(--acc)}.hidden{display:none!important}img.pt{width:48px;height:68px;object-fit:cover;border-radius:9px;background:#202b40;box-shadow:0 4px 12px #0004}
.who{padding:12px 14px;border-radius:12px;background:#15284a;margin:10px 0;border:1px solid #67a7ff24}.who.none{background:#321923;color:var(--bad);border-color:#743445}
#res,#slist,#ulist{margin-top:12px}textarea{resize:vertical;min-height:120px}small,.hint{color:var(--mut)}.tabs button{border-radius:999px;padding:9px 15px}
@media(min-width:900px){main{padding-top:28px}#app{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 20px;align-items:start}#app>.card,#app>.tabs{grid-column:1/-1}#app>.card{margin:10px 0}#app>.card:nth-of-type(2){grid-column:1/-1}}
@media(max-width:600px){header{align-items:flex-start;padding:14px 16px;flex-wrap:wrap}h1{font-size:18px}#bar{width:100%;max-width:none}main{padding:12px 12px 40px}.card{padding:15px;border-radius:15px;margin:12px 0}.row{align-items:stretch}.row>button{padding-inline:12px}.tabs{margin:12px 0}.item{align-items:flex-start}.item button{padding:8px 10px}input,select,textarea{font-size:16px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
</style></head><body>
<header><h1>CineWorld admin</h1><div id="bar" class="hidden"><div class="n" id="barn"></div><button id="clr">Change</button></div></header>
<main>
<div class="card" id="login"><label for="tok">Admin token</label><div class="row"><input id="tok" type="password" autocomplete="off"><button class="pri" id="go">Open</button></div><div class="msg bad" id="lmsg"></div></div>
<div id="app" class="hidden">
 <div class="card hidden bad" id="tmdbwarn">TMDB is not connected (set TMDB_API_KEY on the host). Search will find nothing and added films cannot be placed in the catalog.</div>
 <div class="card"><label for="q">1. Find a movie</label><div class="row"><input id="q" placeholder="Movie name"><button class="pri" id="find">Search</button></div>
  <div id="res"></div></div>
 <div class="tabs"><button data-tab="movies" class="on">Movies</button><button data-tab="sources">Sources</button><button data-tab="subs">Subtitles</button><button data-tab="backup">Backup</button></div>
 <section id="movies"><div class="card"><div class="mut">Pin = show first. Hide = remove everywhere. "Use" picks the movie for adding a source.</div><div id="feed"></div></div></section>
 <section id="sources" class="hidden"><div class="card" id="sform"><h3>2. Add video links</h3>
  <div class="who none" id="who1">No movie chosen yet. Search above and press Choose.</div>
  <div class="mut" id="shosts"></div>
  <label for="s_urls">Links, one per line. You can start a line with the quality: 4K, 1080p, 720p, 480p, 360p ...</label>
  <textarea id="s_urls" rows="5" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="1080p https://archive.org/download/item/movie.1080p.mkv&#10;720p https://archive.org/download/item/movie.720p.mp4&#10;https://archive.org/download/item/movie.mp4"></textarea>
  <label for="s_title">Label (optional)</label><input id="s_title" placeholder="e.g. Full movie">
  <label for="s_evidence">Rights evidence URL (required for custom hosts)</label><input id="s_evidence" inputmode="url" autocapitalize="off" placeholder="https://official-site.example/license-or-rights-page">
  <div class="mut">For additional hosts, configure PLAYBACK_ALLOWED_HOSTS on Render (comma-separated hostnames), then redeploy. Only add hosts where you have verified sharing rights.</div>
  <label for="s_lic">License</label><select id="s_lic"><option value="public-domain">Public domain</option><option value="cc0">CC0</option><option value="cc-by">CC BY</option><option value="cc-by-sa">CC BY-SA</option><option value="licensed">Licensed to me</option></select>
  <div class="chk"><input type="checkbox" id="s_ok"><label for="s_ok" style="margin:0;color:var(--txt)">I checked that I may share these videos.</label></div>
  <button class="pri" id="s_add">Add links</button><div class="msg" id="s_msg"></div></div>
  <div class="card"><h3>Added sources</h3><div id="slist"></div></div></section>
 <section id="subs" class="hidden"><div class="card"><h3>2. Add a subtitle</h3>
  <div class="who none" id="who2">No movie chosen yet. Search above and press Choose.</div>
  <div class="mut" id="uhosts"></div>
  <label for="u_url">Subtitle link (.srt or .vtt)</label><input id="u_url" inputmode="url" autocapitalize="off" placeholder="https://archive.org/download/item/movie.bn.srt">
  <label for="u_lang">Language</label><select id="u_lang"><option value="ben">Bangla</option><option value="eng">English</option><option value="hin">Hindi</option><option value="tam">Tamil</option><option value="tel">Telugu</option><option value="urd">Urdu</option><option value="kor">Korean</option><option value="jpn">Japanese</option><option value="zho">Chinese</option></select>
  <label for="u_lic">License</label><select id="u_lic"><option value="public-domain">Public domain</option><option value="cc0">CC0</option><option value="cc-by">CC BY</option><option value="cc-by-sa">CC BY-SA</option><option value="licensed">Licensed to me</option></select>
  <div class="chk"><input type="checkbox" id="u_ok"><label for="u_ok" style="margin:0;color:var(--txt)">I checked that I may share this subtitle.</label></div>
  <button class="pri" id="u_add">Add subtitle</button><div class="msg" id="u_msg"></div></div>
  <div class="card"><h3>Added subtitles</h3><div id="ulist"></div></div></section>
 <section id="backup" class="hidden"><div class="card"><h3>Backup</h3>
  <div class="mut">On free hosting the saved list can disappear at the next deploy. Download a backup now and then; paste it below to restore.</div>
  <p><button id="dl">Download backup</button></p><label for="rs">Restore from backup</label><textarea id="rs" rows="6" placeholder="Paste the backup text here"></textarea>
  <p><button class="pri" id="restore">Restore</button></p><div class="msg" id="b_msg"></div></div></section>
</div></main>
<script>
const $=id=>document.getElementById(id);let ov={pinned:[],hidden:[]},chosen=null;
const tok=()=>$('tok').value.trim();
async function api(path,method,body){const r=await fetch(path,{method:method||'GET',headers:{authorization:'Bearer '+tok(),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status===401?'Wrong token':r.status===429?'Too many tries, wait a few minutes':(d.reason||'Error '+r.status));return d}
function say(id,t,ok){const e=$(id);e.textContent=t;e.className='msg '+(ok?'ok':'bad')}
function btn(label,cls,fn){const b=document.createElement('button');b.textContent=label;if(cls)b.className=cls;b.onclick=fn;return b}
function itemImg(img,title,sub,id,...btns){const d=document.createElement('div');d.className='item'+(chosen&&id&&chosen.id===id?' sel':'');if(img){const i=document.createElement('img');i.className='pt';i.src=img;i.alt='';i.loading='lazy';d.append(i)}
 const t=document.createElement('div');t.className='t';t.textContent=title;if(sub){const s=document.createElement('div');s.className='mut';s.textContent=sub;t.append(s)}d.append(t,...btns);return d}
function item(title,sub,...btns){return itemImg(null,title,sub,null,...btns)}
function showTab(name){document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab===name));for(const s of ['movies','sources','subs','backup'])$(s).classList.toggle('hidden',s!==name)}
function label(m){return m.name+(m.year?' ('+m.year+')':'')}
function choose(m,go){chosen=m;const text='Movie: '+label(m);
 $('barn').textContent='';const b=document.createElement('b');b.textContent=text;$('barn').append(b);$('bar').classList.remove('hidden');
 for(const id of ['who1','who2']){const w=$(id);w.textContent=text;w.className='who'}
 document.querySelectorAll('#res .item').forEach(x=>x.classList.toggle('sel',x.dataset.id===m.id));
 if(go!==false){showTab('sources');if($('sform').scrollIntoView)$('sform').scrollIntoView({behavior:'smooth',block:'start'})}}
function unchoose(){chosen=null;$('bar').classList.add('hidden');for(const id of ['who1','who2']){const w=$(id);w.textContent='No movie chosen yet. Search above and press Choose.';w.className='who none'}document.querySelectorAll('.item.sel').forEach(x=>x.classList.remove('sel'))}
async function saveOv(){ov=await api('/api/admin/overrides','PUT',ov);await loadFeed()}
function toggle(list,id){const i=ov[list].indexOf(id);if(i>=0)ov[list].splice(i,1);else ov[list].push(id);const o=list==='pinned'?'hidden':'pinned';ov[o]=ov[o].filter(x=>x!==id);saveOv().catch(e=>alert(e.message))}
async function loadFeed(){const d=await api('/api/admin/feed');const box=$('feed');box.textContent='';
 if(!d.movies.length){box.textContent='Nothing yet. If TMDB is not set up, the list stays empty.';return}
 for(const m of d.movies){box.append(itemImg(null,label(m),ov.pinned.includes(m.id)?'Pinned':ov.hidden.includes(m.id)?'Hidden':'',m.id,
  btn('Use',null,()=>choose(m)),btn(ov.pinned.includes(m.id)?'Unpin':'Pin',null,()=>toggle('pinned',m.id)),btn(ov.hidden.includes(m.id)?'Unhide':'Hide',null,()=>toggle('hidden',m.id))))}}
async function loadSources(){const d=await api('/api/admin/sources');const box=$('slist');box.textContent='';
 if(!d.sources.length)box.textContent='No sources added yet.';
 for(const s of d.sources)box.append(item((s.movieName||s.movieId)+' · '+s.title+(s.quality?' · '+s.quality:''),s.license+' · '+s.host+(s.movieName?' · '+s.movieId:''),btn('Delete','del',async()=>{if(confirm('Delete this source?')){await api('/api/admin/sources/'+encodeURIComponent(s.id),'DELETE');loadSources()}})))}
async function loadSubs(){const d=await api('/api/admin/subtitles');const box=$('ulist');box.textContent='';
 if(!d.subtitles.length)box.textContent='No subtitles added yet.';
 for(const s of d.subtitles)box.append(item(s.lang+' · '+s.license,s.movieId+' · '+s.host,btn('Delete','del',async()=>{if(confirm('Delete this subtitle?')){await api('/api/admin/subtitles/'+encodeURIComponent(s.id),'DELETE');loadSubs()}})))}
async function open_(){try{sessionStorage.setItem('t',tok());const c=await api('/api/admin/config');ov=await api('/api/admin/overrides');
 $('login').classList.add('hidden');$('app').classList.remove('hidden');
 $('tmdbwarn').classList.toggle('hidden',!!c.tmdb);$('shosts').textContent='Allowed hosts: '+c.playbackHosts.join(', ');$('uhosts').textContent='Allowed hosts: '+c.subtitleHosts.join(', ');
 await Promise.all([loadFeed(),loadSources(),loadSubs()])}catch(e){$('lmsg').textContent=e.message}}
$('go').onclick=open_;$('tok').value=sessionStorage.getItem('t')||'';if($('tok').value)open_();
$('clr').onclick=unchoose;
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('find').onclick=async()=>{const q=$('q').value.trim();if(!q)return;const box=$('res');box.textContent='Searching...';
 try{const d=await api('/api/admin/search?q='+encodeURIComponent(q));box.textContent='';if(!d.movies.length)box.textContent='No movie found.';
  for(const m of d.movies){const row=itemImg(m.poster,label(m),m.id,m.id,btn('Choose','pri',()=>choose(m)));row.dataset.id=m.id;box.append(row)}}catch(e){box.textContent=e.message}};
$('q').addEventListener('keydown',e=>{if(e.key==='Enter')$('find').click()});
function parseLinks(text){
 const lines=text.split(/\\r?\\n/).map(l=>l.trim()).filter(Boolean), out=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  const qualityOnly=line.match(/^(4k|uhd|2160p?|1440p?|1080p?|720p?|480p?|360p?|240p?|auto|hls)$/i);
  if(qualityOnly && lines[i+1]){
   out.push({line:qualityOnly[1]+' '+lines[i+1],quality:qualityOnly[1],url:lines[++i]});
   continue;
  }
  const m=line.match(/^(4k|uhd|2160p?|1440p?|1080p?|720p?|480p?|360p?|240p?|auto|hls)\\s*[:|-]?\\s+(https?:\\/\\/\\S+)$/i);
  out.push(m?{line,quality:m[1],url:m[2]}:{line,quality:'',url:line});
 }
 return out;
}
$('s_add').onclick=async()=>{if(!chosen)return say('s_msg','Choose a movie first: search above, then press Choose.');
 const links=parseLinks($('s_urls').value);if(!links.length)return say('s_msg','Paste at least one video link.');
 let done=0,last=null,problems=[],left=[];
 for(const l of links){try{last=await api('/api/admin/sources','POST',{movieId:chosen.id,title:$('s_title').value,url:l.url,quality:l.quality,license:$('s_lic').value,rightsEvidenceUrl:$('s_evidence').value.trim()||undefined,rightsConfirmed:$('s_ok').checked});done++}catch(e){problems.push(e.message);left.push(l.line)}}
 $('s_urls').value=left.join('\\n');if(!done)$('s_ok').checked=$('s_ok').checked;
 const where=last&&last.placed?' Shown in: '+last.shownIn.join(', ')+'.':(last?' The movie could not be placed in a catalog (TMDB lookup failed). Check the TMDB key.':'');
 say('s_msg',(done?done+' added.'+where:'')+(problems.length?' '+problems.length+' refused: '+problems[0]:''),done>0&&!problems.length&&(!last||last.placed));
 if(done)loadSources()};
$('u_add').onclick=async()=>{if(!chosen)return say('u_msg','Choose a movie first: search above, then press Choose.');
 try{await api('/api/admin/subtitles','POST',{movieId:chosen.id,lang:$('u_lang').value,url:$('u_url').value,license:$('u_lic').value,rightsConfirmed:$('u_ok').checked});
  say('u_msg','Added.',true);$('u_url').value='';loadSubs()}catch(e){say('u_msg',e.message)}};
$('dl').onclick=async()=>{try{const d=await api('/api/admin/backup');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));a.download='cineworld-backup.json';a.click();say('b_msg','Backup downloaded.',true)}catch(e){say('b_msg',e.message)}};
$('restore').onclick=async()=>{try{const data=JSON.parse($('rs').value);if(!confirm('Replace the current lists with this backup?'))return;const r=await api('/api/admin/restore','POST',data);
 say('b_msg','Restored: '+r.sources+' sources, '+r.subtitles+' subtitles, '+r.movies+' movies.',true);ov=await api('/api/admin/overrides');loadFeed();loadSources();loadSubs()}catch(e){say('b_msg',e.message)}};
</script></body></html>`;

export interface PlaceResult { placed: boolean; categoryIds: string[]; name?: string }

export interface AdminDeps {
  getFeed: () => Promise<Movie[]>;
  searchMovies: (query: string) => Promise<Movie[]>;
  /** Looks the film up on TMDB and puts it in the catalog rows that match its language/country. */
  placeMovie: (movieId: string) => Promise<PlaceResult>;
  /** Removes films that lost their last source and places films that have a source but are not in the catalog yet. */
  syncCatalog: () => Promise<void>;
  tmdbConfigured: () => boolean;
}

const categoryLabel = (id: string) => CINEMA_CATEGORIES.find((category) => category.id === id)?.name ?? id;
const movieName = (id: string) => getCuratedMovie(id)?.name ?? getRememberedMovie(id)?.name;

export function createAdminRouter(deps: AdminDeps): Router {
  const router = express.Router();
  // Check the token before any request body is read or parsed.
  const auth = (req: Request, res: Response, next: () => void) => { if (authorized(req, res)) next(); };
  const guarded = (handler: (req: Request, res: Response) => void | Promise<void>) =>
    async (req: Request, res: Response) => {
      if (!authorized(req, res)) return;
      res.setHeader("cache-control", "no-store");
      try { await handler(req, res); } catch { res.status(500).json({ error: "server_error" }); }
    };

  // The page itself holds no data and no secrets; every API call needs the token.
  router.get("/admin", (_req, res) => {
    if (!process.env.ADMIN_API_TOKEN?.trim()) { res.status(404).json({ error: "not_found" }); return; }
    res.setHeader("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src https://image.tmdb.org data:; base-uri 'none'; form-action 'none'");
    res.setHeader("cache-control", "no-store");
    res.type("html").send(PAGE);
  });

  router.get("/api/admin/config", guarded((_req, res) => { res.json({ playbackHosts: PLAYBACK_HOSTS, subtitleHosts: SUBTITLE_HOSTS, tmdb: deps.tmdbConfigured() }); }));
  router.get("/api/admin/overrides", guarded((_req, res) => { res.json(getOverrides()); }));
  router.put("/api/admin/overrides", auth, express.json({ limit: "100kb" }), guarded((req, res) => { res.json(setOverrides(req.body)); }));
  router.get("/api/admin/feed", guarded(async (_req, res) => {
    const feed = await deps.getFeed();
    res.json({ movies: feed.map((movie) => ({ id: movieKey(movie), name: movie.name, year: movie.releaseInfo })) });
  }));
  router.get("/api/admin/search", guarded(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const movies = query ? await deps.searchMovies(query) : [];
    res.json({ movies: movies.slice(0, 12).map((movie) => ({ id: movieKey(movie), name: movie.name, year: movie.releaseInfo, poster: movie.poster ?? null })) });
  }));

  router.get("/api/admin/sources", guarded((_req, res) => { res.json({ sources: LEGAL_SOURCES.map((source) => ({ ...source, movieName: movieName(source.movieId) ?? null })) }); }));
  router.post("/api/admin/sources", auth, express.json({ limit: "20kb" }), guarded(async (req, res) => {
    const result = addLegalSource(req.body ?? {});
    if (!result.ok) { res.status(400).json({ error: "rejected", reason: result.reason }); return; }
    // The source is saved; now show the film in the catalog rows it belongs to (best effort: needs TMDB).
    const placement = await deps.placeMovie(result.source.movieId).catch((): PlaceResult => ({ placed: false, categoryIds: [] }));
    res.status(201).json({
      ...result.source,
      placed: placement.placed,
      movieName: placement.name ?? null,
      shownIn: placement.placed ? ["New Releases", ...placement.categoryIds.map(categoryLabel)] : []
    });
  }));
  router.delete("/api/admin/sources/:id", guarded(async (req, res) => {
    if (!removeLegalSource(String(req.params.id))) { res.status(404).json({ error: "not_found" }); return; }
    await deps.syncCatalog().catch(() => undefined); // a film with no source left leaves the catalog
    res.json({ ok: true });
  }));

  router.get("/api/admin/subtitles", guarded((_req, res) => { res.json({ subtitles: SUBTITLES }); }));
  router.post("/api/admin/subtitles", auth, express.json({ limit: "20kb" }), guarded((req, res) => {
    const result = addSubtitle(req.body ?? {});
    if (!result.ok) { res.status(400).json({ error: "rejected", reason: result.reason }); return; }
    res.status(201).json(result.record);
  }));
  router.delete("/api/admin/subtitles/:id", guarded((req, res) => {
    if (!removeSubtitle(String(req.params.id))) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  }));

  router.get("/api/admin/backup", guarded((_req, res) => {
    res.json({ overrides: getOverrides(), sources: LEGAL_SOURCES, subtitles: SUBTITLES, movies: listCurated() });
  }));
  // Restore re-validates every record, so a backup cannot smuggle in a link that the panel itself would refuse.
  router.post("/api/admin/restore", auth, express.json({ limit: "2mb" }), guarded(async (req, res) => {
    const body = (req.body ?? {}) as { overrides?: unknown; sources?: unknown; subtitles?: unknown; movies?: unknown };
    if (body.overrides !== undefined) setOverrides(body.overrides);
    const sources = replaceLegalSources(body.sources ?? []);
    const subtitles = replaceSubtitles(body.subtitles ?? []);
    replaceCurated(body.movies ?? []);
    await deps.syncCatalog().catch(() => undefined); // drops films without a source, re-places films missing from the backup
    res.json({ sources, subtitles, movies: listCurated().length, overrides: getOverrides() });
  }));
  // Malformed or oversized JSON gets a short JSON answer instead of a stack trace.
  router.use((_err: unknown, _req: Request, res: Response, _next: () => void) => { res.status(400).json({ error: "bad_request" }); });
  return router;
}
