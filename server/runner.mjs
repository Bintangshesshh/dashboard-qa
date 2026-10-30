import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile, appendFile, readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { target } from './validation.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const require = createRequire(join(root,'package.json'));

export async function filesBelow(dir,base=dir) {
  const files=[];
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])) {
    const path=join(dir,entry.name);
    if(entry.isSymbolicLink()) continue;
    if(entry.isDirectory()) files.push(...await filesBelow(path,base));
    else if(entry.isFile()) files.push(relative(base,path).replaceAll('\\','/'));
  }
  return files;
}
export async function checkTarget(url,origins) {
  let current=target(url,origins);
  for(let i=0;i<6;i++) {
    const response=await fetch(current,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(response.status>=300&&response.status<400&&response.headers.get('location')) { current=target(new URL(response.headers.get('location'),current).href,origins); continue; }
    return current;
  }
  throw new Error('Too many target redirects');
}
export class Runner extends EventEmitter {
  constructor(store,{runsDir=resolve(root,'.runs'),origins=[],timeout=300000,docs=true}={}) {
    super(); Object.assign(this,{store,runsDir,origins,timeout,docs}); this.active=null;
  }
  directory(id) { return join(this.runsDir,id); }
  start(run,cases) {
    if(this.active) throw Object.assign(new Error('Another run is active'),{status:409});
    const state={run,cases,seq:0,chain:Promise.resolve(),child:null,cancelled:false}; this.active=state;
    state.done=this.execute(state).finally(()=>{this.active=null;});
    return state.done;
  }
  async log(state,stream,text) {
    const entry={seq:++state.seq,stream,text:String(text),at:new Date().toISOString()};
    state.chain=state.chain.then(async()=>{await this.store.log(state.run.id,entry); await appendFile(join(this.directory(state.run.id),'logs.txt'),entry.text); this.emit('log',{type:'log',runId:state.run.id,...entry});});
    return state.chain;
  }
  async status(state,patch) {
    Object.assign(state.run,patch); await this.store.put('runs',state.run);
    await writeFile(join(this.directory(state.run.id),'run.json'),JSON.stringify(state.run,null,2));
    this.emit('status',{type:'status',run:state.run});
  }
  kill(child) {
    if(!child?.pid) return;
    if(process.platform==='win32') { const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}); killer.on('error',()=>child.kill()); }
    else { try { process.kill(-child.pid,'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  }
  async cancel(id) {
    const state=this.active;
    if(!state||state.run.id!==id) return false;
    state.cancelled=true; this.kill(state.child); await this.status(state,{status:'cancelling'}); return true;
  }
  command(state,args,env={}) {
    return new Promise((resolvePromise,reject)=>{
      if(state.cancelled) return reject(new Error('Run cancelled'));
      const child=spawn(process.execPath,args,{cwd:this.directory(state.run.id),shell:false,detached:process.platform!=='win32',windowsHide:!state.run.headed,env:{...process.env,DATABASE_URL:'',...env}});
      state.child=child;
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;this.kill(child);},this.timeout);
      child.stdout.on('data',data=>this.log(state,'stdout',data.toString()).catch(()=>this.kill(child)));
      child.stderr.on('data',data=>this.log(state,'stderr',data.toString()).catch(()=>this.kill(child)));
      child.on('error',err=>{clearTimeout(timer);reject(err);});
      child.on('close',code=>{clearTimeout(timer);state.child=null; if(timedOut) reject(new Error('Execution timed out')); else resolvePromise(code??1);});
    });
  }
  async execute(state) {
    const {run,cases}=state,dir=this.directory(run.id),artifacts=join(dir,'artifacts');
    try {
      await mkdir(artifacts,{recursive:true}); await writeFile(join(dir,'logs.txt'),'');
      await this.status(state,{status:'running',startedAt:new Date().toISOString()});
      await this.log(state,'system','Trusted account execution. Submitted code has host privileges; target allowlist is not a code sandbox.\n');
      await this.log(state,'system','[target] Checking '+run.targetUrl+'\n');
      await checkTarget(run.targetUrl,this.origins);
      let exitCode=0;
      if(run.mode==='pw'||run.mode==='both') {
        await this.log(state,'system','[playwright] Starting '+cases.length+' case(s), '+(run.headed?'headed':'headless')+'\n');
        const specDir=join(dir,'specs'); await mkdir(specDir,{recursive:true});
        const playwright=require.resolve('@playwright/test');
        const fixture=`const {test:base,expect}=require(${JSON.stringify(playwright)});
const origins=${JSON.stringify(this.origins)};
exports.test=base.extend({context:async({context},use)=>{await context.route('**/*',route=>{const url=new URL(route.request().url());return ['data:','blob:','about:'].includes(url.protocol)||origins.includes(url.origin)?route.continue():route.abort('blockedbyclient');});await use(context);}});
exports.expect=expect;`;
        await writeFile(join(specDir,'fixture.cjs'),fixture);
        for(const test of cases) await writeFile(join(specDir,test.id+'.spec.ts'),test.code.replace(/(['"])@playwright\/test\1/g,"'./fixture.cjs'"));
        const config={testDir:specDir,timeout:30000,workers:1,retries:0,use:{baseURL:run.targetUrl,headless:!run.headed,trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure',serviceWorkers:'block'},outputDir:join(artifacts,'playwright'),reporter:[['list'],['json',{outputFile:join(artifacts,'playwright.json')}],['html',{outputFolder:join(artifacts,'playwright-report'),open:'never'}],[join(root,'scripts/pw-reporter.mjs'),{outputFile:join(artifacts,'pw','langkah.json')}]]};
        await writeFile(join(dir,'playwright.config.mjs'),'export default '+JSON.stringify(config));
        exitCode=await this.command(state,[require.resolve('@playwright/test/cli'),'test','--config',join(dir,'playwright.config.mjs')],{QA_TARGET_URL:run.targetUrl});
      }
      if(!state.cancelled&&(run.mode==='lh'||run.mode==='both')) {
        await this.log(state,'system','[lighthouse] Starting Chromium audit. Native LHCI output follows.\n');
        const config={ci:{collect:{url:[run.targetUrl],numberOfRuns:1,settings:{chromeFlags:run.headed?'--disable-dev-shm-usage':'--headless --disable-dev-shm-usage'}},upload:{target:'filesystem',outputDir:join(artifacts,'lighthouse')}}};
        await writeFile(join(dir,'lighthouserc.json'),JSON.stringify(config));
        const cli=require.resolve('@lhci/cli/src/cli.js');
        const code=await this.command(state,[cli,'autorun','--config='+join(dir,'lighthouserc.json')],{CHROME_PATH:process.env.CHROME_PATH||require('playwright').chromium.executablePath()}); exitCode=exitCode||code;
      }
      await state.chain;
      await this.status(state,{status:state.cancelled?'cancelled':exitCode===0?'passed':'failed',docsStatus:this.docs&&!state.cancelled?'building':'skipped',exitCode,finishedAt:new Date().toISOString()});
    } catch(error) {
      await state.chain.catch(()=>{});
      await this.status(state,{status:state.cancelled?'cancelled':'failed',docsStatus:this.docs&&!state.cancelled?'building':'skipped',error:error.message,exitCode:1,finishedAt:new Date().toISOString()}).catch(err=>console.error('Run persistence failed',err));
    }
    try {
      const artifactFiles=await filesBelow(artifacts);
      const report=await readFile(join(artifacts,'playwright.json'),'utf8').then(JSON.parse).catch(()=>null);
      const stats=report?.stats;
      const summary=stats?{passed:stats.expected??0,failed:stats.unexpected??0,skipped:stats.skipped??0,total:(stats.expected??0)+(stats.unexpected??0)+(stats.skipped??0)+(stats.flaky??0),durationMs:stats.duration??0}:null;
      let lighthouseScores=null;
      for(const file of artifactFiles.filter(name=>name.startsWith('lighthouse/')&&name.endsWith('.json'))) {
        const data=await readFile(join(artifacts,file),'utf8').then(JSON.parse).catch(()=>null);
        if(data?.categories){lighthouseScores=Object.fromEntries(Object.entries(data.categories).map(([name,category])=>[name,category.score]));break;}
      }
      await this.status(state,{artifacts:artifactFiles,summary,lighthouseScores});
      if(this.docs&&!state.cancelled) {
        await this.log(state,'system','[docs] Building Docusaurus report; test outcome already recorded.\n');
        const code=await this.command(state,[join(root,'scripts/build-run-docs.mjs'),dir],{REPORT_BASE_URL:'/reports/'+run.id+'/docs/'});
        await state.chain;
        await this.status(state,{docsStatus:code===0?'ready':'failed',docsUrl:code===0?'/reports/'+run.id+'/docs/':null,reportUrl:code===0?'/reports/'+run.id+'/docs/':null});
      }
    } catch(error) { await this.status(state,{docsStatus:'failed',docsError:error.message}).catch(console.error); }
    if(state.cancelled)await this.status(state,{status:'cancelled',docsStatus:'cancelled',finishedAt:new Date().toISOString(),reportUrl:null,docsUrl:null});
  }
}
