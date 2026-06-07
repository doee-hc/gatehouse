# Execution team all-idle watchdog

Gatehouse detected Mission **{{mission_id}}** execution team all sessions idle for **{{idle_seconds}}** seconds while Mission is still `running`.

Possible causes: a node finished but did not `gatehouse_send_message` upstream; or work is done but {{lead_name}} was not notified to pause the watchdog.

## Investigate now

**Note:** This message fires when the **whole execution team** is abnormally idle; after delegating tasks, stop and wait — do not snapshot-loop in normal flow.

1. `gatehouse_list_team()` — check `execution` (full tree; applies when you are in an inner session).
2. For each **non-root** `node_id`, call `gatehouse_session_snapshot(recipient="<node_id>")` **once** to find blockers (no repeat polling).
3. Based on snapshots:
   - Teammate idle and work seems done → `gatehouse_send_message` upstream or to task coordinator with status.
   - Teammate idle but work incomplete → assign or follow up via `send_message`.
   - Subtree still undelivered → continue delegation; when done, return to assign → wait for messages.

## After investigation

When Mission execution is complete, notify {{lead_name}} (`gatehouse_send_message(recipient="lead", ...)` pauses watchdog until {{lead_name}} or execution team assigns again):

1. **If completion was never sent to {{lead_name}}** (missed earlier, verbal only, etc.) → write delivery report if needed, then send completion notification.
2. **If completion was already sent** → send one more message to {{lead_name}}: `Work complete — no reply needed` to close the watchdog.

**Note:** Do not spam busy teammates with `send_message`; do not snapshot-poll after triage.
