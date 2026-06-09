export function chunkText(text: string, maxLen = 2000) {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > maxLen) {
    let splitAt = rest.lastIndexOf("\n", maxLen)
    if (splitAt < maxLen * 0.5) splitAt = maxLen
    chunks.push(rest.slice(0, splitAt).trim())
    rest = rest.slice(splitAt).trim()
  }
  if (rest) chunks.push(rest)
  return chunks.filter(Boolean)
}
