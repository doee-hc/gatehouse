# Domain skill extract · {{mission_id}}

{{lead_name}} accepted delivery and started retro. Extract domain skills from **this execution**.

**Your node:** {{node_id}}
**Skill domain for this node:** `{{skill_domain}}`

## Domain directory (read yourself — not fully injected)

`{{skill_domain_path}}/`

Before extracting, **read** existing `*/SKILL.md` under that path; **merge updates** if present, else create a new subdirectory.

{{skill_domain_existing_section}}

## Constraints

- Create skill dirs and `SKILL.md` **only for steps you actually executed**
- **Do not** pre-create empty dirs for steps you did not run or other `skill_domain`s (dirs without `SKILL.md` are cleaned up)
- **Do not** create skills outside `{{skill_domain}}`
- **Do not** batch `mkdir` all slugs from a list; create a subdir only when you write `SKILL.md` for that step

## Extract principles

1. **Single business action + minimal knowledge loop** — one core problem per skill.
2. **Naming** — slug must be verb+noun, e.g. `resolve-tessent-c9-drc`, `capture-waveform-glitch-time`.
3. **Format** — OpenCode `SKILL.md`: YAML frontmatter with `name`, `description`, plus **trigger** and **anti-trigger** scenarios.
4. **Size** — body strictly **1k–3k tokens** (Markdown body).
5. **Dedup** — no duplicate wheels; when merging, drop one-off Mission details, keep reusable steps and paths.

## Output path

`{{skill_domain_path}}/<verb-noun-slug>/SKILL.md`

## Delivery

1. Write `.gatehouse/trees/{{mission_id}}/reports/skills/{{node_id}}-extract.md` — list of new/updated skill paths + one-line summary each.
2. Call **`gatehouse_skill_extract_record()`** when done.

**Do not** `gatehouse_send_message` {{curator_name}} — Gatehouse auto-notifies {{curator_name}} after all nodes record.
