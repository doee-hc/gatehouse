# User-await watchdog

Gatehouse detected the user has **not replied for {{idle_minutes}} minutes** after you asked for confirmation.

**Phase:** `{{phase}}` · **Mission:** `{{mission_id}}`  
**Long-term direction confirmed:** {{direction_confirmed}}

The user may be busy. You may decide autonomously **only if** `gatehouse_direction_status` reports `confirmed: true`. Otherwise summarize options and wait — do not `mission_start` or `mission_complete`.

## Do now (by phase)

### pre_start
- **P1/P2** (not P0): `gatehouse_mission_start(mission_id="{{mission_id}}")` when intent is clear and direction is confirmed.
- **P0** or direction not confirmed: do not start; leave mission `queued`.

### acceptance
1. `gatehouse_delivery_status(mission_id="{{mission_id}}")`
2. If `auto_accept_eligible` is false (unmet precheck): `gatehouse_delivery_review(revision_requested, ...)` with concrete `failed_criteria`.
3. If eligible: read deliverable paths; for **manual** `done_when` items, read files and judge against the frozen contract yourself.
4. Write `.gatehouse/lead/reports/{{mission_id}}/auto-decision.md` (short checklist + rationale).
5. Then `gatehouse_mission_retro` or `gatehouse_mission_complete` per mission `notes` (Portal publish opt-in).

### post_retro
- When rollup is ready: `gatehouse_mission_complete(status=done, ...)` after both architect and curator summaries (if skill domains were assigned).
- Record `user_feedback` noting autonomous completion due to user silence.

**User messages always override this reminder.** If the user replies later, follow the user, not this note.
