# Domain skill extraction · {{mission_id}}

{{lead_name}} confirmed delivery and started retro. Use this node's `context/` and deliverables as the sole source of truth — do not rely on execution-session memory.

**Your node:** {{node_id}}
**Skill domain:** `{{skill_domain}}`

## Data sources (single source of truth)

```
.gatehouse/trees/{{mission_id}}/context/{{node_id}}/
  messages.json
  timeline.md
  metrics.json
```

**grep** `timeline.md` first, then **read** relevant slices and deliverables (`reports/`, `articles/`, etc.).

## Domain directory

`{{skill_domain_path}}/`

**read** existing `*/SKILL.md` before extracting; merge when possible.

{{skill_domain_existing_section}}

## Constraints

- Create skills only for steps evidenced in **context/ and deliverables**
- **Do not** create skills outside `{{skill_domain}}`
- **At most 2 new skills** per mission per domain; merge when similarity ≥ 0.85
- Long bodies need **methodology structure** (steps, triggers); do not write pure task reports

## Principles

1. **One business action + minimal closed loop**
2. **Naming** — verb-noun slug
3. **Format** — YAML frontmatter + **trigger/forbidden** sections
4. **Size** — 1k–3k token body
5. **Dedupe + reuse** — drop feature-bound cases, keep generic steps
6. **Abstraction** — core steps must not depend on product names

## Output path

`{{skill_domain_path}}/<verb-noun-slug>/SKILL.md`

## Delivery

1. Write `.gatehouse/trees/{{mission_id}}/reports/skills/{{node_id}}-extract.md`
2. **`gatehouse_skill_extract_record()`**

If registration is rejected, read `issues` from the tool response, fix `SKILL.md`, and retry. Remove mistaken new directories.
