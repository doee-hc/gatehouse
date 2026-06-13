export type BlogPostFormat = "markdown" | "html"

export function blogPostFormatFromPath(relPath: string): BlogPostFormat {
  return /\.html?$/i.test(relPath) ? "html" : "markdown"
}

export function extractBlogPostTitle(content: string, format: BlogPostFormat, fallback: string) {
  if (format === "html") return extractTitleFromHtml(content, fallback)
  const match = content.match(/^#\s+(.+)$/m)
  if (match?.[1]) return match[1].trim()
  return fallback.replace(/\.(md|html?)$/i, "")
}

function extractTitleFromHtml(content: string, fallback: string) {
  const titleMatch = content.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch?.[1]?.trim()) return decodeHtmlEntities(titleMatch[1].trim())
  const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match?.[1]) {
    const plain = stripHtmlTags(h1Match[1]).trim()
    if (plain) return plain
  }
  return fallback.replace(/\.(md|html?)$/i, "")
}

export function excerptFromBlogPost(content: string, format: BlogPostFormat, maxLen = 180) {
  const plain =
    format === "html"
      ? stripHtmlTags(content).replace(/\s+/g, " ").trim()
      : excerptFromMarkdown(content)
  if (plain.length <= maxLen) return plain
  return `${plain.slice(0, maxLen).trim()}…`
}

function excerptFromMarkdown(markdown: string) {
  return markdown
    .replace(/^#+\s.+$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#|-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function stripHtmlTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
