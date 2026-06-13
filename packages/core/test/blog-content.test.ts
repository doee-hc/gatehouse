import { expect, test } from "bun:test"
import {
  blogPostFormatFromPath,
  excerptFromBlogPost,
  extractBlogPostTitle,
} from "../src/portal/blog-content.ts"

test("blogPostFormatFromPath detects html and markdown", () => {
  expect(blogPostFormatFromPath("content/post.html")).toBe("html")
  expect(blogPostFormatFromPath("content/post.htm")).toBe("html")
  expect(blogPostFormatFromPath("content/post.md")).toBe("markdown")
})

test("extractBlogPostTitle reads markdown heading", () => {
  expect(extractBlogPostTitle("# 标题\n\n正文", "markdown", "fallback.md")).toBe("标题")
})

test("extractBlogPostTitle reads html title and h1", () => {
  const withTitle = `<!DOCTYPE html><html><head><title>页面标题</title></head><body></body></html>`
  expect(extractBlogPostTitle(withTitle, "html", "fallback.html")).toBe("页面标题")

  const withH1 = `<div><h1>主标题</h1><p>正文</p></div>`
  expect(extractBlogPostTitle(withH1, "html", "fallback.html")).toBe("主标题")
})

test("excerptFromBlogPost strips html and markdown noise", () => {
  const html = `<style>.x{}</style><script>alert(1)</script><p>Hello <b>world</b></p>`
  expect(excerptFromBlogPost(html, "html")).toBe("Hello world")

  const markdown = "# 标题\n\n正文 与 [链接](https://example.com)"
  expect(excerptFromBlogPost(markdown, "markdown")).toBe("正文 与 链接")
})
