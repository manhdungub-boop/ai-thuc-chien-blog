import { marked } from "marked";

const renderer = new marked.Renderer();
renderer.html = function (token) {
  return String(token.text).replace(/[&<>"']/g, function (c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
};

export function renderDraftMarkdown(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(
    /!\[([^\]]*)\]\(\.\.\/assets\/([a-z0-9-]+\.svg)\)/gi,
    function (_match, alt, file) { return "![" + alt + "](../../assets/" + file + ")"; }
  );
  return marked.parse(normalized, {
    gfm: true,
    breaks: false,
    async: false,
    renderer,
    walkTokens: function (token) {
      if (token.type === "link") {
        try {
          const destination = new URL(token.href);
          if (destination.protocol !== "https:") token.href = "#blocked-link";
        } catch (_error) {
          if (!token.href.startsWith("#")) token.href = "#blocked-link";
        }
      }
      if (token.type === "image" && !/^(?:\/assets\/|\.\.\/\.\.\/assets\/)[a-z0-9-]+\.svg$/i.test(token.href)) {
        token.href = "/assets/blocked.svg";
      }
    }
  });
}
