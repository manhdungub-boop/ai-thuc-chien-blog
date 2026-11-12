import assert from "node:assert/strict";
import worker from "../recovery-snapshots/worker-email-verification-candidate.mjs";

class MockStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim().toLowerCase(); this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() { return this.db.run(this.sql, this.args); }
  async first() { return this.db.first(this.sql, this.args); }
  async all() { return { results: [] }; }
}
class MockD1 {
  constructor() { this.members = new Map(); this.tokens = new Map(); this.resetTokens = new Map(); this.sessions = new Map(); this.rates = new Map(); }
  prepare(sql) { return new MockStatement(this, sql); }
  async batch(statements) { const out=[]; for (const statement of statements) out.push(await statement.run()); return out; }
  async run(sql, a) {
    if (sql.startsWith("insert into community_rate_limits")) {
      const [bucket, windowStart] = a;
      const old = this.rates.get(bucket);
      const count = old && old.window_start === windowStart ? old.count + 1 : 1;
      this.rates.set(bucket, { count, window_start: windowStart });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert into community_members")) {
      const [id, username, email, display_name, password_salt, password_hash, created_at] = a;
      if ([...this.members.values()].some(m => m.email === email || m.username === username)) throw new Error("UNIQUE constraint failed");
      this.members.set(id, { id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at: null });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert into community_email_verification_tokens")) {
      const [token_hash, member_id, created_at, expires_at] = a;
      this.tokens.set(token_hash, { token_hash, member_id, created_at, expires_at });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith("insert into community_password_reset_tokens")) {
      const [token_hash, member_id, created_at, expires_at] = a;
      this.resetTokens.set(token_hash, { token_hash, member_id, created_at, expires_at });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("delete from community_password_reset_tokens where member_id = ? and token_hash <> ?")) {
      const [memberId, keepHash] = a; let n=0;
      for (const [hash, token] of this.resetTokens) if (token.member_id === memberId && hash !== keepHash) { this.resetTokens.delete(hash); n++; }
      return { meta: { changes: n } };
    }
    if (sql.startsWith("delete from community_password_reset_tokens where member_id")) {
      const [memberId] = a; let n=0;
      for (const [hash, token] of this.resetTokens) if (token.member_id === memberId) { this.resetTokens.delete(hash); n++; }
      return { meta: { changes: n } };
    }
    if (sql.startsWith("delete from community_password_reset_tokens where token_hash = ? and expires_at <= ?")) {
      const [hash, cutoff] = a; const token=this.resetTokens.get(hash);
      if (token && token.expires_at <= cutoff) { this.resetTokens.delete(hash); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("delete from community_password_reset_tokens where token_hash")) {
      const [hash] = a; const existed=this.resetTokens.delete(hash); return { meta: { changes: existed ? 1 : 0 } };
    }
    if (sql.startsWith("update community_members set password_salt = ?, password_hash = ? where id = ?")) {
      const [salt, hash, id] = a; const member=this.members.get(id);
      if (!member) return { meta: { changes: 0 } };
      member.password_salt=salt; member.password_hash=hash;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("delete from community_topic_presence where member_id = ?")) return { meta: { changes: 0 } };
    if (sql.startsWith("delete from community_sessions where member_id = ?")) {
      const [memberId] = a; let n=0;
      for (const [hash, session] of this.sessions) if (session.member_id === memberId) { this.sessions.delete(hash); n++; }
      return { meta: { changes: n } };
    }
    if (sql.startsWith("delete from community_email_verification_tokens where member_id = ? and token_hash <> ?")) {
      const [memberId, keepHash] = a; let n=0;
      for (const [hash, token] of this.tokens) if (token.member_id === memberId && hash !== keepHash) { this.tokens.delete(hash); n++; }
      return { meta: { changes: n } };
    }
    if (sql.startsWith("delete from community_email_verification_tokens where member_id")) {
      const [memberId] = a; let n=0;
      for (const [hash, token] of this.tokens) if (token.member_id === memberId) { this.tokens.delete(hash); n++; }
      return { meta: { changes: n } };
    }
    if (sql.startsWith("delete from community_email_verification_tokens where token_hash = ? and expires_at <= ?")) {
      const [hash, cutoff] = a; const token=this.tokens.get(hash);
      if (token && token.expires_at <= cutoff) { this.tokens.delete(hash); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("delete from community_email_verification_tokens where token_hash")) {
      const [hash] = a; const existed=this.tokens.delete(hash); return { meta: { changes: existed ? 1 : 0 } };
    }
    if (sql.startsWith("delete from community_members where id")) {
      const [id] = a; const existed=this.members.delete(id);
      for (const [hash, token] of this.tokens) if (token.member_id === id) this.tokens.delete(hash);
      for (const [hash, session] of this.sessions) if (session.member_id === id) this.sessions.delete(hash);
      return { meta: { changes: existed ? 1 : 0 } };
    }
    if (sql.startsWith("update community_members set email_verified_at")) {
      const [verifiedAt, id] = a; const member=this.members.get(id);
      if (member && !member.email_verified_at) { member.email_verified_at=verifiedAt; return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("delete from community_sessions where expires_at")) {
      const [expires] = a; let n=0;
      for (const [hash, session] of this.sessions) if (session.expires_at <= expires) { this.sessions.delete(hash); n++; }
      return { meta: { changes: n } };
    }
    if (sql.startsWith("insert into community_sessions")) {
      const [id, member_id, token_hash, created_at, expires_at] = a;
      this.sessions.set(token_hash, { id, member_id, token_hash, created_at, expires_at });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("delete from community_sessions where token_hash")) {
      const [hash] = a; const existed=this.sessions.delete(hash); return { meta: { changes: existed ? 1 : 0 } };
    }
    throw new Error("Mock D1 run does not support SQL: " + sql.slice(0,120));
  }
  async first(sql, a) {
    if (sql.startsWith("select count from community_rate_limits")) {
      const row=this.rates.get(a[0]); return row ? { count: row.count } : null;
    }

    if (sql.startsWith("delete from community_password_reset_tokens where token_hash = ? and expires_at > ? returning member_id")) {
      const [hash, cutoff] = a; const token=this.resetTokens.get(hash);
      if (!token || token.expires_at <= cutoff) return null;
      this.resetTokens.delete(hash);
      return { member_id: token.member_id };
    }
    if (sql.startsWith("delete from community_email_verification_tokens where token_hash = ? and expires_at > ? returning member_id")) {
      const [hash, cutoff] = a; const token=this.tokens.get(hash);
      if (!token || token.expires_at <= cutoff) return null;
      this.tokens.delete(hash);
      return { member_id: token.member_id };
    }
    if (sql.startsWith("select id, email_verified_at from community_members where email")) {
      const member=[...this.members.values()].find(m => m.email === a[0]);
      return member ? { id: member.id, email_verified_at: member.email_verified_at } : null;
    }
    if (sql.startsWith("select id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at from community_members where email")) {
      return [...this.members.values()].find(m => m.email === a[0]) || null;
    }
    if (sql.startsWith("select m.id, m.username, m.display_name, m.created_at from community_sessions")) {
      const [tokenHash, expires] = a;
      const session=this.sessions.get(tokenHash); if (!session || session.expires_at <= expires) return null;
      const m=this.members.get(session.member_id); if (!m) return null;
      return { id:m.id, username:m.username, display_name:m.display_name, created_at:m.created_at };
    }
    throw new Error("Mock D1 first does not support SQL: " + sql.slice(0,140));
  }
}

const db = new MockD1();
const origin = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const env = { DB: db, COMMUNITY_EMAIL_RELAY_URL: "https://script.google.com/macros/s/test-deployment/exec", COMMUNITY_EMAIL_RELAY_SECRET: "x".repeat(40) };
let relayMode = "ok";
const relayPayloads = [];
globalThis.fetch = async (_url, init) => {
  const payload=JSON.parse(init.body || "{}");
  relayPayloads.push(payload);
  if (relayMode === "http-error") return new Response("relay failure", { status: 503 });
  return new Response(JSON.stringify({ ok: relayMode === "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });
};
async function api(path, method, body, envOverride=env) {
  const init={ method, headers:{ "Origin":origin, "Content-Type":"application/json", "CF-Connecting-IP":"203.0.113.20" } };
  if (body !== undefined) init.body=JSON.stringify(body);
  return worker.fetch(new Request(origin + path, init), envOverride);
}
async function json(response) { return await response.json(); }
function tokenFromVerifyUrl(value) {
  const url = new URL(value);
  const queryIndex = url.hash.indexOf("?");
  return queryIndex >= 0 ? new URLSearchParams(url.hash.slice(queryIndex + 1)).get("verify") : null;
}
function assertPass(name, ok) { assert.ok(ok, name); console.log("PASS " + name); }

for (const mode of ["login", "register"]) {
  const response = await worker.fetch(new Request(origin + "/" + mode + "?utm_source=auth-route-test"), env);
  const location = new URL(response.headers.get("Location"));
  assertPass("direct /" + mode + " redirects to the community section", response.status === 302 && location.pathname === "/" && location.hash === "#cong-dong" && location.searchParams.get("mode") === mode);
  assertPass("direct /" + mode + " preserves campaign parameters and avoids caching", location.searchParams.get("utm_source") === "auth-route-test" && (response.headers.get("Cache-Control") || "").includes("no-store"));
}

const reg = await api("/api/community/register","POST",{username:"tester_1",displayName:"Tester One",email:"tester@example.invalid",password:"StrongPass123"});
const regBody=await json(reg);
assertPass("register returns pending verification",reg.status===202 && regBody.pendingVerification===true);
assertPass("pending registration sets no session cookie",!reg.headers.get("Set-Cookie"));
assertPass("member is stored unverified",db.members.size===1 && [...db.members.values()][0].email_verified_at===null);
assertPass("only token hash is stored",db.tokens.size===1 && ![...db.tokens.keys()].some(k=>relayPayloads[0].verifyUrl.includes(k)));
const verifyUrl=new URL(relayPayloads[0].verifyUrl);
const token=tokenFromVerifyUrl(verifyUrl.toString());
assertPass("email URL uses staging host and fragment-only token",verifyUrl.origin===origin && verifyUrl.search==="" && verifyUrl.hash.startsWith("#cong-dong?verify=") && /^[A-Za-z0-9_-]{32,80}$/.test(token));

const preLogin=await api("/api/community/login","POST",{email:"tester@example.invalid",password:"StrongPass123"});
const preLoginBody=await json(preLogin);
assertPass("login is blocked before confirmation",preLogin.status===403 && preLoginBody.code==="EMAIL_VERIFICATION_REQUIRED" && !preLogin.headers.get("Set-Cookie"));

const verify=await api("/api/community/verify-email","POST",{token});
const verifyBody=await json(verify);
assertPass("valid token confirms email",verify.status===200 && verifyBody.ok===true && [...db.members.values()][0].email_verified_at!==null);
assertPass("valid token is consumed",db.tokens.size===0);
const reuse=await api("/api/community/verify-email","POST",{token});
assertPass("reused token is rejected",reuse.status===400);

// Use an isolated in-memory D1 to test two concurrent requests for the same token.
const raceDb = new MockD1();
const raceEnv = { ...env, DB: raceDb };
const raceRegistration = await api("/api/community/register","POST",{username:"race_1",displayName:"Race Test",email:"race@example.invalid",password:"StrongPass123"},raceEnv);
const raceRegistrationBody = await json(raceRegistration);
const raceToken = tokenFromVerifyUrl(relayPayloads.at(-1).verifyUrl);
const raceResults = await Promise.all([
  api("/api/community/verify-email","POST",{token:raceToken},raceEnv),
  api("/api/community/verify-email","POST",{token:raceToken},raceEnv),
]);
const raceStatuses = raceResults.map(response => response.status).sort((a,b)=>a-b);
const raceMember = [...raceDb.members.values()].find(member => member.email === "race@example.invalid");
assertPass("race-test registration is pending",raceRegistration.status===202 && raceRegistrationBody.pendingVerification===true && Boolean(raceMember));
assertPass("concurrent token verification allows exactly one success",raceStatuses[0]===200 && raceStatuses[1]===400 && raceMember.email_verified_at!==null && raceDb.tokens.size===0);

const postLogin=await api("/api/community/login","POST",{email:"tester@example.invalid",password:"StrongPass123"});
const postLoginBody=await json(postLogin);
assertPass("login works after confirmation",postLogin.status===200 && postLoginBody.member.username==="tester_1" && Boolean(postLogin.headers.get("Set-Cookie")));

const relayFailDb=new MockD1();
const relayFailEnv={...env,DB:relayFailDb};
relayMode="false";
const failedReg=await api("/api/community/register","POST",{username:"relayfail",displayName:"Relay Fail",email:"relayfail@example.invalid",password:"StrongPass123"},relayFailEnv);
const failedBody=await json(failedReg);
assertPass("relay failure does not leave an account or token",failedReg.status===503 && failedBody.code==="EMAIL_RELAY_FAILED" && relayFailDb.members.size===0 && relayFailDb.tokens.size===0);

const noRelayDb=new MockD1();
const noRelayEnv={DB:noRelayDb};
const noRelay=await api("/api/community/register","POST",{username:"norelay",displayName:"No Relay",email:"norelay@example.invalid",password:"StrongPass123"},noRelayEnv);
const noRelayBody=await json(noRelay);
assertPass("missing relay configuration fails before account creation",noRelay.status===503 && noRelayBody.code==="EMAIL_RELAY_NOT_CONFIGURED" && noRelayDb.members.size===0);

relayMode="ok";
const resendReg=await api("/api/community/register","POST",{username:"resend_1",displayName:"Resend One",email:"resend@example.invalid",password:"StrongPass123"});
await json(resendReg);
const oldResendToken=tokenFromVerifyUrl(relayPayloads.at(-1).verifyUrl);
const resend=await api("/api/community/resend-verification","POST",{email:"resend@example.invalid"});
const resendBody=await json(resend);
const newResendToken=tokenFromVerifyUrl(relayPayloads.at(-1).verifyUrl);
assertPass("resend uses a generic response and rotates token",resend.status===200 && resendBody.ok===true && oldResendToken!==newResendToken && db.tokens.size===1);
const oldTokenResponse=await api("/api/community/verify-email","POST",{token:oldResendToken});
assertPass("previous token invalid after resend",oldTokenResponse.status===400);
const newTokenResponse=await api("/api/community/verify-email","POST",{token:newResendToken});
assertPass("resent token verifies the account",newTokenResponse.status===200);

// A failed resend must not invalidate the previously delivered verification link.
relayMode="ok";
const resendFailReg=await api("/api/community/register","POST",{username:"resendfail_1",displayName:"Resend Failure",email:"resendfail@example.invalid",password:"StrongPass123"});
await json(resendFailReg);
const priorResendFailToken=tokenFromVerifyUrl(relayPayloads.at(-1).verifyUrl);
relayMode="http-error";
const failedResend=await api("/api/community/resend-verification","POST",{email:"resendfail@example.invalid"});
assertPass("failed resend keeps the previous token and removes only the undelivered replacement",failedResend.status===200 && [...db.tokens.values()].filter(t=>t.member_id===[...db.members.values()].find(m=>m.email==="resendfail@example.invalid").id).length===1);
relayMode="ok";
const priorTokenAfterFailedResend=await api("/api/community/verify-email","POST",{token:priorResendFailToken});
assertPass("previous verification token remains usable after resend delivery failure",priorTokenAfterFailedResend.status===200);

const expiredReg=await api("/api/community/register","POST",{username:"expired_1",displayName:"Expired One",email:"expired@example.invalid",password:"StrongPass123"});
await json(expiredReg);
const expiredToken=tokenFromVerifyUrl(relayPayloads.at(-1).verifyUrl);
const expiredMember=[...db.members.values()].find(m=>m.email==="expired@example.invalid");
const expiredEntry=[...db.tokens.entries()].find(([,t])=>t.member_id===expiredMember.id);
expiredEntry[1].expires_at=new Date(Date.now()-1000).toISOString();
const expiredResponse=await api("/api/community/verify-email","POST",{token:expiredToken});
assertPass("expired token is rejected and removed",expiredResponse.status===400 && !db.tokens.has(expiredEntry[0]) && expiredMember.email_verified_at===null);


const rateLimitReg = await api("/api/community/register", "POST", {
  username: "ratelimit_1",
  displayName: "Rate Limit",
  email: "ratelimit@example.invalid",
  password: "StrongPass123",
});
const rateLimitRegBody = await json(rateLimitReg);
assertPass("rate-limit test account is created pending verification", rateLimitReg.status === 202 && rateLimitRegBody.pendingVerification === true);
const rateLimitMember = [...db.members.values()].find(m => m.email === "ratelimit@example.invalid");
assert.ok(rateLimitMember && rateLimitMember.email_verified_at === null);
const rateLimitPayloadStart = relayPayloads.length;
for (let i = 1; i <= 3; i++) {
  const resendAttempt = await api("/api/community/resend-verification", "POST", { email: "ratelimit@example.invalid" });
  const resendAttemptBody = await json(resendAttempt);
  assertPass("resend rate-limit allowed attempt " + i + " keeps generic response", resendAttempt.status === 200 && resendAttemptBody.ok === true);
}
assert.equal(relayPayloads.length, rateLimitPayloadStart + 3, "first three resend attempts should invoke the fake relay");
const latestRateTokenHash = [...db.tokens.entries()].find(([, t]) => t.member_id === rateLimitMember.id)?.[0];
assert.ok(latestRateTokenHash, "latest rate-limit token hash must exist");
const genericMissing = await json(await api("/api/community/resend-verification", "POST", { email: "missing@example.invalid" }));
const blockedResend = await api("/api/community/resend-verification", "POST", { email: "ratelimit@example.invalid" });
const blockedResendBody = await json(blockedResend);
assertPass("resend rate limit blocks fourth email attempt without revealing account state", blockedResend.status === 200 && blockedResendBody.ok === true && blockedResendBody.message === genericMissing.message);
assertPass("blocked resend does not call relay or rotate token", relayPayloads.length === rateLimitPayloadStart + 3 && db.tokens.has(latestRateTokenHash) && [...db.tokens.values()].filter(t => t.member_id === rateLimitMember.id).length === 1);


const existingMember = [...db.members.values()].find(m => m.email === "tester@example.invalid");
assert.ok(existingMember && existingMember.email_verified_at, "password-reset test member is verified");
const resetRequest = await api("/api/community/request-password-reset","POST",{email:"tester@example.invalid"});
const resetRequestBody = await json(resetRequest);
const resetEmail = relayPayloads.at(-1);
const resetUrlFromEmail = new URL(resetEmail.verifyUrl);
const resetHashIndex = resetUrlFromEmail.hash.indexOf("?");
const resetToken = resetHashIndex >= 0 ? new URLSearchParams(resetUrlFromEmail.hash.slice(resetHashIndex + 1)).get("reset") : null;
assertPass("password-reset request returns a generic response",resetRequest.status===200 && resetRequestBody.ok===true && resetRequestBody.message.includes("Nếu email thuộc tài khoản"));
assertPass("password-reset email subject is correct",resetEmail.subject==="Đặt lại mật khẩu — AI Thực Chiến");
assertPass("password-reset URL points to staging without a query token",resetUrlFromEmail.origin===origin && resetUrlFromEmail.search==="");
assertPass("password-reset URL stores token in reset fragment",resetUrlFromEmail.hash.startsWith("#cong-dong?reset=") && /^[A-Za-z0-9_-]{32,80}$/.test(resetToken));
assertPass("password-reset token is hashed at rest",db.resetTokens.size===1 && ![...db.resetTokens.keys()].some(h=>resetEmail.verifyUrl.includes(h)));
const beforeUnknownReset = relayPayloads.length;
const unknownReset = await api("/api/community/request-password-reset","POST",{email:"missing-reset@example.invalid"});
const unknownResetBody = await json(unknownReset);
assertPass("unknown email gets the same public response without an email",unknownReset.status===200 && unknownResetBody.message===resetRequestBody.message && relayPayloads.length===beforeUnknownReset);
const badResetToken = await api("/api/community/reset-password","POST",{token:"invalid-token",password:"NewStrongPass456"});
assertPass("malformed reset token is rejected",badResetToken.status===400 && db.resetTokens.size===1);
const oldPasswordHash = existingMember.password_hash;
const resetResponse = await api("/api/community/reset-password","POST",{token:resetToken,password:"NewStrongPass456"});
const resetResponseBody = await json(resetResponse);
assertPass("valid reset token updates the password",resetResponse.status===200 && resetResponseBody.ok===true && existingMember.password_hash!==oldPasswordHash);
assertPass("successful reset consumes token and revokes sessions",db.resetTokens.size===0 && ![...db.sessions.values()].some(s=>s.member_id===existingMember.id));
const replayReset = await api("/api/community/reset-password","POST",{token:resetToken,password:"AnotherStrong789"});
assertPass("reset token cannot be reused",replayReset.status===400);
const oldPasswordLogin = await api("/api/community/login","POST",{email:"tester@example.invalid",password:"StrongPass123"});
assertPass("previous password fails after reset",oldPasswordLogin.status===401);
const newPasswordLogin = await api("/api/community/login","POST",{email:"tester@example.invalid",password:"NewStrongPass456"});
assertPass("new password works after reset",newPasswordLogin.status===200 && Boolean(newPasswordLogin.headers.get("Set-Cookie")));

console.log("All runtime tests passed using an in-memory D1 mock and a fake relay. No real email, database, or production Worker was used.");
