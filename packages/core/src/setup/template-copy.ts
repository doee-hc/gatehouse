const TEXT_TEMPLATE = /\.(md|yaml|yml)$/i

export function isTextTemplateFile(relative: string) {
  return TEXT_TEMPLATE.test(relative)
}

export async function writeTemplateFile(
  sourcePath: string,
  destPath: string,
  relative: string,
  render?: (relativePath: string, text: string) => string,
) {
  if (isTextTemplateFile(relative)) {
    const raw = await Bun.file(sourcePath).text()
    await Bun.write(destPath, render ? render(relative, raw) : raw)
    return
  }
  await Bun.write(destPath, await Bun.file(sourcePath).arrayBuffer())
}
