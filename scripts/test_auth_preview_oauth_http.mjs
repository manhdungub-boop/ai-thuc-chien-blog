#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';

const configured = String(process.env.PREVIEW_URL || '');
if (!configured) throw new Error('PREVIEW_URL is required.');
const base = new URL(configured);
const expectedOrigin = 'https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev';
assert.equal(base.origin, expectedOrigin, 'Safety stop: this test targets only the dedicated OAuth staging Preview origin.');
assert.equal(base.pathname, '/', 'PREVIEW_URL must be the origin root.');
assert.equal(base.search, '', 'PREVIEW_URL must not include a query string.');
assert.equal(base.hash, '', 'PREVIEW_URL must not include a fragment.');
const target = base.origin;

async function request(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', ...(init.headers || {}) },
  });
}

const frontend = await request(target + '/script.js', { headers: { Accept: 'text/javascript' } });
assert.equal(frontend.status, 200, 'Preview frontend script must return HTTP 200.');
const frontendSource = await frontend.text();
assert.match(frontendSource, /ai-thuc-chien-blog-auth-app-preview\.manhdungub\.workers\.dev/,
  'Deployed frontend must allow the exact documented OAuth Preview host.');
console.log('PASS: deployed frontend includes the exact OAuth Preview host allowlist entry.');

const me = await request(target + '/api/community/me', {
  headers: { Origin: target },
});
assert.equal(me.status, 200, 'Unauthenticated /me must return HTTP 200.');
assert.equal(me.headers.get('access-control-allow-origin'), target, 'CORS must allow only the exact Preview origin.');
assert.equal(me.headers.get('access-control-allow-credentials'), 'true', 'Preview CORS must allow credentialed session requests.');
const mePayload = await me.json();
assert.equal(mePayload.member, null, 'Unauthenticated /me must not disclose a member.');
console.log('PASS: unauthenticated /me and exact-origin CORS.');

const providersResponse = await request(target + '/api/community/oauth/providers', {
  headers: { Origin: target },
});
assert.equal(providersResponse.status, 200, 'OAuth provider readiness must return HTTP 200.');
assert.equal(providersResponse.headers.get('access-control-allow-origin'), target);
const providers = await providersResponse.json();
assert.equal(providers.google, true, 'Google OAuth must be configured on this exact staging origin.');
assert.equal(providers.facebook, false, 'Facebook OAuth must remain disabled.');
console.log('PASS: Google OAuth is ready on the staging Preview; Facebook remains disabled.');

async function startFlow() {
  const response = await request(target + '/api/community/oauth/google/start');
  assert.equal(response.status, 302, 'Google OAuth start must redirect to Google.');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.pathname, '/o/oauth2/v2/auth');
  assert.equal(location.searchParams.get('redirect_uri'), target + '/api/community/oauth/google/callback');
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const state = location.searchParams.get('state');
  assert.match(state || '', /^[A-Za-z0-9_-]{43}$/);
  const setCookies = response.headers.getSetCookie();
  assert.equal(setCookies.length, 3, 'Each Google OAuth transaction must set exactly three cookies.');
  const pairs = setCookies.map((cookie) => cookie.split(';', 1)[0]);
  const names = pairs.map((pair) => pair.slice(0, pair.indexOf('=')));
  for (const part of ['state', 'verifier', 'nonce']) {
    const expected = '__Host-ai_oauth_google_' + part + '_' + state;
    assert.ok(names.includes(expected), 'Missing transaction-scoped cookie ' + expected);
  }
  for (const cookie of setCookies) {
    assert.match(cookie, /;\s*Path=\//i);
    assert.match(cookie, /;\s*HttpOnly/i);
    assert.match(cookie, /;\s*Secure/i);
    assert.match(cookie, /;\s*SameSite=Lax/i);
  }
  return { state, pairs, names, setCookies };
}

const first = await startFlow();
const second = await startFlow();
assert.notEqual(first.state, second.state, 'Overlapping OAuth starts must have independent state values.');
for (const name of first.names) {
  assert.ok(!second.names.includes(name), 'Overlapping OAuth transactions must not share cookie names: ' + name);
}
const allCookiePairs = [...first.pairs, ...second.pairs].join('; ');
console.log('PASS: two overlapping OAuth starts use six distinct transaction-scoped secure cookies.');

const invalidCallback = new URL(target + '/api/community/oauth/google/callback');
invalidCallback.searchParams.set('code', 'invalid-probe-code');
invalidCallback.searchParams.set('state', 'attacker-controlled-state');
const invalid = await request(invalidCallback.toString(), {
  headers: { Cookie: allCookiePairs },
});
assert.equal(invalid.status, 302, 'Invalid OAuth callback must redirect safely.');
const invalidLocation = new URL(invalid.headers.get('location'));
assert.equal(invalidLocation.searchParams.get('oauth_error'), 'OAUTH_STATE_INVALID');
const clearedCookies = invalid.headers.getSetCookie().filter((cookie) => /Max-Age=0/i.test(cookie));
assert.equal(clearedCookies.length, 0,
  'A callback without its matching transaction cookie must not clear either active OAuth flow.');
console.log('PASS: invalid callback does not clear cookies from either overlapping OAuth transaction.');

const verification = await request(target + '/google4e45ddcf8facb122.html', {
  headers: { Accept: 'text/html' },
});
assert.equal(verification.status, 200, 'Google Search Console verification file must return HTTP 200 on Preview.');
assert.equal(
  (await verification.text()).trim(),
  'google-site-verification: google4e45ddcf8facb122.html',
  'Google Search Console verification content must match the repository source.'
);
console.log('PASS: Search Console verification asset is served by the isolated Preview Worker.');

console.log('PASS: staging OAuth Preview HTTP smoke tests completed; no user account was created and no email was sent.');
