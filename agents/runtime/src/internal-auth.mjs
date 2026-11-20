function toBytes(value) {
  return new TextEncoder().encode(value);
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toBytes(value)));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

/** Dedicated Worker-to-State-Store credential; never reuse the operator token. */
export async function hasValidStateStoreBearer(request, env = {}) {
  const configured = env.AGENT_STATE_STORE_TOKEN;
  if (typeof configured !== "string" || configured.length < 32 || configured.length > 512) {
    return false;
  }
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization);
  if (!match || match[1].length < 32 || match[1].length > 512) return false;
  try {
    const [providedDigest, configuredDigest] = await Promise.all([
      digest(match[1]),
      digest(configured),
    ]);
    return equalBytes(providedDigest, configuredDigest);
  } catch {
    return false;
  }
}
