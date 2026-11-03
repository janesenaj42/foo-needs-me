# foo-needs-me

Foo needs me? Who needs me? A tiny terminal dashboard that shows which of your AI coding agent sessions are waiting on you. No tmux needed, works on native Windows.

![dashboard](docs/dashboard.png)

## Install

```
npx github:janesenaj42/foo-needs-me              # installs for the tools it finds; safe to re-run
npx github:janesenaj42/foo-needs-me --uninstall  # removes everything it installed
```

Or from a clone:

```
git clone https://github.com/janesenaj42/foo-needs-me
cd foo-needs-me
node install.mjs              # same flags as above
```

Node 18+. Force a single tool with `--pi`, `--claude` or `--opencode`.

Scripts and status files live in `~/.foo-needs-me/`. The installer copies each beacon to the tool's config folder and, for Claude Code, merges hooks into `~/.claude/settings.json` (backup saved first).

Then open the dashboard in any spare terminal:

```
node ~/.foo-needs-me/dashboard.mjs
```

Or type `/fooboard` in pi or Claude Code to open it in a new window. Restart running sessions (`/reload` in pi) so they load the beacon.

## How it works

Each tool has a small beacon that writes one JSON file per session to `~/.foo-needs-me/status/`. The viewer reads that folder and renders it. The two sides only share the file format, so the viewer works the same for every tool.

| File | Role |
|---|---|
| `pi-beacon.ts` | pi extension; adds `/fooboard` |
| `claude-beacon.mjs` | Claude Code hook script |
| `opencode-beacon.ts` | opencode plugin |
| `dashboard.mjs` | the viewer (`--once` prints one frame, `--once --tick=N` a specific animation frame) |
| `fooboard.mjs` | launcher that opens the viewer in a new window |
| `install.mjs` | installer / uninstaller |

### Events

| Tool | Hooks into | Mapping |
|---|---|---|
| Claude Code | `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`, `SubagentStart`, `SubagentStop` | `Stop` and `idle_prompt` = done; `permission_prompt` and `elicitation_dialog` = needs you; `PostToolUse` = working again |
| pi | `session_start`, `agent_start`, `agent_end`, `session_shutdown`, `ui_prompt_start` (pi >= 0.85) | `agent_end` = done; `ui_prompt_start` = needs you, cleared by the next turn or tool event |
| opencode | `session.status`, `session.idle`, `permission.asked`, `permission.replied` | idle = done; permission asked = needs you |

Subagents:
- Claude Code writes one `sub-<session>-<agent>.json` per running subagent, so parallel ones never race. `SessionEnd` clears them; orphans expire after 1h.
- pi workers started with `PI_SUBAGENT_DEPTH > 0` are recorded as subagents of the parent pi via its pid.

Claude Code entries have no pid, so they are removed on `SessionEnd` or after 12h without updates.

## Status file format

Write `~/.foo-needs-me/status/<anything>.json` whenever a session changes state, and delete it when the session ends:

```json
{ "kind": "codex", "id": "session-1", "cwd": "/path/to/project", "state": "idle", "reason": "", "since": 1761820000000, "updated": 1761820000000 }
```

| Field | Meaning |
|---|---|
| `kind` | tool name shown in the tool column (`claude` orange, `pi` purple, anything else blue) |
| `state` | `working`, `idle` (finished its turn) or `blocked` (needs you; put a short note like `approve?` in `reason`) |
| `since` | when it entered this state (ms since epoch) |
| `updated` | last write (ms since epoch) |
| `pid` | optional; the entry disappears when that process dies. Without it, an entry is dropped after 12h without an update |

Subagents: `{ "kind": "sub", "session_id": "<id of the parent>" }`, or `"parent_pid"` for pid-based parents, with the same `updated` and `pid` rules.

Any tool that can run a script on its events can report in this way. PowerShell example:

```powershell
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
@{ kind="codex"; id="s1"; cwd=(Get-Location).Path; state="idle"; since=$now; updated=$now } |
  ConvertTo-Json | Set-Content "$env:USERPROFILE\.foo-needs-me\status\codex-s1.json"
```

## Reading the dashboard

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

Only **needs you** is urgent. A finished session fades as you move on, so a pile of done sessions never looks like a to-do list.

Rows are sorted: needs you, done (newest first), working, parked.

| Face | State |
|---|---|
| `(!_!)` | needs you: `approve?` = permission prompt, `has a question` / `needs input` = a question or dialog |
| `\(^o^)/` | done, under 2 min |
| `(^_^)` | done, 2 min to 1 hour |
| `(-.-)zZ` | parked (dim): done more than 1 hour ago |
| `(-_-) /` | working (the `/` is a spinner) |

Keys: `p` shows or hides parked rows, `q` quits. Set the parking time with `PI_STATUS_PARK_MIN` (minutes, default 60).

Only sessions that loaded a beacon show up. A Claude Code session appears after its next hook event.

## License

MIT, see [LICENSE](LICENSE).
