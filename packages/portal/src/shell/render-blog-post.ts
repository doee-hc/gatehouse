import type { BlogPost } from "../api/types.ts"
import { renderMarkdown } from "./markdown.ts"

export function renderBlogPostBody(body: HTMLElement, post: BlogPost) {
  body.replaceChildren()
  if (post.format === "html") {
    body.classList.add("blog-html-body")
    const frame = document.createElement("iframe")
    frame.className = "blog-html-frame"
    frame.setAttribute("sandbox", "allow-scripts")
    frame.setAttribute("title", post.title)
    frame.srcdoc = post.markdown
    body.appendChild(frame)
    return
  }
  body.classList.remove("blog-html-body")
  body.innerHTML = renderMarkdown(post.markdown)
}
