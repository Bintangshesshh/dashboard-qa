import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { allowlist, target, id, cursor, authorized } from '../validation.mjs';
import { createApp, attachWebSocket } from '../index.mjs';
import { Runner, checkTarget } from '../runner.mjs';
import { Store } from '../store.mjs';
const token='test-operator-token-at-least-24';
class FixtureStore {
  data={suites:new Map(),cases:new Map(),runs:new Map()};entries=[];pool={query:async()=>({rows:[]})};
  async get(k,id){return this.data[k].get(id);}
  async put(k,value){this.data[k].set(value.id,structuredClone(value));return value;}
  async patch(k,id,transform){const old=this.data[k].get(id);return old?this.put(k,transform(structuredClone(old))):undefined;}
  async list(k,suiteId){return [...this.data[k].values()].filter(x=>!suiteId||x.suiteId===suiteId);}
  async delete(k,id){return this.data[k].delete(id);}
  async log(runId,value){this.entries.push({runId,...value});}
  async logs(runId,after){return this.entries.filter(x=>x.runId===runId&&x.seq>after);}
}
async function serve(t,app){const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});return {server,url:'http://127.0.0.1:'+server.address().port};}
test('trust boundary rejects malformed IDs, origins and cursors',()=>{
  assert.deepEqual(allowlist('http://localhost:1234,https://example.test'),['http://localhost:1234','https://example.test']);
  assert.throws(()=>allowlist('https://example.test/path'));
  for(const value of ['file:///etc/passwd','http://bad.test','http://user:pass@localhost'])assert.throws(()=>target(value,['http://localhost']));
  assert.equal(target('http://localhost/path',['http://localhost']),'http://localhost/path');
  assert.throws(()=>id('../foo'));assert.throws(()=>cursor(-1));assert.throws(()=>cursor('nan'));
  assert.equal(authorized(token,token),true);assert.equal(authorized('bad',token),false);
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
  const store={get:async()=>{entered();await lookup;return {id:randomUUID()};},logs:async()=>[]};
  const {server,url}=await serve(t,(req,res)=>res.end());const wss=attachWebSocket(server,{store,runner,token});t.after(()=>wss.close());
  const ws=new WebSocket(url.replace('http:','ws:')+'/ws');await once(ws,'open');
  ws.send(JSON.stringify({type:'subscribe',token,runId:randomUUID()}));await started;
  const closed=once([...wss.clients][0],'close');ws.close();await closed;release();await new Promise(setImmediate);
  assert.equal(runner.listenerCount('log'),0);assert.equal(runner.listenerCount('status'),0);
});
test('patch locks current row, updates only, and rolls back invalid changes',async()=>{
  const queries=[];let released=0,exists=true;
  const client={query:async(sql,args)=>{queries.push(sql);return {rows:sql.startsWith('SELECT')&&exists?[{data:{id:'x',name:'current'}}]:[]};},release:()=>released++};
  const store=Object.assign(Object.create(Store.prototype),{pool:{connect:async()=>client}});
  assert.deepEqual(await store.patch('suites','x',old=>({...old,name:'new'})),{id:'x',name:'new'});
  assert.deepEqual(queries,['BEGIN','SELECT data FROM qa_suites WHERE id=$1 FOR UPDATE','UPDATE qa_suites SET data=$2 WHERE id=$1','COMMIT']);
  queries.length=0;exists=false;assert.equal(await store.patch('suites','x',()=>assert.fail('missing row must not transform')),undefined);
  assert.deepEqual(queries,['BEGIN','SELECT data FROM qa_suites WHERE id=$1 FOR UPDATE','COMMIT']);
  queries.length=0;exists=true;await assert.rejects(store.patch('suites','x',()=>{throw new Error('invalid');}),/invalid/);assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,3);
});
test('startup recovery separates execution and report interruption',async()=>{
  const queries=[];await Store.prototype.init.call({pool:{query:async sql=>{queries.push(sql);}}});
  assert.match(queries[1],/WHERE data->>'status' IN/);assert.doesNotMatch(queries[1],/OR data->>'docsStatus'/);
  assert.match(queries[2],/'docsStatus','interrupted'/);assert.doesNotMatch(queries[2],/'status',|'finishedAt',/);
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
  assert.match((await store.logs(run.id,0))[0].text,/ready/);assert.equal(state.cancelled,true);
});
test('real Playwright executes generated TypeScript case and CommonJS fixture',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-playwright-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {url}=await serve(t,(req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Local QA</title>');});
  const store=new FixtureStore(),runner=new Runner(store,{runsDir:dir,origins:[url],docs:false,timeout:30000});
  const run={id:randomUUID(),targetUrl:url,mode:'pw',headed:false,status:'queued'};
  await store.put('runs',run);
  await runner.start(run,[{id:randomUUID(),code:"import {test,expect} from '@playwright/test'; test('generated fixture loads', async()=> { const n: number=2; expect(n).toBe(2); });"}]);
  const result=await store.get('runs',run.id);
  assert.equal(result.status,'passed',(await store.logs(run.id,0)).map(x=>x.text).join(''));
  assert.equal(result.summary.passed,1);assert.ok(result.artifacts.includes('playwright.json'));
});
test('PostgreSQL data persists across connections',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const first=new Store(process.env.TEST_DATABASE_URL);await first.init();const suite={id:randomUUID(),name:'persistence',createdAt:new Date().toISOString()};await first.put('suites',suite);await first.close();
  const second=new Store(process.env.TEST_DATABASE_URL);
  try {
    assert.deepEqual(await second.get('suites',suite.id),suite);
    await Promise.all([second.patch('suites',suite.id,old=>({...old,name:'renamed'})),second.patch('suites',suite.id,old=>({...old,description:'concurrent edit'}))]);
    const merged=await second.get('suites',suite.id);assert.equal(merged.name,'renamed');assert.equal(merged.description,'concurrent edit');
    await second.delete('suites',suite.id);
    assert.equal(await second.patch('suites',suite.id,old=>({...old,name:'resurrected'})),undefined);
    assert.equal(await second.get('suites',suite.id),undefined);
  } finally {await second.delete('suites',suite.id);await second.close();}
});
