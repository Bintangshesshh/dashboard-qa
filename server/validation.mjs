import { timingSafeEqual } from 'node:crypto';
export function fail(message,status=400) { throw Object.assign(new Error(message),{status}); }
export function id(value) { if(typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('Invalid ID'); return value; }
export function text(value,name,max=200) { if(typeof value!=='string'||!value.trim()||value.length>max) fail(name+' must contain 1–'+max+' characters'); return value; }
export function allowlist(value='') { return value.split(',').filter(Boolean).map(entry=>{ const u=new URL(entry.trim()); if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash) throw new Error('TARGET_ALLOWLIST entries must be HTTP(S) origins'); return u.origin; }); }
export function target(value,origins) { let u; try { u=new URL(value); } catch { fail('Invalid targetUrl'); } if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!origins.includes(u.origin)) fail('Target origin is not allowlisted'); return u.href; }
export function authorized(value,token) { if(typeof value!=='string'||!token) return false; const a=Buffer.from(value),b=Buffer.from(token); return a.length===b.length && timingSafeEqual(a,b); }
export function cursor(value=0) { const n=Number(value); if(!Number.isSafeInteger(n)||n<0) fail('Invalid log cursor'); return n; }
export function suiteInput(body,origins) { return {name:text(body.name,'name'),description:typeof body.description==='string'?body.description.slice(0,10000):'',targetUrl:target(body.targetUrl,origins)}; }
export function caseInput(body) { if(body.enabled!==undefined&&typeof body.enabled!=='boolean') fail('enabled must be boolean'); return {name:text(body.name,'name'),code:text(body.code,'code',200000),enabled:body.enabled??true}; }
