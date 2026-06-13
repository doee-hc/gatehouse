/** Portal publish is system-managed on gatehouse_mission_complete(done) — not an inner task. */

const PORTAL_PUBLISH_CRITERION = [
  /发布到\s*portal/i,
  /发布到门户/i,
  /publish\s*(to\s*)?portal/i,
  /portal\s*publish/i,
  /gatehouse_publish_blog/i,
  /\bpublish_blog\b/i,
  /^报告被发布/i,
  /^发布到\s/i,
]

export function isPortalPublishCriterion(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  return PORTAL_PUBLISH_CRITERION.some((pattern) => pattern.test(trimmed))
}

/** done_when / acceptance_slice shown to architect, curator, and execution nodes. */
export function filterDoneWhenForExecutionTeam(items: string[]) {
  return items.filter((item) => !isPortalPublishCriterion(item))
}

export function sanitizeInnerBriefStrings(strings: string[]) {
  return strings
    .map((item) =>
      item
        .replace(/[（(]\s*gatehouse_publish_blog\s*[)）]/gi, "")
        .replace(/\s*gatehouse_publish_blog\s*/gi, "")
        .trim(),
    )
    .filter((item) => item.length > 0 && !isPortalPublishCriterion(item))
}
