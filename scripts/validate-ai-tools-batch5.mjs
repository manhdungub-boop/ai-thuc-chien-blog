import fs from "node:fs";
import assert from "node:assert/strict";

const candidatePath = process.argv[2] || "site-snapshot/data/review/ai-tools-candidates-2026-11-01-batch5.json";
const primaryPath = process.argv[3] || "site-snapshot/data/ai-tools.json";
const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const candidates = read(candidatePath), primary = read(primaryPath);
assert.ok(Array.isArray(candidates.tools), "candidate tools must be an array");
assert.equal(candidates.tools.length, 15, "batch 5 must contain exactly 15 candidates");
const required = ["id","name","vendor","website","categories","pricing_model","pricing_status","license","platforms","description","free_tier_summary","official_sources","last_verified","verification_status","status","tags"];
const allowedPricing = new Set(["free","freemium","paid","trial_or_credits","self_hosted_free_and_cloud_paid","unknown"]);
const allowedPricingStatus = new Set(["verified_free","verified_free_tier","limited_credits","paid_only","self_hosted_free","unknown"]);
const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const ids = new Set(), names = new Set();
const known = [...(primary.tools || [])];
const primaryById = new Map(known.map(t => [t.id, t]));
const primaryByName = new Map(known.map(t => [norm(t.name), t]));
const earlierBatch3Ids = ["langsmith","arize-phoenix","open-webui","pipedream","haystack","vllm","llama-cpp","langflow","llamaindex","crewai","agno","pydantic-ai","mastra","openai-agents-sdk","localai"];
const earlierBatch3Names = ["LangSmith","Arize Phoenix","Open WebUI","Pipedream","Haystack","vLLM","llama.cpp","Langflow","LlamaIndex","CrewAI","Agno","Pydantic AI","Mastra","OpenAI Agents SDK","LocalAI"];
const earlierBatch4Ids = ["microsoft-agent-framework","semantic-kernel","dspy","promptfoo","deepeval","guardrails-ai","docling","lm-studio","jan-ai","sglang","faster-whisper","ragas","paddleocr","bentoml","gpt4all"];
const earlierBatch4Names = ["Microsoft Agent Framework","Microsoft Semantic Kernel","DSPy","Promptfoo","DeepEval","Guardrails AI","Docling","LM Studio","Jan","SGLang","faster-whisper","Ragas","PaddleOCR","BentoML","GPT4All"];
const earlierIds = new Set([...earlierBatch3Ids, ...earlierBatch4Ids]);
const earlierNames = new Set([...earlierBatch3Names, ...earlierBatch4Names].map(norm));
for (const [index, tool] of candidates.tools.entries()) {
  for (const field of required) assert.ok(Object.hasOwn(tool, field), "tools[" + index + "] missing " + field);
  for (const field of ["id","name","vendor","website","pricing_model","pricing_status","license","description","free_tier_summary","last_verified","verification_status","status"]) {
    assert.equal(typeof tool[field], "string", "tools[" + index + "]." + field + " must be a string");
    assert.ok(tool[field].trim().length > 0, "tools[" + index + "]." + field + " must not be empty");
  }
  for (const field of ["categories","platforms","official_sources","tags"]) {
    assert.ok(Array.isArray(tool[field]) && tool[field].length > 0, "tools[" + index + "]." + field + " must be a non-empty array");
    assert.ok(tool[field].every(value => typeof value === "string" && value.trim().length > 0), "tools[" + index + "]." + field + " must contain non-empty strings");
  }
  assert.match(tool.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid ID: " + tool.id);
  assert.ok(!ids.has(tool.id), "duplicate candidate ID: " + tool.id); ids.add(tool.id);
  const name = norm(tool.name); assert.ok(name && !names.has(name), "duplicate candidate name: " + tool.name); names.add(name);
  const primaryIdMatch = primaryById.get(tool.id);
  const primaryNameMatch = primaryByName.get(name);
  if (primaryIdMatch || primaryNameMatch) {
    assert.ok(primaryIdMatch && primaryNameMatch === primaryIdMatch, "promoted candidate ID/name must match the same primary catalog record: " + tool.id);
    assert.deepEqual(primaryIdMatch, tool, "promoted catalog record must remain identical to its reviewed candidate: " + tool.id);
  } else {
    assert.ok(!earlierIds.has(tool.id), "ID already exists in batch 3 or batch 4: " + tool.id);
    assert.ok(!earlierNames.has(name), "name already exists in batch 3 or batch 4: " + tool.name);
  }
  for (const source of [tool.website, ...tool.official_sources]) {
    let parsed;
    try { parsed = new URL(source); } catch { assert.fail("invalid source URL: " + source); }
    assert.equal(parsed.protocol, "https:", "non-HTTPS source: " + source);
    assert.ok(parsed.hostname && !parsed.username && !parsed.password, "unsafe source URL: " + source);
  }
  assert.ok(allowedPricing.has(tool.pricing_model), "unsupported pricing_model: " + tool.id);
  assert.ok(allowedPricingStatus.has(tool.pricing_status), "unsupported pricing_status: " + tool.id);
  assert.ok(["verified","needs_review"].includes(tool.verification_status), "invalid verification status: " + tool.id);
  assert.match(tool.last_verified, /^\d{4}-\d{2}-\d{2}$/, "invalid verification date: " + tool.id);
  const verifiedDate = new Date(tool.last_verified + "T00:00:00Z");
  assert.ok(!Number.isNaN(verifiedDate.getTime()) && verifiedDate.toISOString().slice(0, 10) === tool.last_verified, "invalid calendar date: " + tool.id);
}
const verified = candidates.tools.filter(t => t.verification_status === "verified").length;
const review = candidates.tools.filter(t => t.verification_status === "needs_review").length;
assert.equal(verified, 12, "expected twelve source-reviewed records");
assert.equal(review, 3, "expected three records to remain under review");
console.log("Candidate batch 5 OK: " + candidates.tools.length + " unique records; " + verified + " verified; " + review + " needs_review; no duplicates across primary catalog, batch 3, or batch 4.");
