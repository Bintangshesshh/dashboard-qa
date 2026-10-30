import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../server/package.json',import.meta.url));
const {WebSocket}=require('ws');
const base=process.env.VERIFY_API||'http://127.0.0.1:3001';
assert.equal(new URL(base).hostname,'127.0.0.1','Local verification only');
const email=process.env.VERIFY_EMAIL||('verify-'+Date.now()+'@local.test');
const password=process.env.VERIFY_PASSWORD||'local-verification-password';
const register=process.env.VERIFY_EMAIL?false:true;
let cookie='',csrf='';
async function auth(){
  if(register){
    const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Verification account',email,password})});
    const data=await res.json();
    assert.equal(res.status,201,JSON.stringify(data));
    cookie=res.headers.get('set-cookie').split(';')[0];csrf=data.csrfToken;return;
  }
  const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const data=await res.json();
  assert.equal(res.status,200,JSON.stringify(data));
  cookie=res.headers.get('set-cookie').split(';')[0];csrf=data.csrfToken;
}
async function api(path,method='GET',body){
  const res=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json',...(method==='GET'?{}:{'X-CSRF-Token':csrf})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=res.status===204?null:await res.json();
  assert.ok(res.ok,JSON.stringify(data));return data;
}
assert.equal((await fetch(base+'/api/suites')).status,401);
assert.equal((await api('/health')).database,'sqlite');
await auth();
assert.equal((await fetch(base+'/api/auth',{headers:{Cookie:cookie}}).then(r=>r.json())).authenticated,true);
const suite=await api('/suites','POST',{name:'Local verification',description:'Integration check against local fixture only',targetUrl:'http://127.0.0.1:4173'});
await api('/suites/'+suite.id,'PATCH',{name:'Local verification updated',description:suite.description,targetUrl:suite.targetUrl});
const test=await api('/suites/'+suite.id+'/cases','POST',{name:'Browser and API smoke',enabled:true,code:"import {test,expect} from '@playwright/test';\ntest('local action',async({page,request})=>{await page.goto('/');await expect(page.getByRole('heading')).toHaveText('QA verification fixture');await page.getByRole('button',{name:'Run action'}).click();await expect(page.getByRole('status')).toHaveText('Action completed');const res=await request.get('/api/health');expect(res.ok()).toBeTruthy();});"});
assert.equal((await api('/suites/'+suite.id+'/cases')).length,1);
await api('/cases/'+test.id,'PATCH',{name:'Browser and API verified',enabled:true,code:test.code});
const run=await api('/runs','POST',{suiteId:suite.id,mode:process.env.VERIFY_MODE||'pw',headed:false});
console.log('Run created',run.id);
const socket=new WebSocket(base.replace(/^http/,'ws')+'/ws',{headers:{Cookie:cookie}});
const logs=[];
socket.on('open',()=>socket.send(JSON.stringify({type:'subscribe',runId:run.id,after:0})));
socket.on('message',data=>{const event=JSON.parse(data.toString());if(event.type==='log'){logs.push(event);process.stdout.write(event.text);}});
socket.on('error',err=>console.error('WebSocket:',err.message));
let latest;
const deadline=Date.now()+900000;
while(Date.now()<deadline){latest=await api('/runs/'+run.id);if(['passed','failed','cancelled','error','completed','interrupted'].includes(latest.status)&&(latest.reportUrl||latest.docsStatus==='failed'||latest.status==='cancelled'))break;await new Promise(r=>setTimeout(r,1000));}
socket.close();
console.log(JSON.stringify(latest,null,2));
assert.equal(latest.status,'passed');
assert.ok(logs.length>0,'WebSocket must stream native logs');
assert.ok(latest.reportUrl,'Docusaurus report must exist');
const report=await fetch(base+latest.reportUrl,{headers:{Cookie:cookie}});
assert.equal(report.status,200);
assert.match(await report.text(),/QA|report|Report/);
const persisted=await api('/runs/'+run.id+'/logs');assert.ok(persisted.logs.length>0);
await api('/cases/'+test.id,'DELETE');
assert.equal((await api('/suites/'+suite.id+'/cases')).length,0);
await api('/suites/'+suite.id,'DELETE');
console.log('PASS: account session, suite/case CRUD, SQLite, execution, live logs, persisted replay, Docusaurus report');
