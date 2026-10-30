# foo-needs-me

Foo needs me? Who needs me? A tiny terminal dashboard that shows which of your pi and Claude Code sessions are waiting on you. No tmux needed (works on native Windows).

- `status-beacon.ts` - pi extension: writes session state to `~/.pi/status/`, adds `/open-dashboard`
- `cc-beacon.mjs` - Claude Code hook script: same state files, driven by hooks
- `pi-status.mjs` - the viewer (`--once` prints one frame, `--once --tick=N` for a specific animation frame)
- `install.mjs` - copies files into `~/.pi/` and merges hooks into `~/.claude/settings.json` (backup first)

## Install / update / remove

    node install.mjs              # install or update (idempotent)
    node install.mjs --uninstall  # remove files and our hooks

Then `/reload` in each pi, restart running Claude Code sessions, and run `/open-dashboard` in pi
(or `node ~/.pi/pi-status.mjs`).

## Reading the dashboard

![dashboard](docs/dashboard.png)

```
  ~ who needs me? foo needs me. ~

  agents 8   needs you 2   done 2   working 2   parked 2   subagents 2
  [######..................] 2 need you

  (!_!)    api-server             claude  5m0s   approve?
  (!_!)    web-app                pi      40s    needs input
  \(^o^)/  docs-site              claude  26s    just finished!
  (^_^)    mobile-client          claude  7m0s   done
  (-_-) /  data-pipeline          claude  4m2s   busy                +1 sub
  (-_-) /  auth-service           pi      1m35s  busy                +1 sub
  (-.-)zZ  infra-scripts          claude  2h0m   parked
  (-.-)zZ  legacy-batch           claude  1h30m  parked

  2 are stuck on you. unblock them first.
  q quit   p show/hide parked
```

Only **needs you** is urgent. A session that is simply *done* is not asking for anything, and it fades as you move on, so a pile of finished sessions never looks like a to-do list.

**Header.** `agents` is every Pi and Claude Code session reporting in, split by state:
- `needs you` - blocked on an approval or a question (yellow). The only urgent state.
- `done` - finished recently, a result you may want to look at (green)
- `working` - busy (cyan)
- `parked` - finished a while ago (default 1 hour) and you moved on (dim)
- `subagents` - helper agents currently running under those sessions

**Bar.** Each yellow `#` is a slice of your agents that needs a response; dots are everything else. The label says `N need you`, or `nothing urgent`.

**Rows**, in this order: needs you, then done (newest first), then working, then parked.

| Column | Meaning |
|---|---|
| face | mood, see below |
| project | folder name the session runs in |
| tool | `claude` or `pi` |
| time | how long it has been in its current state |
| note | short status text |
| `+N sub` | N subagents currently running under that session |

| Face | State |
|---|---|
| `(!_!)` | needs you: `approve?` = permission prompt, `has a question` / `needs input` = a question or dialog |
| `\(^o^)/` | done, under 2 min: `just finished!` |
| `(^_^)` | done, 2 min to 1 hour: `done` |
| `(-.-)zZ` | parked (dim): done more than 1 hour ago, you moved on |
| `(-_-) /` | working (the `/` is a spinner) |

Done sessions never get more worried over time; they just fade.

**Keys.** `p` hides or shows parked rows, `q` quits. Change the parking time with the `PI_STATUS_PARK_MIN` environment variable (minutes).

**Bottom line.** One quip: unblock stuck agents first, otherwise "nothing urgent" (with a count of fresh results when there are some).

**Gotchas.**
- Only sessions that loaded the beacon show up: `/reload` pi sessions and restart Claude Code sessions after installing. A Claude session appears after its next hook event.
- Claude Code entries have no PID, so a killed terminal can linger up to 12 hours.
- Pi `needs you` is best-effort (see Notes).

## Notes

- Claude Code entries have no PID, so they are removed on SessionEnd or after 12h without updates.
- Subagents: Claude Code `SubagentStart`/`SubagentStop` hooks write one `sub-<session>-<agent>.json` per running subagent (no write races between parallel ones). Orphan stops are ignored; entries with no stop expire after 1h; `SessionEnd` clears them. Pi has no built-in subagents, so each pi counts as one agent.
- States: `working`, `done` (finished its turn) and `needs you` (blocked on an approval or a question). Claude Code: `Stop` = done; `Notification` with `permission_prompt` or `elicitation_dialog` = needs you; `idle_prompt` = done; `PostToolUse` flips back to working. Pi: `agent_end` = done; `ui_prompt_start` (best effort, pi >= 0.85) = needs you, cleared by the next turn/tool event.
- Pi workers from subagent extensions run as child pi processes. When `PI_SUBAGENT_DEPTH > 0` the beacon records them as subagents of the parent pi (via parent pid) instead of separate agents.
- Pi events used: session_start, agent_start, agent_end, session_shutdown.
