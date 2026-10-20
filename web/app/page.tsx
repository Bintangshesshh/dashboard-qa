"use client";
import {useCallback,useEffect,useRef,useState} from "react";
const API=process.env.NEXT_PUBLIC_API||"";
type Case={id:string;name:string;code:string;enabled:boolean};
type Suite={id:string;name:string;description:string;targetUrl:string;cases:Case[]};
type Run={id:string;suiteId:string;suiteName:string;targetUrl:string;mode:string;headed:boolean;status:string;startedAt:string;finishedAt?:string;exitCode?:number;error?:string;artifacts?:string[];reportUrl?:string;docsStatus?:string;summary?:{passed:number;failed:number;skipped:number;total:number;durationMs:number}};
type Log={seq:number;text:string;stream:string};
const stamp=(s?:string)=>s?new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const duration=(r:Run)=>r.finishedAt?Math.max(0,Date.parse(r.finishedAt)-Date.parse(r.startedAt)):null;
const secs=(n:number|null)=>n===null?'—':(n/1000).toFixed(1)+'s';
const starter=`import { test, expect } from '@playwright/test';

test('Page is available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
`;
export default function Page(){
 const [token,setToken]=useState(''),[authenticated,setAuthenticated]=useState(false),[input,setInput]=useState(''),[suites,setSuites]=useState<Suite[]>([]),[runs,setRuns]=useState<Run[]>([]);
 const [sid,setSid]=useState(''),[cid,setCid]=useState(''),[code,setCode]=useState(''),[view,setView]=useState('workspace');
 const [collapsed,setCollapsed]=useState(true),[open,setOpen]=useState<Record<string,boolean>>({}),[query,setQuery]=useState('');
 const [mode,setMode]=useState('pw'),[headed,setHeaded]=useState(false),[scope,setScope]=useState('suite');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[menu,setMenu]=useState(false);
 const [modal,setModal]=useState(''),[editing,setEditing]=useState(false),[name,setName]=useState(''),[target,setTarget]=useState(''),[description,setDescription]=useState('');
 const [detail,setDetail]=useState<Run|null>(null),[stream,setStream]=useState(''),[logs,setLogs]=useState<Log[]>([]),[connection,setConnection]=useState('standby'),[retry,setRetry]=useState(0);
 const followLogs=useRef(true),terminal=useRef<HTMLDivElement>(null),socket=useRef<WebSocket|null>(null),seq=useRef(0);
 const suite=suites.find(s=>s.id===sid),selected=suite?.cases.find(c=>c.id===cid),dirty=!!selected&&selected.code!==code;
 const request=useCallback(async(path:string,init:RequestInit={},auth=token)=>{
  if(init.method&&init.method!=='GET'&&!(path==='/api/session'&&init.method==='DELETE')&&!auth){setModal('auth');throw new Error('Reconnect with operator token to run tests or edit. Saved session can read reports and logs.')}
  const response=await fetch(API+path,{...init,credentials:'include',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...init.headers}});
  if(!response.ok){let text=await response.text();try{text=JSON.parse(text).error||text}catch{}throw new Error(text||'Request failed: '+response.status)}
  return response.status===204?null:response.json();
 },[token]);
 const refresh=useCallback(async()=>{
  const [rows,history]=await Promise.all([request('/api/suites'),request('/api/runs')]);
  const all=await Promise.all((rows as Suite[]).map(async s=>({...s,cases:await request('/api/suites/'+s.id+'/cases')})));
  setSuites(all);setRuns(history);setSid(id=>all.some(s=>s.id===id)?id:all[0]?.id||'');setOpen(o=>Object.keys(o).length?o:Object.fromEntries(all.map(s=>[s.id,true])));
 },[request]);
 useEffect(()=>{setCollapsed(window.innerWidth<1000)},[]);
 useEffect(()=>{if(!authenticated)return;refresh().catch(e=>setError(e.message));const id=setInterval(()=>request('/api/runs').then(setRuns).catch(e=>setError(e.message)),4000);return()=>clearInterval(id)},[authenticated,refresh,request]);
 useEffect(()=>{setCid(id=>suite?.cases.some(c=>c.id===id)?id:suite?.cases[0]?.id||'')},[suite]);
 useEffect(()=>{setCode(selected?.code||'');setMenu(false)},[selected?.id,selected?.code]);
 useEffect(()=>{setStream(id=>id||runs[0]?.id||'')},[runs]);
 useEffect(()=>{request('/api/suites').then(()=>setAuthenticated(true)).catch(()=>{})},[request]);
 const active=runs.find(r=>r.id===stream);
 useEffect(()=>{
  if(!stream||!authenticated)return;
  let disposed=false,ws:WebSocket|undefined,reconnect:ReturnType<typeof setTimeout>,pollTimer:ReturnType<typeof setTimeout>,cursor=0,attempt=0;
  seq.current=0;followLogs.current=true;setLogs([]);
  const merge=(entries:Log[])=>{if(disposed)return;setLogs(previous=>{if(!entries.length)return previous;const all=new Map(previous.map(l=>[l.seq,l]));for(const l of entries)all.set(l.seq,l);return [...all.values()].sort((a,b)=>a.seq-b.seq).slice(-3000)});};
  // HTTP cursor advances only from HTTP responses: WS delivery cannot skip persisted replay.
  const poll=async()=>{try{const result=await request('/api/runs/'+stream+'/logs?after='+cursor);if(disposed)return;merge(result.logs);for(const l of result.logs)cursor=Math.max(cursor,l.seq);setPollError('');}catch(e){if(!disposed)setPollError(e instanceof Error?e.message:String(e));}finally{if(!disposed)pollTimer=setTimeout(poll,2000)}};
  const connect=()=>{if(disposed)return;setConnection('connecting');const url=process.env.NEXT_PUBLIC_WS_URL||(API?API.replace(/^http/,'ws')+'/ws':location.protocol.replace('http','ws')+'//'+location.host+'/ws');
   try{ws=new WebSocket(url)}catch{setConnection('polling');return}
   ws.onopen=()=>{if(disposed)return;attempt=0;setConnection('connected');ws?.send(JSON.stringify({type:'subscribe',token,runId:stream,after:seq.current}))};
   ws.onmessage=e=>{if(disposed)return;try{const m=JSON.parse(e.data);if(m.type==='log'&&m.runId===stream){seq.current=Math.max(seq.current,m.seq);merge([m]);}}catch{setConnection('polling')}};
   ws.onerror=()=>{if(!disposed)setConnection('polling')};ws.onclose=()=>{if(disposed)return;setConnection('polling');reconnect=setTimeout(connect,Math.min(1000*2**attempt++,15000))};
  };poll();if(token)connect();else setConnection('polling');return()=>{disposed=true;clearTimeout(reconnect);clearTimeout(pollTimer);ws?.close()};
 },[stream,authenticated,token,request,retry]);
 const [pollError,setPollError]=useState('');
 useEffect(()=>{if(followLogs.current)terminal.current?.scrollTo({top:terminal.current.scrollHeight})},[logs]);
 async function task(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 function protectDirty(){return !dirty||confirm('Discard unsaved code changes?')}
 function choose(s:Suite,c?:Case){if(!protectDirty())return;setSid(s.id);setCid(c?.id||s.cases[0]?.id||'');setView('workspace');if(innerWidth<760)setCollapsed(true)}
 function form(kind:string,edit=false){if(!edit&&!protectDirty())return;setEditing(edit);setName(edit?(kind==='suite'?suite?.name:selected?.name)||'':'');setTarget(edit?suite?.targetUrl||'':'');setDescription(edit?suite?.description||'':'');setModal(kind);setMenu(false)}
 useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave)},[dirty]);
 async function connect(){await task(async()=>{await request('/api/session',{method:'POST'},input.trim());setToken(input.trim());setAuthenticated(true);setInput('');setModal('');setView('workspace')})}
 async function saveForm(){await task(async()=>{
  if(!name.trim())throw new Error('Name is required.');
  if(modal==='suite'){const u=new URL(target);if(!['http:','https:'].includes(u.protocol))throw new Error('Use an HTTP or HTTPS target URL.');
   const s=await request('/api/suites'+(editing?'/'+sid:''),{method:editing?'PATCH':'POST',body:JSON.stringify({name:name.trim(),targetUrl:target,description})});setSid(s.id);setOpen(o=>({...o,[s.id]:true}));
  }else{const c=await request(editing?'/api/cases/'+cid:'/api/suites/'+sid+'/cases',{method:editing?'PATCH':'POST',body:JSON.stringify({name:name.trim(),...(editing?{}:{code:starter,enabled:true})})});setCid(c.id)}
  await refresh();setModal('');setNotice('Changes saved.');
 })}
 async function remove(kind:string){if(!confirm(kind==='suite'?'Delete this suite and all its cases? This cannot be undone.':'Delete this test case? This cannot be undone.'))return;await task(async()=>{await request(kind==='suite'?'/api/suites/'+sid:'/api/cases/'+cid,{method:'DELETE'});await refresh();setMenu(false)})}
 const running=runs.some(r=>['queued','running'].includes(r.status)||r.docsStatus==='building');
 async function run(runMode=mode){await task(async()=>{if(runMode!=='lh'&&dirty)throw new Error('Save code changes before running.');const r=await request('/api/runs',{method:'POST',body:JSON.stringify({suiteId:sid,mode:runMode,headed,...(runMode!=='lh'&&scope==='case'&&selected?{caseIds:[cid]}:{})})});setRuns(p=>[r,...p]);setStream(r.id);setNotice('Run queued. Live output appears below.')})}
 async function inspect(r:Run){setStream(r.id)}
 function reportLinks(r:Run){return <>{r.reportUrl?.startsWith('/reports/')?<a href={API+r.reportUrl} target="_blank" rel="noopener noreferrer">Open report</a>:<span>No report yet</span>}<span>Docs: {r.docsStatus||'pending'}</span></>}
 return <div className="app"><header><button aria-label="Toggle sidebar" aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>☰</button><strong>QA workbench</strong><nav aria-label="Main navigation">{[['workspace','Playwright'],['lighthouse','Lighthouse'],['history','Reports']].map(([id,label])=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}>{label}</button>)}</nav><span>{authenticated?(token?'Operator connected':'Read-only session'):'Not connected'}</span>{authenticated&&!token&&<button onClick={()=>setModal('auth')}>Unlock editing</button>}{authenticated?<button onClick={()=>{if(!protectDirty())return;task(async()=>{await request('/api/session',{method:'DELETE'});setToken('');setAuthenticated(false);setRuns([]);setSuites([]);setStream('');setLogs([])})}}>Disconnect</button>:<button onClick={()=>setModal('auth')}>Connect workspace</button>}</header>
 <main>{error&&<div role="alert" className="notice error">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}{notice&&<div role="status" className="notice">{notice}</div>}
 <div className={"workbench "+(collapsed?"sidebar-hidden":"")}><aside hidden={collapsed} aria-label="Suite navigation"><div className="section-title"><h2>Suites</h2><button disabled={!authenticated} onClick={()=>form('suite')}>New suite</button></div><input aria-label="Search suites" placeholder="Search suites" value={query} onChange={e=>setQuery(e.target.value)}/>{suites.filter(s=>s.name.toLowerCase().includes(query.toLowerCase())).map(s=><details key={s.id} open={open[s.id]??true} onToggle={e=>{const expanded=e.currentTarget.open;setOpen(o=>o[s.id]===expanded?o:{...o,[s.id]:expanded})}}><summary>{s.name}</summary><button className={'suite '+(sid===s.id?'selected':'')} onClick={()=>choose(s)}>{s.name}<small>{s.cases.length} cases</small></button>{s.cases.map(c=><button key={c.id} className={'tree-case '+(cid===c.id?'selected':'')} onClick={()=>choose(s,c)}>{c.name}</button>)}</details>)}{!suites.length&&<p className="muted">{authenticated?'No suites. Create a target suite to begin.':'Connect to load suites.'}</p>}</aside>
 <section className="workspace"><div className="section-title"><div><h1>{view==='lighthouse'?'Lighthouse':view==='history'?'Reports':'Playwright'}</h1><p>{suite? suite.name+' · '+suite.targetUrl:'Select or create a suite.'}</p></div>{suite&&<div className="actions"><button onClick={()=>form('suite',true)}>Edit suite</button><button onClick={()=>remove('suite')}>Delete suite</button></div>}</div>
 {view==='workspace'&&<><div className="toolbar"><label>Test selection<select aria-label="Test selection" value={scope} onChange={e=>setScope(e.target.value)}><option value="suite">All enabled cases</option><option value="case" disabled={!selected}>Selected case</option></select></label><label><input type="checkbox" checked={headed} onChange={e=>setHeaded(e.target.checked)}/> Headed browser</label><button className="primary" disabled={!authenticated||!suite||busy||running} onClick={()=>run('pw')}>Run Playwright</button><button className="primary" disabled={!authenticated||!suite||busy||running} onClick={()=>run('both')}>Run both</button></div><div className="cases"><div className="section-title"><h2>Test cases</h2><button disabled={!suite} onClick={()=>form('case')}>New test case</button></div><table><thead><tr><th>Case</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>{suite?.cases.map(c=><tr key={c.id} className={cid===c.id?'selected':''}><td><button onClick={()=>choose(suite,c)}>{c.name}</button></td><td><input aria-label={'Enable '+c.name} type="checkbox" checked={c.enabled} onChange={()=>task(async()=>{await request('/api/cases/'+c.id,{method:'PATCH',body:JSON.stringify({enabled:!c.enabled})});await refresh()})}/></td><td>{cid===c.id&&<><button onClick={()=>form('case',true)}>Rename</button><button onClick={()=>remove('case')}>Delete</button></>}</td></tr>)}</tbody></table>{!suite?.cases.length&&<p>No test cases. Add a case for Playwright, or use Lighthouse without cases.</p>}</div>{selected&&<><div className="section-title"><h2>{selected.name}</h2><button disabled={!dirty||busy} onClick={()=>task(async()=>{await request('/api/cases/'+cid,{method:'PATCH',body:JSON.stringify({code})});await refresh();setNotice('Test code saved.')})}>Save changes</button></div><textarea className="code-editor" aria-label="Test case code editor" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)}/><small>{dirty?'Unsaved changes':'Saved'}</small></>}</>}
 {view==='lighthouse'&&<section className="audit"><h2>Run Lighthouse audit</h2><p>Audit target URL for performance, accessibility, best practices and SEO. No test case required.</p><label>Target suite<select aria-label="Lighthouse target suite" value={sid} onChange={e=>{if(protectDirty())setSid(e.target.value)}}>{suites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><p><code>{suite?.targetUrl||'Create a suite with a target URL.'}</code></p><button className="primary" disabled={!authenticated||!suite||busy||running} onClick={()=>run('lh')}>Run Lighthouse</button><p className="muted">Lighthouse-only runs do not execute Playwright cases.</p></section>}
 {view==='history'&&<div className="scroll-table"><table><thead><tr><th>Started / run</th><th>Suite / mode</th><th>Status</th><th>Report</th></tr></thead><tbody>{runs.map(r=><tr key={r.id} className={stream===r.id?'selected':''}><td><button onClick={()=>inspect(r)}>{stamp(r.startedAt)}<small>{r.id.slice(0,8)}</small></button></td><td>{r.suiteName}<small>{r.mode==='lh'?'Lighthouse':r.mode==='both'?'Playwright + Lighthouse':'Playwright'}</small></td><td>{r.status}<small>{secs(duration(r))}</small></td><td className="report-links">{reportLinks(r)}</td></tr>)}</tbody></table>{!runs.length&&<p>No runs yet.</p>}</div>}
 </section></div>
 <section className="execution" aria-label="Selected run"><div className="section-title"><h2>Execution output</h2><label>Run<select aria-label="Terminal run" value={stream} onChange={e=>setStream(e.target.value)}>{!runs.length&&<option value="">No runs</option>}{runs.map(r=><option key={r.id} value={r.id}>{stamp(r.startedAt)} · {r.suiteName} · {r.mode} · {r.status}</option>)}</select></label><span>WebSocket: {connection} · HTTP fallback: {pollError?'retrying':'active'}</span><button disabled={!stream} onClick={()=>setRetry(n=>n+1)}>Reconnect</button></div>
 {active&&<div className="run-summary"><strong>Status: {active.status}</strong><span>{active.mode.toUpperCase()} · {secs(duration(active))}</span>{reportLinks(active)}{active.summary&&<span>{active.summary.passed} passed / {active.summary.failed} failed / {active.summary.skipped} skipped</span>}{active.error&&<p role="alert">{active.error}</p>}</div>}{pollError&&<p role="alert">Log polling failed: {pollError}. Retrying automatically.</p>}
 <div className="terminal" ref={terminal} onScroll={e=>{const el=e.currentTarget;followLogs.current=el.scrollHeight-el.scrollTop-el.clientHeight<40}} role="log" aria-label="Live execution terminal" aria-live="polite">{logs.length?logs.map(l=><pre key={l.seq} className={l.stream==='stderr'?'stderr':''}>{l.text}</pre>):<p>{stream?'Waiting for execution output. Persisted logs polled every 2 seconds.':'Idle. Select a run or launch Playwright / Lighthouse to see output here.'}</p>}</div>
 {!!active?.artifacts?.length&&<details><summary>Artifacts ({active.artifacts.length})</summary><ul>{active.artifacts.map(a=><li key={a}><a href={API+'/api/runs/'+encodeURIComponent(active.id)+'/artifacts/'+a.split('/').map(encodeURIComponent).join('/')} target="_blank" rel="noopener noreferrer">{a}</a></li>)}</ul></details>}</section></main>
 {modal&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={e=>{if(e.key==='Escape')setModal('')}}><h2 id="dialog-title">{modal==='auth'?'Connect workspace':(editing?'Edit ':'New ')+modal}</h2><form onSubmit={e=>{e.preventDefault();if(modal==='auth')connect();else saveForm()}}>{modal==='auth'?<label>Operator token<input autoFocus required type="password" autoComplete="off" value={input} onChange={e=>setInput(e.target.value)}/></label>:<><label>Name<input autoFocus required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label>{modal==='suite'&&<><label>Target URL<input required type="url" value={target} onChange={e=>setTarget(e.target.value)}/></label><label>Description (optional)<input maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label></>}</>}{error&&<p role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={()=>setModal('')}>Cancel</button><button className="primary" disabled={busy} type="submit">{modal==='auth'?'Connect':editing?'Save changes':'Create '+modal}</button></div></form></section></div>}
 </div>
}
