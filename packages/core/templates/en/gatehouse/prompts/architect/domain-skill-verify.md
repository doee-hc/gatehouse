# Skill verify · {{mission_id}} · node {{node_id}}

Review whether the skill draft from extract meets **reusable methodology** standards.

**Domain:** `{{skill_domain}}`
**Extract summary:** `.gatehouse/trees/{{mission_id}}/reports/skills/{{node_id}}-extract.md`

## Verify checklist

1. **Abstraction** — If you remove all product/feature names, does the framework still hold?
2. **Structure** — "When to use" / "When not to use"? Executable analysis steps?
3. **Dedup** — High overlap with existing skills under `{{skill_domain_path}}/`? Merge instead of duplicating.
4. **Product-name density** — Is the body over-bound to a specific release/feature?

## Context (if needed)

```
.gatehouse/trees/{{mission_id}}/context/{{node_id}}/timeline.md
```

## When not passing

- **Fix** the relevant `SKILL.md` directly (abstract, merge duplicates)
- List changes in the verify report

## Deliver

1. Write `.gatehouse/trees/{{mission_id}}/reports/skills/{{node_id}}-verify.md`
2. After fixes, call **`gatehouse_skill_verify_record(passed=true)`** only when verification passes.

Fix `SKILL.md` first before recording; do not use `passed=false`.
