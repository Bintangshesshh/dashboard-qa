import { chromium } from '../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base=process.env.QA_WEB_URL||'http://127.0.0.1:3000';
const token=process.env.OPERATOR_TOKEN||'local-verification-token-32-characters';
const target=process.env.QA_TARGET_URL||'http://127.0.0.1:4173';
for(const value of [base,target]){const url=new URL(value);assert.ok(['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Local-only base and target required');}
const browser=await chromium.launch({headless:true});
const suffix=Date.now();
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let forceWsFailure=false,wsAttempts=0,notifyAttempt;const attempted=new Promise(resolve=>{notifyAttempt=resolve});
 // Install before navigation so Playwright instruments this document's WebSocket constructor.
 await page.routeWebSocket('**/ws',ws=>{if(!forceWsFailure){ws.connectToServer();return}wsAttempts++;notifyAttempt();ws.close()});
 await page.goto(base);
 await page.getByRole('button',{name:'Connect workspace',exact:true}).click();
 await page.getByLabel('Operator token').fill(token);
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByText('Operator connected',{exact:true}).waitFor();
 const createSuite=async name=>{await page.getByRole('button',{name:'New suite',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill(name);await page.getByLabel('Target URL').fill(target);await page.getByRole('button',{name:'Create suite',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});};
 const launch=async label=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/runs')&&r.request().method()==='POST');await page.getByRole('button',{name:label,exact:true}).click();const result=await response;assert.equal(result.status(),202);return result.json();};
 const waitReport=async id=>{await page.waitForFunction(id=>document.querySelector('[aria-label="Terminal run"]')?.value===id,id);await page.getByRole('log').getByText('[target]',{exact:false}).waitFor({timeout:30000});await page.locator('.run-summary').getByRole('link',{name:'Open report',exact:true}).waitFor({timeout:240000});const href=await page.locator('.run-summary').getByRole('link',{name:'Open report',exact:true}).getAttribute('href');assert.ok(href.includes(id));const report=await page.context().request.get(new URL(href,base).href);assert.equal(report.status(),200);return href;};
 await createSuite('Workbench both '+suffix);
 await page.getByRole('button',{name:'New test case',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Visible body');await page.getByRole('button',{name:'Create case',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const both=await launch('Run both');assert.equal(both.mode,'both');const bothReport=await waitReport(both.id);
 assert.match(await page.getByRole('log').innerText(),/\[playwright\]/);assert.match(await page.getByRole('log').innerText(),/\[lighthouse\]/);
 await page.reload();await page.getByText('Read-only session',{exact:true}).waitFor();await page.waitForFunction(id=>document.querySelector('[aria-label="Terminal run"]')?.value===id,both.id);await page.getByRole('log').getByText('[target]',{exact:false}).waitFor();
 // Force WS failure after restoring an in-memory operator token; read-only reload alone never opens WS.
 forceWsFailure=true;
 await page.getByRole('button',{name:'Unlock editing',exact:true}).click();await page.getByLabel('Operator token').fill(token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByText('Operator connected',{exact:true}).waitFor();
 let attemptTimer;try{await Promise.race([attempted,new Promise((_,reject)=>{attemptTimer=setTimeout(()=>reject(new Error('No WebSocket attempt after unlock')),10000)})]);}finally{clearTimeout(attemptTimer)}
 assert.ok(wsAttempts>0);
 // Wait for run/docs final state so persisted output cannot change during comparison.
 await page.waitForFunction(async id=>{const r=await fetch('/api/runs/'+id).then(r=>r.json());return !['queued','running'].includes(r.status)&&r.docsStatus!=='building'},both.id,{timeout:240000});
 const replay=await page.context().request.get(base+'/api/runs/'+both.id+'/logs?after=0');assert.equal(replay.status(),200);
 const expected=(await replay.json()).logs.sort((a,b)=>a.seq-b.seq).slice(-3000).map(l=>l.text);assert.ok(expected.length);
 await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('[role=log] pre')].map(el=>el.textContent))===JSON.stringify(expected),expected,{timeout:30000});
 assert.deepEqual(await page.getByRole('log').locator('pre').allTextContents(),expected);
 await createSuite('Workbench Lighthouse only '+suffix);
 await page.getByRole('button',{name:'Lighthouse',exact:true}).click();
 const lh=await launch('Run Lighthouse');assert.equal(lh.mode,'lh');const lhReport=await waitReport(lh.id);assert.match(await page.getByRole('log').innerText(),/\[lighthouse\]/);
 const cases=await page.context().request.get(base+'/api/suites/'+lh.suiteId+'/cases');assert.deepEqual(await cases.json(),[]);
 await page.getByRole('button',{name:'Reports',exact:true}).click();assert.ok(await page.getByRole('log').isVisible());assert.ok(await page.getByRole('link',{name:'Open report',exact:true}).count()>=2);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 await page.reload();await page.getByText('Read-only session',{exact:true}).waitFor();
 const logoutResponse=page.waitForResponse(r=>r.url().endsWith('/api/session')&&r.request().method()==='DELETE');
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();assert.ok((await logoutResponse).ok());
 await page.getByText('Not connected',{exact:true}).waitFor();
 assert.equal((await page.context().request.get(base+'/api/suites')).status(),401);
 console.log(JSON.stringify({both:{id:both.id,report:bothReport},lighthouseOnly:{id:lh.id,report:lhReport},checks:['UI launch both','UI Lighthouse without cases','visible logs and report','session reload','WS unavailable polling replay','mobile width','no browser errors']},null,2));
} finally {await browser.close();}
