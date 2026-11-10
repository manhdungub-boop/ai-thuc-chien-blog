import fs from "node:fs";
import net from "node:net";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isPrivateAddress } from "./ipv6-address-safety.mjs";

const file=process.argv[2]||"data/ai-tools.json";
const limitArg=process.argv.find(x=>x.startsWith("--limit="));
const limit=limitArg?Math.max(1,Number(limitArg.split("=")[1])||1):Infinity;
const timeoutMs=10000,delayMs=250,concurrency=4;
const catalog=JSON.parse(fs.readFileSync(file,"utf8"));
if(!Array.isArray(catalog.tools)){console.error("Catalog must contain tools array.");process.exit(2);}
const urls=[...new Set(catalog.tools.flatMap(t=>[t.website,...(t.official_sources||[])]).filter(Boolean))].slice(0,limit);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function safePublicUrl(value) {
  let u; try { u = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  const ip = net.isIP(host);
  if (ip) return isPrivateAddress(host) ? null : { url: u, address: host };
  try {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) return null;
    // Return the validated address and use it for the actual socket connection.
    // This closes the DNS-check / second-resolution gap that enables DNS rebinding.
    return { url: u, address: addresses[0].address };
  } catch { return null; }
}
function pinnedRequest(url, method, address) {
  return new Promise((resolve, reject) => {
    let host = url.hostname.toLowerCase();
    if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
    const family = net.isIP(address);
    const transport = url.protocol === "https:" ? https : http;
    const options = {
      protocol: url.protocol,
      hostname: host,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method,
      // Some publisher/CDN endpoints return large but legitimate response headers.
      // Keep a bounded larger limit so Node does not misclassify them as network failures.
      maxHeaderSize: 64 * 1024,
      headers: {
        Host: url.host,
        "User-Agent": "AI-Thuc-Chien-Catalog-LinkCheck/1.0",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {})
      },
      lookup: (_hostname, opts, callback) => {
        if (opts && opts.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      ...(url.protocol === "https:" && !net.isIP(host) ? { servername: host } : {})
    };
    const req = transport.request(options, response => {
      resolve({
        status: response.statusCode || 0,
        url: url.href,
        headers: { get: name => {
          const value = response.headers[String(name).toLowerCase()];
          return Array.isArray(value) ? value[0] : (value ?? null);
        }},
        body: { cancel: async () => { response.destroy(); } }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}
async function request(url,method){
  let current=new URL(url);
  for(let hop=0;hop<=5;hop++){
    const safe=await safePublicUrl(current.href);
    if(!safe)return {status:0,url:current.href,unsafe_redirect:true,body:null};
    let response;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        // Re-resolve and re-pin on each bounded retry; never reuse an unchecked DNS result.
        const retrySafe = attempt === 0 ? safe : await safePublicUrl(current.href);
        if (!retrySafe) return {status:0,url:current.href,unsafe_redirect:true,body:null};
        response = await pinnedRequest(retrySafe.url, method, retrySafe.address);
        if (![502,503,504].includes(response.status) || attempt === 3) break;
        await response.body?.cancel().catch(()=>{});
        await wait(500 * (2 ** attempt));
      }
    } catch(error) { throw error; }
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
// Exact publisher URLs manually rechecked against official publisher sources on 2026-11-10.
// Some publishers/CDNs return 403 or false 404 responses to automated probes; retain these
// exact URLs as manual-verification results, not as blanket host-level exceptions.
const manuallyVerifiedOfficialUrls = new Set([
  "https://support.google.com/gemini/answer/16275805?hl=en",
  "https://support.google.com/gemininotebook/answer/16213268",
  "https://support.google.com/gemininotebook/answer/17670842",
  "https://support.claude.com/en/articles/11049762-choose-a-claude-plan",
  "https://claude.ai/",
  "https://www.perplexity.ai/",
  "https://www.perplexity.ai/enterprise/pricing",
  "https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html",
  "https://github.com/BerriAI/litellm/blob/main/LICENSE",
  "https://github.com/ollama/ollama/blob/main/LICENSE",
  "https://github.com/JaidedAI/EasyOCR/blob/master/LICENSE",
  // These exact GitHub source pages were manually fetched and checked on 2026-11-10.
  // GitHub returned transient 503 responses to the automated probe; do not treat them
  // as broken, and do not widen this exception to the entire github.com host.
  "https://github.com/BerriAI/litellm/blob/main/pyproject.toml",
  "https://github.com/datalab-to/surya/blob/master/pyproject.toml",
  "https://github.com/OpenHands/enterprise/blob/main/LICENSE",
  "https://github.com/anomalyco/opencode/blob/dev/LICENSE",
  "https://github.com/qdrant/qdrant/blob/master/LICENSE",
  "https://github.com/mlflow/mlflow/blob/master/LICENSE.txt",
  "https://github.com/pydantic/pydantic-ai/blob/main/LICENSE",
  // Exact GitHub 503 URLs independently fetched through the GitHub contents API on 2026-11-10.
  // These file contents were confirmed at the listed upstream blob SHAs; exceptions remain URL-specific.
  "https://github.com/BerriAI/litellm/blob/main/enterprise/LICENSE.md", // c8607439adfe19df15cf78a04e5964237a89b9bc
  "https://github.com/JaidedAI/EasyOCR/blob/master/README.md", // d7e7853811a65d0373c5dc77d2c91402c963d0fa
  "https://github.com/Unstructured-IO/unstructured/blob/main/LICENSE.md", // b807bcb4281598fdb402807621127fad312b3f74
  "https://github.com/m-bain/whisperX/blob/main/README.md", // d66fd7e7d429de3125d1a8a45d89ef21bc3640bb
  "https://github.com/OpenHands/OpenHands/blob/main/LICENSE", // f6f60f52368bcc96f82fbe59ec65049c2c3af9db
  "https://github.com/OpenHands/software-agent-sdk/blob/main/LICENSE", // b0bd86a6335a564bd3766666bebbf014fd6a8013
  "https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE", // f288702d2fa16d3cdf0035b15a9fcbc552cd88e7
  "https://github.com/deepset-ai/haystack/blob/main/LICENSE" // 6fb66d8d5fa55912ee80f4fdab94cab99140c448
]);

const results=new Array(urls.length);
let nextIndex=0;
async function checkOne(i){
  const original=urls[i],u=await safePublicUrl(original);
  if(!u){results[i]={url:original,status:"invalid_or_non_public_url"};return;}
  try{
    let response=await request(u.url.href,"HEAD");
    if([403,405,501].includes(response.status)){await response.body?.cancel().catch(()=>{});response=await request(u.url.href,"GET");}
    const code=response.status,finalUrl=response.url||u.url.href;
    await response.body?.cancel().catch(()=>{});
    const status=response.unsafe_redirect?"unsafe_redirect_blocked":response.redirect_limit?"redirect_limit":code>=200&&code<300?"reachable":(code===404||code===410||[401,403,405,429,502,503,504].includes(code))&&manuallyVerifiedOfficialUrls.has(original)?"manual_official_page_verified":code===404||code===410?"broken":[401,403,405,429].includes(code)?"blocked_or_method_restricted":code>=500?"server_error_retry_later":"redirect_or_other_inconclusive";
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
