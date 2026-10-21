import express from 'express';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath, lstat } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Runner } from './runner.mjs';
import { fail, id, authorized, cursor, suiteInput, caseInput, target, allowlist, categoryInput, pagination } from './validation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const route=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
export function createApp({store,runner,token,origins}) {
  const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'256kb'}));
  const cookie=req=>{try{return decodeURIComponent((req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('qa_session='))?.slice(11)??'');}catch{return '';}};
  const bearer=req=>authorized(req.headers.authorization?.replace(/^Bearer /,''),token);
  const cookieLogout=req=>{if(req.method!=='DELETE'||req.path!=='/session'||req.headers['sec-fetch-site']==='cross-site')return false;try{return !req.headers.origin||new URL(req.headers.origin).host===req.get('host');}catch{return false;}};
  const auth=(req,res,next)=>{if(bearer(req)||((req.method==='GET'||cookieLogout(req))&&authorized(cookie(req),token))) return next();res.status(401).json({error:'Operator authentication required'});};
  app.get('/api/health',route(async(req,res)=>{await store.ping();res.json({ok:true,database:'sqlite'});}));
  app.use('/api',auth);
  app.post('/api/session',(req,res)=>{res.cookie('qa_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE!==undefined?process.env.COOKIE_SECURE==='true':process.env.NODE_ENV==='production',path:'/',maxAge:28800000});res.json({ok:true});});
  app.delete('/api/session',(req,res)=>{res.clearCookie('qa_session',{path:'/'});res.json({ok:true});});
  app.get('/api/auth',(req,res)=>res.sendStatus(204));
  app.get('/api/targets',(req,res)=>res.json({targets:origins}));
  const get=async(kind,value)=>{const result=await store.get(kind,id(value));if(!result)fail('Not found',404);return result;};

  // ─── Categories ──────────────────────────────────────────────────────────
  app.get('/api/categories',route(async(req,res)=>res.json(await store.list('categories'))));
  app.post('/api/categories',route(async(req,res)=>{
    const now=new Date().toISOString();
    res.status(201).json(await store.put('categories',{id:randomUUID(),...categoryInput(req.body),createdAt:now,updatedAt:now}));
  }));
  app.get('/api/categories/:id',route(async(req,res)=>res.json(await get('categories',req.params.id))));
  app.patch('/api/categories/:id',route(async(req,res)=>{
    const updated=await store.patch('categories',id(req.params.id),old=>({...old,...categoryInput({...old,...req.body}),updatedAt:new Date().toISOString()}));
    if(!updated)fail('Not found',404);res.json(updated);
  }));
  app.delete('/api/categories/:id',route(async(req,res)=>{
    await get('categories',req.params.id);
    await store.deleteCategory(req.params.id);
    res.sendStatus(204);
  }));

  // ─── Suites ──────────────────────────────────────────────────────────────
  app.get('/api/suites',route(async(req,res)=>res.json(await store.list('suites'))));
  app.post('/api/suites',route(async(req,res)=>{
    const now=new Date().toISOString();
    const input=suiteInput(req.body,origins);
    // Validate categoryId if provided
    if(req.body.categoryId){
      const cat=await store.get('categories',id(req.body.categoryId));
      if(!cat)fail('Category not found',400);
      input.categoryId=req.body.categoryId;
    }
    res.status(201).json(await store.put('suites',{id:randomUUID(),...input,createdAt:now,updatedAt:now}));
  }));
  app.get('/api/suites/:id',route(async(req,res)=>res.json(await get('suites',req.params.id))));
  app.patch('/api/suites/:id',route(async(req,res)=>{
    const updated=await store.patch('suites',id(req.params.id),old=>{
      const input=suiteInput({...old,...req.body},origins);
      // Handle categoryId update
      if('categoryId' in req.body){
        input.categoryId=req.body.categoryId;
      } else {
        input.categoryId=old.categoryId??null;
      }
      return {...old,...input,updatedAt:new Date().toISOString()};
    });
    if(!updated)fail('Not found',404);
    // Validate categoryId if set
    if(updated.categoryId){
      const cat=await store.get('categories',updated.categoryId);
      if(!cat){
        // Rollback: set categoryId to null
        await store.patch('suites',updated.id,old=>({...old,categoryId:null}));
        fail('Category not found',400);
      }
    }
    res.json(updated);
  }));
  app.delete('/api/suites/:id',route(async(req,res)=>{await get('suites',req.params.id);await store.delete('suites',req.params.id);res.sendStatus(204);}));
  app.get('/api/suites/:id/cases',route(async(req,res)=>{await get('suites',req.params.id);res.json(await store.list('cases',req.params.id));}));
  app.post('/api/suites/:id/cases',route(async(req,res)=>{await get('suites',req.params.id);const now=new Date().toISOString();res.status(201).json(await store.put('cases',{id:randomUUID(),suiteId:req.params.id,...caseInput(req.body),createdAt:now,updatedAt:now}));}));
  app.get('/api/cases/:id',route(async(req,res)=>res.json(await get('cases',req.params.id))));
  app.patch('/api/cases/:id',route(async(req,res)=>{const updated=await store.patch('cases',id(req.params.id),old=>({...old,...caseInput({...old,...req.body}),updatedAt:new Date().toISOString()}));if(!updated)fail('Not found',404);res.json(updated);}));
  app.delete('/api/cases/:id',route(async(req,res)=>{await get('cases',req.params.id);await store.delete('cases',req.params.id);res.sendStatus(204);}));

  // ─── Runs with pagination ────────────────────────────────────────────────
  app.get('/api/runs',route(async(req,res)=>{
    const p=pagination(req.query);
    const [rows,total]=await Promise.all([store.list('runs',undefined,p),store.count('runs')]);
    res.setHeader('X-Total-Count',String(total));
    res.json(rows);
  }));
  let starting=false;
  app.post('/api/runs',route(async(req,res)=>{
    if(starting||runner.active)fail('Another run is active',409);starting=true;
    try {
      const suite=await get('suites',req.body.suiteId),mode=req.body.mode??'pw',headed=req.body.headed??false;
      if(!['pw','lh','both'].includes(mode)||typeof headed!=='boolean')fail('Invalid mode or headed');
      target(suite.targetUrl,origins);
      if(headed&&process.platform==='linux'&&!process.env.DISPLAY)fail('Headed mode requires DISPLAY on Linux');
      let cases=(await store.list('cases',suite.id)).filter(c=>c.enabled);
      if(req.body.caseIds!==undefined){if(!Array.isArray(req.body.caseIds)||req.body.caseIds.some(value=>!cases.some(c=>c.id===value)))fail('caseIds must reference enabled suite cases');cases=cases.filter(c=>req.body.caseIds.includes(c.id));}
      if(mode!=='lh'&&!cases.length)fail('Suite needs an enabled test case');
      const run={id:randomUUID(),suiteId:suite.id,suiteName:suite.name,targetUrl:suite.targetUrl,mode,headed,cases,status:'queued',createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,exitCode:null,artifacts:[]};
      await store.put('runs',run);runner.start(run,cases).catch(console.error);res.status(202).json(run);
    } finally {starting=false;}
  }));
  app.get('/api/runs/:id',route(async(req,res)=>res.json(await get('runs',req.params.id))));

  // ─── Logs with limit and download ────────────────────────────────────────
  app.get('/api/runs/:id/logs',route(async(req,res)=>{
    await get('runs',req.params.id);
    res.json(await store.logs(req.params.id,cursor(req.query.after)));
  }));
  app.get('/api/runs/:id/logs/download',route(async(req,res)=>{
    await get('runs',req.params.id);
    const text=await store.logsText(req.params.id);
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="logs.txt"');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.send(text);
  }));

  app.post('/api/runs/:id/cancel',route(async(req,res)=>{await get('runs',req.params.id);if(!await runner.cancel(req.params.id))fail('Run is not active',409);res.json(await get('runs',req.params.id));}));
  const sendFile=folder=>route(async(req,res)=>{
    await get('runs',req.params.id);
    const base=await realpath(join(runner.directory(req.params.id),folder)).catch(()=>fail('Artifact not found',404));
    const file=await realpath(resolve(base,req.params[0]||'index.html')).catch(()=>fail('Artifact not found',404));
    if(!file.startsWith(base+sep)||!(await lstat(file)).isFile())fail('Invalid artifact path',400);
    res.setHeader('X-Content-Type-Options','nosniff');
    if(folder==='artifacts')res.setHeader('Content-Disposition','attachment');
    else res.setHeader('Content-Security-Policy',"sandbox allow-scripts allow-downloads; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    res.sendFile(file);
  });
  app.get('/api/runs/:id/artifacts/*',sendFile('artifacts'));
  app.get('/reports/:id/docs',auth,(req,res,next)=>req.path.endsWith('/')?next():res.redirect(308,'/reports/'+id(req.params.id)+'/docs/'));
  app.get('/reports/:id/docs/*',auth,sendFile('docs'));
  app.use((err,req,res,next)=>{console.error(err);res.status(err.status??500).json({error:err.status?err.message:'Internal server error'});});
  return app;
}
export function attachWebSocket(server,{store,runner,token}) {
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:4096});
  wss.on('connection',ws=>{
    let subscribed=false,runId,ready=false,pending=[],last=0;
    const send=event=>{if(ws.readyState===1){if(ws.bufferedAmount>4*1024*1024)return ws.close(1013,'Consumer too slow');ws.send(JSON.stringify(event));}};
    const log=event=>{if(event.runId!==runId)return;if(!ready)pending.push(event);else if(event.seq>last){last=event.seq;send(event);}};
    const status=event=>{if(event.run.id===runId&&ready)send(event);};
    const timer=setTimeout(()=>ws.close(1008,'Authenticate first'),5000);
    ws.on('message',async data=>{
      if(subscribed)return ws.close(1008,'Already subscribed');subscribed=true;
      try {
        const input=JSON.parse(data.toString());if(input.type!=='subscribe'||!authorized(input.token,token))return ws.close(1008,'Unauthorized');
        runId=id(input.runId);last=cursor(input.after);const run=await store.get('runs',runId);if(!run)return ws.close(1008,'Unknown run');
        if(ws.readyState!==1)return;
        clearTimeout(timer);runner.on('log',log);runner.on('status',status);
        // Replay with limit; if truncated, send replay-truncated event
        const replay=await store.logs(runId,last,5000);
        const truncated=replay.hasMore;
        for(const entry of replay.logs){if(entry.seq>last){last=entry.seq;send({type:'log',runId,...entry});}}
        if(truncated)send({type:'replay-truncated',runId,fromSeq:replay.nextAfter});
        ready=true;for(const entry of pending)log(entry);pending=[];
        send({type:'status',run:await store.get('runs',runId)});send({type:'replay-complete',runId});
      }catch{ws.close(1008,'Invalid subscription');}
    });
    ws.on('close',()=>{clearTimeout(timer);runner.off('log',log);runner.off('status',status);});
    ws.on('error',()=>ws.close());
  });return wss;
}
export async function main() {
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required; SQLite persistence cannot be disabled');
  const token=process.env.OPERATOR_TOKEN;if(!token||token.length<24)throw new Error('OPERATOR_TOKEN must contain at least 24 characters');
  const origins=allowlist(process.env.TARGET_ALLOWLIST);if(!origins.length)throw new Error('TARGET_ALLOWLIST must contain at least one exact origin');
  const store=new Store(process.env.DATABASE_URL);await store.init();
  const runner=new Runner(store,{origins,runsDir:resolve(process.env.RUNS_DIR??join(root,'.runs')),timeout:Number(process.env.RUN_TIMEOUT_MS??300000)});
  const server=createServer(createApp({store,runner,token,origins}));const wss=attachWebSocket(server,{store,runner,token});
  server.listen(Number(process.env.PORT??3001),process.env.HOST??'127.0.0.1',()=>console.log('QA backend listening',server.address()));
  const close=async()=>{if(runner.active){await runner.cancel(runner.active.run.id);await runner.active?.done;}for(const client of wss.clients)client.close();wss.close();server.close();await store.close();};
  process.once('SIGTERM',close);process.once('SIGINT',close);
  return {server,store,runner,wss};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
