import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { allowlist, target, id, cursor, authorized, pagination } from '../validation.mjs';
import { createApp, attachWebSocket } from '../index.mjs';
import { Runner, checkTarget } from '../runner.mjs';
import { Store, databasePath } from '../store.mjs';
const token='test-operator-token-at-least-24';
class FixtureStore {
  data={suites:new Map(),cases:new Map(),runs:new Map(),categories:new Map()};entries=[];
  async ping(){}
  async get(k,id){return this.data[k].get(id);}
  async put(k,value){this.data[k].set(value.id,structuredClone(value));return value;}
  async patch(k,id,transform){const old=this.data[k].get(id);return old?this.put(k,transform(structuredClone(old))):undefined;}
  async list(k,suiteId){return [...this.data[k].values()].filter(x=>!suiteId||x.suiteId===suiteId);}
  async count(k){return this.data[k].size;}
  async delete(k,id){return this.data[k].delete(id);}
  async deleteCategory(id){this.data.categories.delete(id);return true;}
  async log(runId,value){this.entries.push({runId,...value});}
  async logs(runId,after,limit=5000){
    const all=this.entries.filter(x=>x.runId===runId&&x.seq>after);
    return {logs:all.slice(0,limit),hasMore:all.length>limit,nextAfter:all.length?all[Math.min(all.length,limit)-1].seq:after};
  }
  async logsRaw(runId,after=0){return this.entries.filter(x=>x.runId===runId&&x.seq>after);}
  async logsText(runId){return this.entries.filter(x=>x.runId===runId).map(x=>x.text).join('');}
}
async function serve(t,app){const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});return {server,url:'http://127.0.0.1:'+server.address().port};}
test('trust boundary rejects malformed IDs, origins and cursors',()=>{
  assert.deepEqual(allowlist('http://localhost:1234,https://example.test'),['http://localhost:1234','https://example.test']);
  assert.equal(databasePath(':memory:'),':memory:');
  assert.equal(databasePath('sqlite:./data/qa.db'),resolve('data/qa.db'));
  assert.equal(databasePath('file:/tmp/qa.db'),'/tmp/qa.db');
  assert.throws(()=>databasePath(''),/DATABASE_URL is required/);
  assert.throws(()=>allowlist('https://example.test/path'));
  for(const value of ['file:///etc/passwd','http://bad.test','http://user:pass@localhost'])assert.throws(()=>target(value,['http://localhost']));
  assert.equal(target('http://localhost/path',['http://localhost']),'http://localhost/path');
  assert.throws(()=>id('../foo'));assert.throws(()=>cursor(-1));assert.throws(()=>cursor('nan'));
  assert.equal(authorized(token,token),true);assert.equal(authorized('bad',token),false);
  // Pagination validation
  assert.deepEqual(pagination({}),{limit:50,offset:0});
  assert.deepEqual(pagination({limit:'10',offset:'5'}),{limit:10,offset:5});
  assert.throws(()=>pagination({limit:'-1'}),/limit/);
  assert.throws(()=>pagination({limit:'999'}),/limit/);
  assert.throws(()=>pagination({offset:'-1'}),/offset/);
  assert.throws(()=>pagination({offset:'abc'}),/offset/);
});
test('HTTP auth, suite and case CRUD, session CSRF and validation',async t=>{
  const store=new FixtureStore(),runner=new EventEmitter();runner.directory=()=>tmpdir();
  const {url}=await serve(t,createApp({store,runner,token,origins:['http://localhost']}));
  const call=(path,method='GET',body,auth=true)=>fetch(url+path,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await call('/api/suites','GET',null,false)).status,401);
  assert.equal((await call('/api/health','GET',null,false)).status,200);
  assert.equal((await call('/api/suites','POST',{name:'bad',targetUrl:'https://outside.test'})).status,400);
  const suite=await (await call('/api/suites','POST',{name:'Local',targetUrl:'http://localhost'})).json();assert.ok(suite.id);
  const item=await (await call('/api/suites/'+suite.id+'/cases','POST',{name:'smoke',code:'test(1)'})).json();assert.equal(item.suiteId,suite.id);
  assert.equal((await call('/api/cases/'+item.id,'PATCH',{enabled:false})).status,200);
  const session=await call('/api/session','POST',{});const cookie=session.headers.get('set-cookie').split(';')[0];
  assert.match(session.headers.get('set-cookie'),/SameSite=Lax/i);
  assert.equal((await fetch(url+'/api/suites',{headers:{cookie}})).status,200);
  assert.equal((await fetch(url+'/api/session',{method:'DELETE',headers:{cookie,'sec-fetch-site':'cross-site'}})).status,401);
  assert.equal((await fetch(url+'/api/suites',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(url+'/api/cases/'+item.id,{method:'DELETE',headers:{cookie}})).status,401);
  assert.equal((await fetch(url+'/api/session',{method:'DELETE',headers:{cookie,origin:'https://outside.invalid'}})).status,401);
  const logout=await fetch(url+'/api/session',{method:'DELETE',headers:{cookie,origin:url}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/qa_session=;/);
  assert.equal((await call('/api/cases/'+item.id,'DELETE')).status,204);
  assert.equal((await call('/api/suites/'+suite.id,'DELETE')).status,204);
});
test('report index redirects once and serves authenticated assets',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-report-route-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'docs'));await writeFile(join(dir,'docs','index.html'),'<h1>Failure report</h1>');
  const store=new FixtureStore(),runner=new EventEmitter(),run={id:randomUUID(),status:'failed'};
  runner.directory=()=>dir;await store.put('runs',run);
  const {url}=await serve(t,createApp({store,runner,token,origins:[]}));
  const path='/reports/'+run.id+'/docs',headers={authorization:'Bearer '+token};
  assert.equal((await fetch(url+path+'/')).status,401);
  const redirect=await fetch(url+path,{headers,redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),path+'/');
  const page=await fetch(url+path+'/',{headers});assert.equal(page.status,200);assert.match(await page.text(),/Failure report/);
});
test('WebSocket replays ordered persisted logs and delivers live logs',async t=>{
  const store=new FixtureStore(),runner=new EventEmitter(),run={id:randomUUID(),status:'running'};await store.put('runs',run);
  await store.log(run.id,{seq:1,stream:'stdout',text:'one',at:'now'});await store.log(run.id,{seq:2,stream:'stdout',text:'two',at:'now'});
  const {server,url}=await serve(t,(req,res)=>res.end());const wss=attachWebSocket(server,{store,runner,token});
  t.after(()=>{for(const ws of wss.clients)ws.terminate();wss.close();});
  const ws=new WebSocket(url.replace('http:','ws:')+'/ws');await once(ws,'open');t.after(()=>ws.terminate());
  const received=[];ws.on('message',data=>received.push(JSON.parse(data)));
  const replay=new Promise(resolve=>ws.on('message',data=>{if(JSON.parse(data).type==='replay-complete')resolve();}));
  ws.send(JSON.stringify({type:'subscribe',token,runId:run.id,after:1}));await replay;
  assert.deepEqual(received.filter(x=>x.type==='log').map(x=>x.seq),[2]);
  const live=once(ws,'message');runner.emit('log',{type:'log',runId:run.id,seq:3,text:'three'});assert.equal(JSON.parse((await live)[0]).seq,3);
});
test('closed subscription does not attach runner listeners after database lookup',async t=>{
  const runner=new EventEmitter();let release,entered;const lookup=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const store={get:async()=>{entered();await lookup;return {id:randomUUID()};},logs:async()=>({logs:[],hasMore:false,nextAfter:0})};
  const {server,url}=await serve(t,(req,res)=>res.end());const wss=attachWebSocket(server,{store,runner,token});t.after(()=>wss.close());
  const ws=new WebSocket(url.replace('http:','ws:')+'/ws');await once(ws,'open');
  ws.send(JSON.stringify({type:'subscribe',token,runId:randomUUID()}));await started;
  const closed=once([...wss.clients][0],'close');ws.close();await closed;release();await new Promise(setImmediate);
  assert.equal(runner.listenerCount('log'),0);assert.equal(runner.listenerCount('status'),0);
});
test('patch updates only an existing row and rolls back invalid changes',async t=>{
  const store=new Store(':memory:');await store.init();t.after(()=>store.close());
  const suite={id:randomUUID(),name:'current',createdAt:new Date().toISOString()};await store.put('suites',suite);
  assert.deepEqual(await store.patch('suites',suite.id,old=>({...old,name:'new'})),{...suite,name:'new'});
  assert.equal((await store.get('suites',suite.id)).name,'new');
  assert.equal(await store.patch('suites',randomUUID(),()=>assert.fail('missing row must not transform')),undefined);
  await assert.rejects(store.patch('suites',suite.id,()=>{throw new Error('invalid');}),/invalid/);
  assert.equal((await store.get('suites',suite.id)).name,'new');
});
test('startup recovery separates execution and report interruption',async t=>{
  const store=new Store(':memory:');await store.init();t.after(()=>store.close());
  const running={id:randomUUID(),status:'running',docsStatus:'building'};
  const generating={id:randomUUID(),status:'passed',docsStatus:'building'};
  const finished={id:randomUUID(),status:'passed',docsStatus:'built'};
  for(const run of [running,generating,finished])await store.put('runs',run);
  await store.init();
  const interrupted=await store.get('runs',running.id);
  assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.docsStatus,'interrupted');
  assert.match(interrupted.error,/restarted/);assert.ok(interrupted.finishedAt);
  const reportOnly=await store.get('runs',generating.id);
  assert.equal(reportOnly.status,'passed');assert.equal(reportOnly.docsStatus,'interrupted');
  assert.match(reportOnly.docsError,/report generation/);assert.equal(reportOnly.finishedAt,undefined);
  assert.deepEqual(await store.get('runs',finished.id),finished);
});
test('redirect preflight blocks unapproved origins without following them',async t=>{
  const {url}=await serve(t,(req,res)=>{res.writeHead(302,{location:'https://not-allowlisted.invalid'});res.end();});
  await assert.rejects(checkTarget(url,[url]),/not allowlisted/);
});
test('runner captures process output and cancellation kills child',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-runner-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new FixtureStore(),runner=new Runner(store,{runsDir:dir,docs:false,timeout:5000});
  const run={id:randomUUID(),status:'running'},state={run,seq:0,chain:Promise.resolve(),cancelled:false};runner.active=state;
  await mkdir(join(dir,run.id));await writeFile(join(dir,run.id,'logs.txt'),'');
  const logged=once(runner,'log');const command=runner.command(state,['-e','console.log("ready");setInterval(()=>{},1000)']);
  await logged;assert.equal(await runner.cancel(run.id),true);await command;await state.chain;
  const result=await store.logsRaw(run.id,0);
  assert.match(result[0].text,/ready/);assert.equal(state.cancelled,true);
});
test('real Playwright executes generated TypeScript case and CommonJS fixture',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-playwright-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {url}=await serve(t,(req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Local QA</title>');});
  const store=new FixtureStore(),runner=new Runner(store,{runsDir:dir,origins:[url],docs:false,timeout:30000});
  const run={id:randomUUID(),targetUrl:url,mode:'pw',headed:false,status:'queued'};
  await store.put('runs',run);
  await runner.start(run,[{id:randomUUID(),code:"import {test,expect} from '@playwright/test'; test('generated fixture loads', async()=> { const n: number=2; expect(n).toBe(2); });"}]);
  const result=await store.get('runs',run.id);
  const allLogs=await store.logsRaw(run.id,0);
  assert.equal(result.status,'passed',allLogs.map(x=>x.text).join(''));
  assert.equal(result.summary.passed,1);assert.ok(result.artifacts.includes('playwright.json'));
});
test('SQLite data persists across connections and merges concurrent patches',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-sqlite-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'qa.db');
  const first=new Store('sqlite:'+file);await first.init();const suite={id:randomUUID(),name:'persistence',createdAt:new Date().toISOString()};await first.put('suites',suite);await first.close();
  const second=new Store('sqlite:'+file);await second.init();t.after(()=>second.close());
  assert.deepEqual(await second.get('suites',suite.id),suite);
  await Promise.all([second.patch('suites',suite.id,old=>({...old,name:'renamed'})),second.patch('suites',suite.id,old=>({...old,description:'concurrent edit'}))]);
  const merged=await second.get('suites',suite.id);assert.equal(merged.name,'renamed');assert.equal(merged.description,'concurrent edit');
  await second.delete('suites',suite.id);
  assert.equal(await second.patch('suites',suite.id,old=>({...old,name:'resurrected'})),undefined);
  assert.equal(await second.get('suites',suite.id),undefined);
});

// ─── New feature tests ─────────────────────────────────────────────────────

test('category CRUD and suite categoryId lifecycle',async t=>{
  const store=new FixtureStore(),runner=new EventEmitter();runner.directory=()=>tmpdir();
  const {url}=await serve(t,createApp({store,runner,token,origins:['http://localhost']}));
  const call=(path,method='GET',body,auth=true)=>fetch(url+path,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  // Create category
  const cat=await (await call('/api/categories','POST',{name:'Frontend',description:'Web tests'})).json();
  assert.ok(cat.id);assert.equal(cat.name,'Frontend');
  // List categories
  const cats=await (await call('/api/categories')).json();
  assert.equal(cats.length,1);
  // Get single
  assert.equal((await (await call('/api/categories/'+cat.id)).json()).name,'Frontend');
  // Patch
  const updated=await (await call('/api/categories/'+cat.id,'PATCH',{name:'Frontend v2'})).json();
  assert.equal(updated.name,'Frontend v2');
  // Create suite with categoryId
  const suite=await (await call('/api/suites','POST',{name:'CatSuite',targetUrl:'http://localhost',categoryId:cat.id})).json();
  assert.equal(suite.categoryId,cat.id);
  // Suite with invalid categoryId → 400
  assert.equal((await call('/api/suites','POST',{name:'Bad',targetUrl:'http://localhost',categoryId:randomUUID()})).status,400);
  // Delete category → suite.categoryId becomes null
  assert.equal((await call('/api/categories/'+cat.id,'DELETE')).status,204);
  // Auth: mutation without bearer → 401
  assert.equal((await call('/api/categories','POST',{name:'Unauth'},false)).status,401);
});

test('run pagination returns correct slices and X-Total-Count',async t=>{
  const store=new FixtureStore(),runner=new EventEmitter();runner.directory=()=>tmpdir();
  const {url}=await serve(t,createApp({store,runner,token,origins:['http://localhost']}));
  const call=(path,method='GET',body)=>fetch(url+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});
  // Create 3 runs in fixture store
  for(let i=0;i<3;i++) await store.put('runs',{id:randomUUID(),status:'passed',createdAt:new Date(Date.now()+i*1000).toISOString()});
  // limit=1&offset=0
  const r1=await call('/api/runs?limit=1&offset=0');
  const data1=await r1.json();
  assert.equal(data1.length,1);
  assert.equal(r1.headers.get('X-Total-Count'),'3');
  // limit=1&offset=1 returns different item
  const r2=await call('/api/runs?limit=1&offset=1');
  const data2=await r2.json();
  assert.equal(data2.length,1);
  assert.notEqual(data1[0].id,data2[0].id);
  // Invalid pagination → 400
  assert.equal((await call('/api/runs?limit=-1')).status,400);
  assert.equal((await call('/api/runs?offset=-1')).status,400);
  assert.equal((await call('/api/runs?offset=abc')).status,400);
});

test('log limit and download endpoint',async t=>{
  const store=new Store(':memory:');await store.init();t.after(()=>store.close());
  const run={id:randomUUID(),status:'passed',createdAt:new Date().toISOString()};
  await store.put('runs',run);
  // Insert 10 log entries
  for(let i=1;i<=10;i++) await store.log(run.id,{seq:i,text:'line '+i+'\n',stream:'stdout',at:new Date().toISOString()});
  // Default limit returns all 10 (under 5000)
  const result=await store.logs(run.id,0);
  assert.equal(result.logs.length,10);
  assert.equal(result.hasMore,false);
  // limit=3 returns first 3 with hasMore=true
  const limited=await store.logs(run.id,0,3);
  assert.equal(limited.logs.length,3);
  assert.equal(limited.hasMore,true);
  assert.equal(limited.nextAfter,3);
  // logsText returns joined text
  const text=await store.logsText(run.id);
  assert.match(text,/line 1/);
  assert.match(text,/line 10/);
});

test('category CRUD with real SQLite store',async t=>{
  const store=new Store(':memory:');await store.init();t.after(()=>store.close());
  const cat={id:randomUUID(),name:'Backend',description:'API tests',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await store.put('categories',cat);
  assert.deepEqual(await store.get('categories',cat.id),cat);
  // Suite with categoryId
  const suite={id:randomUUID(),name:'APISuite',categoryId:cat.id,createdAt:new Date().toISOString()};
  await store.put('suites',suite);
  assert.equal((await store.get('suites',suite.id)).categoryId,cat.id);
  // Delete category → suite.categoryId becomes null
  await store.deleteCategory(cat.id);
  assert.equal(await store.get('categories',cat.id),undefined);
  const updatedSuite=await store.get('suites',suite.id);
  assert.equal(updatedSuite.categoryId,null);
  assert.equal(updatedSuite.name,'APISuite'); // suite still exists
});
