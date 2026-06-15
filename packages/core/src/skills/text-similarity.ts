const TOKEN_RE = /[a-z0-9][a-z0-9-]{1,}/g

export function tokenize(text: string) {
  return [...text.toLowerCase().matchAll(TOKEN_RE)].map((match) => match[0]!)
}

export function termFrequency(tokens: string[]) {
  const freq = new Map<string, number>()
  for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1)
  return freq
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [token, countA] of a) {
    normA += countA * countA
    const countB = b.get(token)
    if (countB) dot += countA * countB
  }
  for (const countB of b.values()) normB += countB * countB
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function textSimilarity(left: string, right: string) {
  return cosineSimilarity(termFrequency(tokenize(left)), termFrequency(tokenize(right)))
}
