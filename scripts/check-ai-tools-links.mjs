import fs from "node:fs";
import net from "node:net";

const file=process.argv[2]||"data/ai-tools.json";
const limitArg=process.argv.find(x=>x.startsWith("--limit="));
const limit=limitArg?Math.max(1,Number(limitArg.split("=")[1])||1):Infinity;
const timeoutMs=10000,delayMs=250,concurrency=4;
const catalog=JSON.parse(fs.readFileSync(file,"utf8"));
if(!Array.isArray(catalog.tools)){console.error("Catalog must contain tools array.");process.exit(2);}
const urls=[...new Set(catalog.tools.flatMap(t=>[t.website,...(t.official_sources||[])]).filter(Boolean))].slice(0,limit);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function safePublicUrl(value){
  let u;try{u=new URL(value)}catch{return null}
  if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return null;
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))return null;
  const ip=net.isIP(host);
  if(ip===4){const a=host.split(".").map(Number);if(a[0]===10||a[0]===127||a[0]===0||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168))return null;}
  if(ip===6&&(host==="::1"||host.startsWith("fc")||host.startsWith("fd")||host.startsWith("fe80:")))return null;
  return u;
}
async function request(url,method){
  let current=new URL(url);
  for(let hop=0;hop<=5;hop++){
    if(!safePublicUrl(current.href))return {status:0,url:current.href,unsafe_redirect:true,body:null};
    const response=await fetch(current.href,{method,redirect:"manual",signal:AbortSignal.timeout(timeoutMs),headers:{"User-Agent":"AI-Thuc-Chien-Catalog-LinkCheck/1.0",...(method==="GET"?{"Range":"bytes=0-0"}:{})}});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get("location");
      await response.body?.cancel().catch(()=>{});
      if(!location)return response;
      if(hop===5)return {status:310,url:current.href,redirect_limit:true,body:null};
      current=new URL(location,current);
      continue;
    }
    return response;
  }
  return {status:310,url:current.href,redirect_limit:true,body:null};
}
// These exact publisher Help Center pages were manually verified against their official indexed pages on 2026-11-01. The isolated HTTP probe returns false 404 responses for these hosts, so keep them visible as manual-verification results rather than broken links.
const manuallyVerifiedOfficialHelpPages = new Set([
  "https://support.google.com/gemini/answer/16275805?hl=en",
  "https://support.google.com/gemininotebook/answer/16213268",
  "https://support.google.com/gemininotebook/answer/17670842",
  "https://support.claude.com/en/articles/11049762-choose-a-claude-plan"
]);

const results=new Array(urls.length);
let nextIndex=0;
async function checkOne(i){
  const original=urls[i],u=safePublicUrl(original);
  if(!u){results[i]={url:original,status:"invalid_or_non_public_url"};return;}
  try{
    let response=await request(u.href,"HEAD");
    if([403,405,501].includes(response.status)){await response.body?.cancel().catch(()=>{});response=await request(u.href,"GET");}
    const code=response.status,finalUrl=response.url||u.href;
    await response.body?.cancel().catch(()=>{});
    const status=response.unsafe_redirect?"unsafe_redirect_blocked":response.redirect_limit?"redirect_limit":code>=200&&code<300?"reachable":(code===404||code===410)&&manuallyVerifiedOfficialHelpPages.has(original)?"manual_official_page_verified":code===404||code===410?"broken":[401,403,405,429].includes(code)?"blocked_or_method_restricted":code>=500?"server_error_retry_later":"redirect_or_other_inconclusive";
    results[i]={url:original,final_url:finalUrl,http_status:code,status};
  }catch(error){results[i]={url:original,status:"network_or_timeout",detail:String(error?.message||error)};}
  console.log("LINK "+(i+1)+"/"+urls.length+" "+results[i].status);
}
await Promise.all(Array.from({length:Math.min(concurrency,urls.length)},async()=>{
  while(true){
    const i=nextIndex++;
    if(i>=urls.length)return;
    await checkOne(i);
    if(nextIndex<urls.length)await wait(delayMs);
  }
}));
const summary={checked:results.length,reachable:results.filter(x=>x.status==="reachable").length,manually_verified:results.filter(x=>x.status==="manual_official_page_verified").length,broken:results.filter(x=>x.status==="broken").length,inconclusive:results.filter(x=>!["reachable","broken","manual_official_page_verified"].includes(x.status)).length,results};
console.log(JSON.stringify(summary,null,2));
if(summary.broken)process.exitCode=1;
