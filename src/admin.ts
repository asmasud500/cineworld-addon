import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { Request, Response, Router } from "express";
import type { Movie } from "./catalog.js";
import { getOverrides, movieKey, setOverrides } from "./overrides.js";

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
<style>body{font:16px system-ui;margin:0;padding:16px;background:#111;color:#eee}input,button{font:inherit;padding:8px;border-radius:6px;border:1px solid #444;background:#222;color:#eee}
button{cursor:pointer}li{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #333}li span{flex:1}ul{list-style:none;padding:0}.p{color:#6cf}.h{color:#f77}</style></head>
<body><h1>CineWorld admin</h1><p>Pin = show first. Hide = remove everywhere.</p>
<p><input id="t" type="password" placeholder="Admin token"> <button id="go">Load</button></p><p id="m"></p><ul id="l"></ul>
<script>
const $=id=>document.getElementById(id);let ov={pinned:[],hidden:[]};
$('t').value=sessionStorage.getItem('t')||'';
const hdr=()=>({authorization:'Bearer '+$('t').value.trim(),'content-type':'application/json'});
async function api(path,opt){const r=await fetch(path,{...opt,headers:hdr()});if(!r.ok)throw new Error(r.status===401?'Wrong token':'Error '+r.status);return r.json()}
async function save(){ov=await api('/api/admin/overrides',{method:'PUT',body:JSON.stringify(ov)});await load()}
function toggle(list,id){const i=ov[list].indexOf(id);if(i>=0)ov[list].splice(i,1);else ov[list].push(id);const other=list==='pinned'?'hidden':'pinned';ov[other]=ov[other].filter(x=>x!==id);save().catch(e=>$('m').textContent=e.message)}
async function load(){try{sessionStorage.setItem('t',$('t').value.trim());ov=await api('/api/admin/overrides');const d=await api('/api/admin/feed');const ul=$('l');ul.textContent='';
for(const m of d.movies){const li=document.createElement('li');const s=document.createElement('span');s.textContent=m.name+(m.year?' ('+m.year+')':'');
if(ov.pinned.includes(m.id)){s.className='p'}if(ov.hidden.includes(m.id)){s.className='h'}
const a=document.createElement('button');a.textContent=ov.pinned.includes(m.id)?'Unpin':'Pin';a.onclick=()=>toggle('pinned',m.id);
const b=document.createElement('button');b.textContent=ov.hidden.includes(m.id)?'Unhide':'Hide';b.onclick=()=>toggle('hidden',m.id);li.append(s,a,b);ul.append(li)}
$('m').textContent=d.movies.length+' movies'}catch(e){$('m').textContent=e.message}}
$('go').onclick=load;if($('t').value)load();
</script></body></html>`;

export function createAdminRouter(getFeed: () => Promise<Movie[]>): Router {
  const router = express.Router();
  // The page itself holds no data and no secrets; every API call needs the token.
  router.get("/admin", (_req, res) => {
    if (!process.env.ADMIN_API_TOKEN?.trim()) { res.status(404).json({ error: "not_found" }); return; }
    res.setHeader("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    res.setHeader("cache-control", "no-store");
    res.type("html").send(PAGE);
  });
  router.get("/api/admin/overrides", (req, res) => { if (authorized(req, res)) res.setHeader("cache-control", "no-store").json(getOverrides()); });
  router.put("/api/admin/overrides", express.json({ limit: "100kb" }), (req, res) => {
    if (!authorized(req, res)) return;
    res.setHeader("cache-control", "no-store").json(setOverrides(req.body));
  });
  router.get("/api/admin/feed", async (req, res) => {
    if (!authorized(req, res)) return;
    const feed = await getFeed();
    res.setHeader("cache-control", "no-store").json({
      movies: feed.map((movie) => ({ id: movieKey(movie), name: movie.name, year: movie.releaseInfo }))
    });
  });
  return router;
}
