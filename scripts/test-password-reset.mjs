import assert from "node:assert/strict";
import worker from "../worker.mjs";

const origin = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const seed = { id:"member-reset-test", username:"reset_tester", email:"reset-tester@example.invalid", display_name:"Reset Tester",
  password_salt:"dGVzdHNhbHQ", password_hash:"not-used", created_at:"2026-10-26T00:00:00.000Z", email_verified_at:"2026-10-26T00:01:00.000Z" };
class Statement {
  constructor(db,sql){this.db=db;this.sql=sql.replace(/\s+/g," ").trim().toLowerCase();this.args=[];}
  bind(...args){this.args=args;return this;}
  async run(){return this.db.run(this.sql,this.args);}
  async first(){return this.db.first(this.sql,this.args);}
}
class ResetD1 {
  constructor(){this.members=new Map([[seed.id,{...seed}]]);this.resetTokens=new Map();this.sessions=new Map([["session-hash",{member_id:seed.id,expires_at:"2099-01-01T00:00:00.000Z"}]]);this.rates=new Map();this.failBatchAfter=null;}
  prepare(sql){return new Statement(this,sql);}
  async batch(statements){
    const snapshot={
      members:new Map([...this.members].map(([id,value])=>[id,structuredClone(value)])),
      resetTokens:new Map([...this.resetTokens].map(([id,value])=>[id,structuredClone(value)])),
      sessions:new Map([...this.sessions].map(([id,value])=>[id,structuredClone(value)])),
    };
    try{
      const results=[];
      for(let index=0;index<statements.length;index++){
        results.push(await statements[index].run());
        if(this.failBatchAfter===index)throw new Error("Simulated D1 batch failure");
      }
      this.failBatchAfter=null;
      return results;
    }catch(error){
      this.members=snapshot.members;this.resetTokens=snapshot.resetTokens;this.sessions=snapshot.sessions;
      this.failBatchAfter=null;
      throw error;
    }
  }
  async run(sql,a){
    if(sql.startsWith("insert into community_rate_limits")){const [bucket,windowStart]=a,old=this.rates.get(bucket);this.rates.set(bucket,{window_start:windowStart,count:old&&old.window_start===windowStart?old.count+1:1});return {meta:{changes:1}};}
    if(sql.startsWith("insert into community_password_reset_tokens")){const [token_hash,member_id,created_at,expires_at]=a;this.resetTokens.set(token_hash,{token_hash,member_id,created_at,expires_at});return {meta:{changes:1}};}
    if(sql.startsWith("delete from community_password_reset_tokens where member_id = ?")){const [id,keep]=a;let n=0;for(const [h,t] of this.resetTokens)if(t.member_id===id&&h!==keep){this.resetTokens.delete(h);n++;}return {meta:{changes:n}};}
    if(sql.startsWith("delete from community_password_reset_tokens where token_hash = ? and expires_at <= ?")){const [h,cutoff]=a,t=this.resetTokens.get(h);if(t&&t.expires_at<=cutoff){this.resetTokens.delete(h);return {meta:{changes:1}};}return {meta:{changes:0}};}
    if(sql.startsWith("update community_members set password_salt = ?, password_hash = ? where id = (")){
      const [salt,hash,tokenHash,cutoff]=a,token=this.resetTokens.get(tokenHash);
      const member=token&&token.expires_at>cutoff&&this.members.get(token.member_id);
      if(!member||!member.email_verified_at)return {meta:{changes:0}};
      member.password_salt=salt;member.password_hash=hash;return {meta:{changes:1}};
    }
    if(sql.startsWith("delete from community_sessions where member_id = (")){
      const [tokenHash,cutoff,salt,hash]=a,token=this.resetTokens.get(tokenHash);
      const member=token&&token.expires_at>cutoff&&this.members.get(token.member_id);
      if(!member||member.password_salt!==salt||member.password_hash!==hash)return {meta:{changes:0}};
      let n=0;for(const [h,session] of this.sessions)if(session.member_id===member.id){this.sessions.delete(h);n++;}
      return {meta:{changes:n}};
    }
    if(sql.startsWith("delete from community_password_reset_tokens where member_id = (")) {
      const [tokenHash,cutoff,salt,hash]=a,token=this.resetTokens.get(tokenHash);
      const member=token&&token.expires_at>cutoff&&this.members.get(token.member_id);
      if(!member||member.password_salt!==salt||member.password_hash!==hash)return {meta:{changes:0}};
      let n=0;for(const [h,t] of this.resetTokens)if(t.member_id===member.id){this.resetTokens.delete(h);n++;}
      return {meta:{changes:n}};
    }
    if(sql.startsWith("delete from community_password_reset_tokens where token_hash = ? and expires_at > ? and exists")){
      const [tokenHash,cutoff,salt,hash]=a,token=this.resetTokens.get(tokenHash);
      const member=token&&token.expires_at>cutoff&&this.members.get(token.member_id);
      if(!member||member.password_salt!==salt||member.password_hash!==hash)return {meta:{changes:0}};
      this.resetTokens.delete(tokenHash);return {meta:{changes:1}};
    }
    if(sql.startsWith("delete from community_password_reset_tokens where token_hash")){const existed=this.resetTokens.delete(a[0]);return {meta:{changes:existed?1:0}};}
    if(sql.startsWith("update community_members set password_salt = ?, password_hash = ? where id = ?")){const [salt,hash,id]=a,m=this.members.get(id);if(!m)return {meta:{changes:0}};m.password_salt=salt;m.password_hash=hash;return {meta:{changes:1}};}
    if(sql.startsWith("delete from community_topic_presence where member_id = ?"))return {meta:{changes:0}};
    if(sql.startsWith("delete from community_sessions where member_id = ?")){const [id]=a;let n=0;for(const [h,session] of this.sessions)if(session.member_id===id){this.sessions.delete(h);n++;}return {meta:{changes:n}};}
    throw new Error("Unsupported mocked run SQL: "+sql);
  }
  async first(sql,a){
    if(sql.startsWith("select t.member_id from community_password_reset_tokens t join community_members m")) {
      const [tokenHash,cutoff]=a,token=this.resetTokens.get(tokenHash);
      const member=token&&token.expires_at>cutoff&&this.members.get(token.member_id);
      return member&&member.email_verified_at?{member_id:member.id}:null;
    }
    if(sql.startsWith("select count from community_rate_limits")){const r=this.rates.get(a[0]);return r?{count:r.count}:null;}
    if(sql.startsWith("select id, email, display_name, email_verified_at from community_members where email") || sql.startsWith("select id, email_verified_at from community_members where email")){const m=[...this.members.values()].find(x=>x.email===a[0]);return m?{id:m.id,email_verified_at:m.email_verified_at}:null;}
    if(sql.startsWith("delete from community_password_reset_tokens where token_hash = ? and expires_at > ? and exists")){const [h,cutoff]=a,t=this.resetTokens.get(h);if(!t||t.expires_at<=cutoff)return null;this.resetTokens.delete(h);return {member_id:t.member_id};}
    throw new Error("Unsupported mocked first SQL: "+sql);
  }
}
const db=new ResetD1();
const env={DB:db,COMMUNITY_EMAIL_RELAY_URL:"https://script.google.com/macros/s/staging-only/exec",COMMUNITY_EMAIL_RELAY_SECRET:"x".repeat(40)};
let relayMode="ok";const sent=[];
globalThis.fetch=async(_url,init)=>{const p=JSON.parse(init.body||"{}");sent.push(p);return new Response(JSON.stringify({ok:relayMode==="ok"}),{status:200,headers:{"Content-Type":"application/json"}});};
async function api(path,body,ip="203.0.113.80"){return worker.fetch(new Request(origin+path,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json","CF-Connecting-IP":ip},body:JSON.stringify(body)}),env);}
const pass=(name,ok)=>{assert.ok(ok,name);console.log("PASS "+name);};

const frontendSource = await (await import("node:fs/promises")).readFile(new URL("../script.js", import.meta.url), "utf8");
assert.match(frontendSource, /fragmentParams\.get\('reset'\)/);
const resetTokenFixture = "R".repeat(43);
const resetEmailFragment = "#cong-dong?reset=" + resetTokenFixture;
const resetFragmentQuery = resetEmailFragment.slice(resetEmailFragment.indexOf("?") + 1);
pass("frontend parser extracts the reset token from the email URL fragment", new URLSearchParams(resetFragmentQuery).get("reset") === resetTokenFixture);
const workerSource = await (await import("node:fs/promises")).readFile(new URL("../worker.mjs", import.meta.url), "utf8");
const resetRouteStart = workerSource.indexOf('if (route === "password-reset/complete"');
const resetRouteEnd = workerSource.indexOf('if (route === "login"', resetRouteStart);
const resetRouteSource = workerSource.slice(resetRouteStart, resetRouteEnd);
pass("invalid reset tokens are checked before expensive password hashing",
  resetRouteSource.indexOf("SELECT t.member_id") >= 0 &&
  resetRouteSource.indexOf("SELECT t.member_id") < resetRouteSource.indexOf("hashCommunityPassword"));
const generic=await api("/api/community/password-reset/request",{email:seed.email});const genericBody=await generic.json();
pass("request endpoint replies with generic success",generic.status===200&&genericBody.ok===true&&genericBody.message.includes("Nếu email này có tài khoản hợp lệ"));
const payload=sent.at(-1),link=new URL(payload.verifyUrl),q=link.hash.indexOf("?"),token=new URLSearchParams(link.hash.slice(q+1)).get("reset");
pass("reset email uses approved staging origin and fragment token",payload.subject==="Đặt lại mật khẩu — AI Thực Chiến"&&link.origin===origin&&link.search===""&&link.hash.startsWith("#cong-dong?reset=")&&/^[A-Za-z0-9_-]{32,80}$/.test(token));
const row=[...db.resetTokens.values()][0];
pass("token hash is stored with 30-minute expiry",db.resetTokens.size===1&&![...db.resetTokens.keys()].some(h=>payload.verifyUrl.includes(h))&&new Date(row.expires_at)-new Date(row.created_at)<=30*60*1000+1000);
const unknown=await api("/api/community/password-reset/request",{email:"unknown@example.invalid"},"203.0.113.81"),unknownBody=await unknown.json();
pass("unknown email gets same response without sending mail",unknown.status===200&&unknownBody.message===genericBody.message&&sent.length===1);
const malformed=await api("/api/community/password-reset/complete",{token:"bad",password:"StrongNewPass456"});
pass("malformed token is rejected",malformed.status===400&&db.resetTokens.size===1);
const short=await api("/api/community/password-reset/complete",{token,password:"short"});
pass("short new password is rejected",short.status===400&&db.resetTokens.size===1);
relayMode="fail";
const failed=await api("/api/community/password-reset/request",{email:seed.email},"203.0.113.82"),failedBody=await failed.json();
pass("relay failure is hidden and undelivered token is removed",failed.status===200&&failedBody.message===genericBody.message&&db.resetTokens.size===0);
relayMode="ok";
const validRequest=await api("/api/community/password-reset/request",{email:seed.email},"203.0.113.83");
const validLink=new URL(sent.at(-1).verifyUrl);
const validToken=new URLSearchParams(validLink.hash.slice(validLink.hash.indexOf("?")+1)).get("reset");
const oldSalt=db.members.get(seed.id).password_salt;
const oldPasswordHash=db.members.get(seed.id).password_hash;
const validTokenHash=[...db.resetTokens.keys()][0];
const siblingTokenHash = "sibling-reset-token-hash";
db.resetTokens.set(siblingTokenHash, { token_hash: siblingTokenHash, member_id: seed.id, created_at: new Date().toISOString(), expires_at: "2099-01-01T00:00:00.000Z" });
const sessionsBeforeReset=db.sessions.size;
db.failBatchAfter=0;
const failedBatch=await api("/api/community/password-reset/complete",{token:validToken,password:"StrongNewPass456"});
pass("failed D1 batch rolls back password, session and token changes",failedBatch.status===500&&
  db.members.get(seed.id).password_salt===oldSalt&&db.members.get(seed.id).password_hash===oldPasswordHash&&
  db.sessions.size===sessionsBeforeReset&&db.resetTokens.has(validTokenHash));
const reset=await api("/api/community/password-reset/complete",{token:validToken,password:"StrongNewPass456"}),resetBody=await reset.json();
pass("valid token updates password and consumes itself",reset.status===200&&resetBody.ok===true&&db.members.get(seed.id).password_salt!==oldSalt&&db.resetTokens.size===0);
pass("successful reset revokes sibling reset tokens", !db.resetTokens.has(siblingTokenHash) && db.resetTokens.size === 0);
pass("successful reset revokes all old sessions",db.sessions.size===0);
const replay=await api("/api/community/password-reset/complete",{token:validToken,password:"AnotherStrongPass789"});
pass("reset token cannot be replayed",replay.status===400);

// Expiration: a token beyond its 30-minute lifetime must fail and be removed.
db.rates.clear();
const expiredRequest = await api("/api/community/password-reset/request", { email: seed.email });
const expiredLink = new URL(sent.at(-1).verifyUrl);
const expiredToken = new URLSearchParams(expiredLink.hash.slice(expiredLink.hash.indexOf("?") + 1)).get("reset");
const expiredRow = [...db.resetTokens.values()].find((entry) => entry.member_id === seed.id);
assert.ok(expiredRequest.status === 200 && expiredRow && expiredToken, "expired-token fixture must be created");
expiredRow.expires_at = new Date(Date.now() - 1000).toISOString();
const expiredPasswordHash = db.members.get(seed.id).password_hash;
const expired = await api("/api/community/password-reset/complete", { token: expiredToken, password: "StrongExpiredPass456" });
pass("expired reset token is rejected without changing the password", expired.status === 400 && db.resetTokens.has(expiredRow.token_hash) && db.members.get(seed.id).password_hash === expiredPasswordHash);

// Atomic claim: simultaneous submissions for the same valid token must produce one success only.
db.rates.clear();
const concurrentRequest = await api("/api/community/password-reset/request", { email: seed.email });
const concurrentLink = new URL(sent.at(-1).verifyUrl);
const concurrentToken = new URLSearchParams(concurrentLink.hash.slice(concurrentLink.hash.indexOf("?") + 1)).get("reset");
assert.ok(concurrentRequest.status === 200 && concurrentToken, "concurrent-reset fixture must be created");
db.sessions.set("session-after-concurrent-reset", { member_id: seed.id, expires_at: "2099-01-01T00:00:00.000Z" });
const concurrentResponses = await Promise.all([
  api("/api/community/password-reset/complete", { token: concurrentToken, password: "StrongConcurrentPass456" }),
  api("/api/community/password-reset/complete", { token: concurrentToken, password: "StrongConcurrentPass789" }),
]);
const concurrentStatuses = (await Promise.all(concurrentResponses.map((response) => response.status))).sort((a, b) => a - b);
pass("concurrent reset submissions allow exactly one success", concurrentStatuses[0] === 200 && concurrentStatuses[1] === 400 && db.sessions.size === 0 && ![...db.resetTokens.values()].some((entry) => entry.member_id === seed.id));

// Request rate limit: the fourth request for the same address in one hour is silently throttled.
db.rates.clear();
const sentBeforeThrottle = sent.length;
const throttledResponses = [];
for (let i = 0; i < 4; i++) {
  throttledResponses.push(await api("/api/community/password-reset/request", { email: seed.email }, "203.0.113.90"));
}
const throttledBodies = await Promise.all(throttledResponses.map((response) => response.json()));
pass("reset requests are rate-limited without revealing account state", throttledResponses.every((response) => response.status === 200) &&
  throttledBodies.every((body) => body.message === genericBody.message) && sent.length - sentBeforeThrottle === 3);

// Submission rate limit: eleven invalid-token attempts from one IP hit the configured ten-attempt limit.
db.rates.clear();
const submitAttempts = [];
for (let i = 0; i < 11; i++) {
  submitAttempts.push(await api("/api/community/password-reset/complete", { token: "A".repeat(43), password: "StrongNewPass456" }, "203.0.113.91"));
}
const submitStatuses = await Promise.all(submitAttempts.map((response) => response.status));
pass("password-reset submissions are rate-limited after ten attempts",
  submitStatuses.filter((status) => status === 400).length === 10 && submitStatuses[10] === 429);

console.log("All password-reset tests passed using mocked D1 and a fake email relay. No live services were changed.");
