import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const root=process.cwd(), outputRoot=process.env.PI_WEB_ACCEPTANCE_OUTPUT;
assert.ok(outputRoot, 'Set PI_WEB_ACCEPTANCE_OUTPUT to an evidence root');
mkdirSync(outputRoot,{recursive:true});
const out=mkdtempSync(join(outputRoot,'run-'));
console.log('Evidence directory: '+out);
const logPath=join(out,'managed-browser-server.log');
writeFileSync(logPath,'',{flag:'wx'});
const mode=process.argv[2] ?? 'stop';
assert.ok(['stop','failure','interaction','success','t44','restart','restart-cleanup','agent-disabled','resume-cleanup'].includes(mode), 'Unsupported acceptance mode');
const tmp=mkdtempSync(join(out,'managed-')), agent=join(tmp,'agent'), cwd=join(tmp,'project'), marker=join(cwd,'pid.txt');
mkdirSync(join(agent,'agents'),{recursive:true}); mkdirSync(cwd);
writeFileSync(join(cwd,'nested-process.cjs'), "require('node:fs').writeFileSync('nested.pid',String(process.pid));setInterval(()=>console.log('managed fixture still running'),350).unref();setTimeout(()=>{},65000);");
const json=(file,data)=>writeFileSync(join(agent,file),JSON.stringify(data));
json('agents/settings.json',{builtInEnabled:mode!=='agent-disabled'});
json('settings.json',{defaultProvider:'acceptance',defaultModel:'fixture',defaultTools:['read','powershell','edit','write']});
writeFileSync(join(agent,'agents','pid-check.md'),'---\nname: pid-check\ndescription: Loopback PID fixture\ntools: powershell\nload_extensions: false\nload_skills: false\n---\nRun the supplied local fixture.\n');
const task='Managed PID acceptance child', reply='Parent finished before child command';
let release; const gate=new Promise(r=>release=r);
let delegated=false, childRequest=false, server, browser, sentinel, authServer;
let interactionCommand, authRequests=0, unauthorized=0, disabledChecked=false, parentPolicyLoaded=false;
const useT44=mode==='t44';
const t44=process.env.PI_WEB_ACCEPTANCE_T44_RUNNER?.replaceAll("'","''");
assert.ok(!useT44||t44,'Supply PI_WEB_ACCEPTANCE_T44_RUNNER for the isolated, offline T44 runner');
const appCommand=useT44 ? "& node '"+t44+"'; exit $LASTEXITCODE" : {
  stop: '& node nested-process.cjs',
  restart: '& node nested-process.cjs',
  'restart-cleanup': '& node nested-process.cjs',
  'resume-cleanup': '& node nested-process.cjs',
  failure: "Write-Output 'fixture-stdout'; [Console]::Error.WriteLine('fixture-stderr'); exit 7",
  success: "& git --version; if ($LASTEXITCODE) { exit $LASTEXITCODE }; & cmd.exe /d /c 'echo managed-cmd'; exit $LASTEXITCODE",
}[mode];
const tool=(id,name,args)=>({index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const log=createWriteStream(logPath,{flags:'a'});
const model=createServer(async(req,res)=>{
  try {
    let body=''; for await(const chunk of req) body+=chunk;
    const b=JSON.parse(body), names=b.tools?.map(t=>t.function.name)??[];
    console.log('loopback model tools:',names.join(','));
    let delta;
    if(mode==='agent-disabled'){
      const messages=JSON.stringify(b.messages);
      assert.ok(messages.includes('Pi Web managed automation policy:')&&messages.includes('no-session fallback')&&messages.includes('without a visible console'));
      assert.ok(!names.includes('Agent'),'managed Agent must actually be disabled');
      disabledChecked=true;
      delta={content:'Managed Agent is unavailable; no independent agent was started.'};
    }else if(names.includes('Agent')&&!delegated){
      assert.ok(JSON.stringify(b.messages).includes('Pi Web managed automation policy:'));
      parentPolicyLoaded=true;delegated=true;delta={tool_calls:[tool('call_managed_acceptance','Agent',{description:task,subagent_type:'pid-check',prompt:'Run the PID fixture',run_in_background:true})]};}
    else if(!names.includes('Agent')&&names.includes('powershell')&&!childRequest){childRequest=true; await gate; delta={tool_calls:[tool('call_pid_fixture','powershell',{command:'Set-Content -LiteralPath pid.txt -Value $PID; '+(interactionCommand??appCommand),...(useT44?{timeout:195}:mode==='interaction'?{timeout:12}:{})})]};}
    else delta={content:names.includes('Agent')?reply:'Fixture ended'};
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const choice of [{delta:{role:'assistant',...delta},finish_reason:null},{delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}]) res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,...choice}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch(e){console.error(e);res.writeHead(500).end();}
});
async function listen(s){s.listen(0,'127.0.0.1'); await once(s,'listening');return s.address().port;}
async function retry(name,fn,ms=18000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){last=e;} await delay(250);}throw new Error('Timeout: '+name,{cause:last});}
try {
 if(mode==='interaction'){
   authServer=createServer((_req,res)=>{authRequests++;unauthorized++;res.writeHead(401,{'www-authenticate':'Basic realm="pi-web-fixture"'}).end();});
   const authPort=await listen(authServer);
   writeFileSync(join(cwd,'git-config-empty'),'');
   interactionCommand=`$env:GIT_CONFIG_NOSYSTEM='1'; $env:GIT_CONFIG_GLOBAL=(Join-Path (Get-Location) 'git-config-empty'); & git -c credential.helper= ls-remote http://127.0.0.1:${authPort}/test.git; exit $LASTEXITCODE`;
 }
 const modelPort=await listen(model);
 json('models.json',{providers:{acceptance:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,api:'openai-completions',apiKey:'ONLY_A_LOCAL_PLACEHOLDER',models:[{id:'fixture'}]}}});
 const probe=createServer(), port=await listen(probe);await new Promise(r=>probe.close(r));
 assert.equal(process.platform,'win32');
 const startServer=()=>spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','-H','127.0.0.1','-p',String(port)],{cwd:root,windowsHide:true,env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|pathext|systemroot|windir|comspec|programfiles.*|programdata|localappdata|appdata|userprofile|home|temp|tmp|os|systemdrive|playwright_browsers_path)$/i.test(k))),PI_CODING_AGENT_DIR:agent,PI_WEB_PASSWORD:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const connectLogs=()=>{server.stdout.pipe(log,{end:false});server.stderr.pipe(log,{end:false});};
 server=startServer(); connectLogs();
 const base=`http://127.0.0.1:${port}`;
 const api=async(path,body)=>{const res=await fetch(base+path,{signal:AbortSignal.timeout(8000),...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const text=await res.text();assert.ok(res.ok,`${path}: ${res.status} ${text.slice(0,500)}`);return JSON.parse(text);};
 await retry('isolated server ready',async()=>{if(server&&server.exitCode!==null) throw Error('Next exited '+server.exitCode);assert.deepEqual((await api('/api/sessions')).sessions,[]);return true;},40000);
 const parent=(await api('/api/agent/new',{cwd,type:'prompt',message:'Delegate the local PID fixture in background',provider:'acceptance',modelId:'fixture',thinkingLevel:'off'})).sessionId;
 assert.ok(parent);console.log('parent',parent);
 if(mode==='agent-disabled'){
   await retry('disabled Agent replied without a child',async()=>{
     const rows=(await api('/api/sessions')).sessions;
     const detail=await api(`/api/sessions/${parent}`);
     const running=await api('/api/agent/running');
     return disabledChecked&&rows.length===1&&rows[0].id===parent&&!running.runningSessionIds.includes(parent)
       &&JSON.stringify(detail.context).includes('no independent agent was started');
   });
   console.log('PASS loaded managed policy with Agent disabled; one parent and no child');
 }else{
 const child=await retry('parent idle, linked child running',async()=>{
   const row=(await api('/api/sessions')).sessions.find(v=>v.relation?.kind==='subagent'&&v.relation.parentSessionId===parent);
   if(!row)return;
   const snap=await api('/api/agent/running'), detail=await api(`/api/sessions/${parent}`);
   if(childRequest&&JSON.stringify(detail.context).includes(reply)&&!snap.runningSessionIds.includes(parent)&&snap.runningSessionIds.includes(row.id)&&snap.subagentsActiveSessionIds.includes(parent))return row.id;
 });
 const sessionPath=join(agent,'sessions',readdirSync(join(agent,'sessions'),{recursive:true}).find(x=>x.endsWith(child+'.jsonl')));
 const readEntries=()=>readFileSync(sessionPath,'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(readEntries().some(e=>e.customType==='pi-web:subagent'&&e.data.parentSessionId===parent&&e.data.parentToolCallId==='call_managed_acceptance'));
 assert.ok(parentPolicyLoaded);
 console.log('PASS parent settled while child active and gated; persisted linked JSONL',child);
 release();
 const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
 if(mode==='stop'||mode==='restart'||mode==='restart-cleanup'||mode==='resume-cleanup'){
   const pid=await retry('live shell PID',()=>{const id=Number(readFileSync(marker,'utf8'));return id>0&&alive(id)&&id;});
   const nested=await retry('live nested PID',()=>{const id=Number(readFileSync(join(cwd,'nested.pid'),'utf8'));return id>0&&alive(id)&&id;});
   if(mode==='restart'||mode==='restart-cleanup'||mode==='resume-cleanup'){
     if(mode==='restart-cleanup'||mode==='resume-cleanup'){
       // Freeze the crash image at the real, already-written warning, before any result entry.
       await api(`/api/agent/${child}`,{type:'abort'});
       const prefix=await retry('durable cleanup warning',()=>{
         const boundary=readEntries();
         const index=boundary.findIndex(e=>e.customType==='pi-web:project-command-cleanup-unconfirmed');
         return index>0&&boundary.slice(0,index+1);
       });
       assert.ok(!prefix.some(e=>e.customType==='pi-web:subagent-result'));
       const childStopped=()=>!alive(pid)&&!alive(nested);
       await retry('own shell and nested process exit',childStopped);
       const exited=once(server,'exit');
       const killed=spawnSync('taskkill.exe',['/pid',String(server.pid),'/t','/f'],{windowsHide:true,encoding:'utf8',timeout:5000});
       assert.equal(killed.status,0,killed.stderr); await exited;
       if(mode==='resume-cleanup'){
         // Recreate the durable snapshot: only the previous result carries the warning.
         const markerEntry=prefix.pop();
         prefix.push({ ...markerEntry, customType:'pi-web:subagent-result',data:{version:1,status:'aborted',completedAt:markerEntry.timestamp,processCleanupUnconfirmed:true} });
         prefix.push({ ...markerEntry,id:'29faee17',parentId:markerEntry.id,customType:'pi-web:subagent-status',data:{version:1,status:'running'} });
       }
       writeFileSync(sessionPath,prefix.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
     }else{
     const exited=once(server,'exit');
     const killed=spawnSync('taskkill.exe',['/pid',String(server.pid),'/t','/f'],{windowsHide:true,encoding:'utf8',timeout:5000});
     assert.equal(killed.status,0,killed.stderr); await exited;
     }
     server=startServer(); connectLogs();
     await retry('orphan status after isolated Next restart',async()=>{
       const row=(await api('/api/sessions')).sessions.find(x=>x.id===child);
       const snap=await api('/api/agent/running');
       return row?.relation?.status==='interrupted'&&!snap.runningSessionIds.includes(child)&&!snap.subagentsActiveSessionIds.includes(parent)&&!alive(pid)&&!alive(nested);
     },40000);
     if(mode==='restart-cleanup'||mode==='resume-cleanup'){
       const after=await api(`/api/sessions/${child}`);
       assert.equal(after.info.relation.processCleanupUnconfirmed,true);
       const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')));
       browser=await chromium.launch({headless:true,timeout:10000});
       const page=await browser.newPage({locale:'en-US'}); page.setDefaultTimeout(10000);
       await page.goto(base+'/?session='+parent,{waitUntil:'domcontentloaded',timeout:16000});
       await page.getByRole('button',{name:/^Agents/i}).first().click();
       await page.getByRole('option').filter({hasText:task}).getByText(/^(Interrupted · Process cleanup unconfirmed|已中断 · 进程清理未确认|已中斷 · 程序清理未確認)$/i).waitFor();
       console.log('PASS Agents reads interrupted and cleanup unconfirmed after isolated Next restart:',mode);
     }
     console.log('PASS interrupted after actual isolated Next restart; shell and nested PIDs gone:',pid,nested);
   }else{
   const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')));
   browser=await chromium.launch({headless:true,timeout:10000});
   const page=await browser.newPage({locale:'en-US'});page.setDefaultTimeout(10000);
   await page.goto(base+'/?session='+parent,{waitUntil:'domcontentloaded',timeout:16000});
   for(let i=0;i<2;i++){
     if(i)await page.reload({waitUntil:'domcontentloaded',timeout:15000});
     await page.getByRole('button',{name:/^Agents/i}).first().click();
     await page.getByText(task,{exact:true}).last().waitFor();
   }
   await page.getByText(task,{exact:true}).last().click();
   await page.waitForURL(url=>url.searchParams.get('session')===child);
   await page.getByText(/managed fixture still running/).first().waitFor();
   sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,windowsHide:true,stdio:'ignore'});
   await once(sentinel,'spawn');
   assert.ok(alive(sentinel.pid),'independent sentinel must be alive before Stop');
   await page.getByTitle(/^(Stop agent|停止 Agent)$/i).click();
   await retry('cancelled child and both owned processes gone',async()=>{
     const row=(await api('/api/sessions')).sessions.find(x=>x.id===child), snap=await api('/api/agent/running');
     return row?.relation?.status==='aborted'&&row.relation.processCleanupUnconfirmed===true&&!snap.runningSessionIds.includes(child)&&!snap.subagentsActiveSessionIds.includes(parent)&&!alive(pid)&&!alive(nested);
   });
   assert.ok(alive(sentinel.pid),'Stop must not kill the independent sentinel');
   const afterStop=await api(`/api/sessions/${child}`);
   assert.equal(afterStop.info?.relation?.processCleanupUnconfirmed,true);
   await page.goto(base+'/?session='+parent,{waitUntil:'domcontentloaded',timeout:16000});
   await page.getByRole('button',{name:/^Agents/i}).first().click();
   await page.getByRole('option').filter({hasText:task}).getByText(/process cleanup unconfirmed|进程清理未确认|程序清理未確認/i).waitFor();
   console.log('PASS Agents reload and browser Stop; unconfirmed cleanup displayed; shell and nested PIDs exited; unrelated process survived:',pid,nested,sentinel.pid);
   }
 }else{
   const final=await retry('managed command completed',async()=>{
     const row=(await api('/api/sessions')).sessions.find(x=>x.id===child);
     return (row?.relation?.status==='completed'||row?.relation?.status==='failed')&&row;
   },useT44?175000:20000);
   const detail=await api('/api/sessions/'+child);
   const result=detail.context?.messages?.find(message=>message.role==='toolResult'&&message.toolCallId==='call_pid_fixture');
   assert.ok(result,'command result must be persisted');
   const text=result.content.map(x=>x.text??'').join('\n');
   if(mode==='failure'){
     assert.equal(result.isError,true);
     assert.equal(final.relation.status,'failed');
     for(const token of ['fixture-stdout','fixture-stderr','Command exited with code 7'])assert.ok(text.includes(token),text);
   }else if(mode==='interaction'){
     assert.ok(authRequests>0&&unauthorized===authRequests,'the fixture must issue a real authentication challenge');
     assert.equal(final.relation.status,'failed');
     assert.equal(result.isError,true);
     assert.match(text,/terminal prompts disabled/i);
     assert.match(text,/Command exited with code \d+/);
     console.log('PASS local Git authentication challenge failed noninteractively; requests:',authRequests);
   }else{
     assert.equal(final.relation.status,'completed');
     assert.ok(!result.isError,text);
     for(const token of (useT44?['T44 selected test exit 0']:['git version','managed-cmd']))assert.ok(text.includes(token),text);
   }
   console.log('PASS persisted '+mode+' command output/result:',text);
 }
 }
}finally{
 release();await browser?.close();
 if(sentinel?.pid&&sentinel.exitCode===null&&sentinel.signalCode===null){const done=once(sentinel,'exit');sentinel.kill();await done;}
 authServer?.closeAllConnections();authServer?.close();
 if(server?.pid&&server.exitCode===null)spawnSync('taskkill.exe',['/pid',String(server.pid),'/t','/f'],{windowsHide:true,stdio:'ignore',timeout:5000});
 model.closeAllConnections();model.close();log.end();rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
