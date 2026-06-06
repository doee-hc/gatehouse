export function trimRecipientQuery(recipient: string | undefined) {
  const query = recipient?.trim()
  if (!query) return undefined
  return query
}
