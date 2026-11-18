const PUBLISHERS = [
  {
    id: "openai-news",
    name: "OpenAI News",
    host: "openai.com",
    pathPrefix: "/index/",
    sourceLabels: ["openai news"],
    sourceType: "first_party_company_publication"
  },
  {
    id: "google-deepmind",
    name: "Google DeepMind",
    host: "deepmind.google",
    pathPrefix: "/blog/",
    sourceLabels: ["google deepmind", "deepmind"],
    sourceType: "first_party_research_lab_publication"
  },
  {
    id: "hugging-face",
    name: "Hugging Face",
    host: "huggingface.co",
    pathPrefix: "/blog/",
    sourceLabels: ["hugging face"],
    sourceType: "first_party_platform_publication"
  },
  {
    id: "arxiv-cs-ai",
    name: "arXiv cs.AI",
    host: "arxiv.org",
    pathPrefix: "/abs/",
    sourceLabels: ["arxiv cs.ai", "arxiv"],
    sourceType: "research-preprint-repository"
  }
];

function normalizeLabel(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\\s+/g, " ") : "";
}

/**
 * Identifies a source only when its exact publisher label, host, and path
 * match the runtime's fixed research-feed allowlist. This is provenance
 * classification, not an endorsement or independent authority assessment.
 */
export function classifyResearchPublisher(source, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { accepted: false, reason: "invalid_source_url" };
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || url.search || url.hash) {
    return { accepted: false, reason: "invalid_source_url" };
  }
  const label = normalizeLabel(source);
  const publisher = PUBLISHERS.find(item =>
    item.host === url.hostname &&
    url.pathname.startsWith(item.pathPrefix) &&
    item.sourceLabels.includes(label)
  );
  if (!publisher) {
    return { accepted: false, reason: "publisher_identity_not_allowlisted" };
  }
  return {
    accepted: true,
    publisher: {
      id: publisher.id,
      name: publisher.name,
      host: publisher.host,
      source_type: publisher.sourceType,
      authority_independently_verified: false
    }
  };
}

export function listResearchPublisherPolicy() {
  return PUBLISHERS.map(({ id, name, host, pathPrefix, sourceType }) => ({
    id, name, host, path_prefix: pathPrefix, source_type: sourceType
  }));
}
