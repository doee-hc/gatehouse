import { readAgentNamesSync, renderAgentPrompt } from "../names.ts"
import { resolveAgentTemplatePath, stripMarkdownFrontmatter } from "./agent-template.ts"

export async function loadCuratorPrompt(projectDirectory: string) {
  const file = await resolveAgentTemplatePath("curator.md", projectDirectory)
  return renderAgentPrompt(stripMarkdownFrontmatter(await Bun.file(file).text()), readAgentNamesSync(projectDirectory), "curator")
}
