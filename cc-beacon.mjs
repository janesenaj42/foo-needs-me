import { mkdirSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".pi", "status");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let e;
  try { e = JSON.parse(raw); } catch { return; }
  if (!e.session_id) return;
  const file = join(dir, `claude-${e.session_id}.json`);
  const ev = e.hook_event_name;
  // each subagent gets its own file, so parallel subagents never race on one file
  const subFile = e.agent_id ? join(dir, `sub-${e.session_id}-${e.agent_id}.json`) : null;
  if (ev === "SubagentStart" && subFile) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(subFile, JSON.stringify({ kind: "sub", session_id: e.session_id, agent_id: e.agent_id, agent_type: e.agent_type || "", since: Date.now(), updated: Date.now() }));
    } catch {}
    return;
  }
  if (ev === "SubagentStop") { if (subFile) { try { unlinkSync(subFile); } catch {} } return; } // orphan stops are harmless
  if (ev === "SessionEnd") {
    try { unlinkSync(file); } catch {}
    try {
      for (const f of readdirSync(dir)) if (f.startsWith(`sub-${e.session_id}-`)) { try { unlinkSync(join(dir, f)); } catch {} }
    } catch {}
    return;
  }
  let state, reason = "";
  switch (ev) {
    case "SessionStart":
    case "Stop":
      state = "idle"; // finished its turn
      break;
    case "UserPromptSubmit":
    case "PostToolUse": // also fires right after you approve a prompt
      state = "working";
      break;
    case "Notification": {
      const t = e.notification_type;
      if (t === "permission_prompt") { state = "blocked"; reason = "approve?"; }
      else if (t === "elicitation_dialog" || t === "elicitation_url_dialog") { state = "blocked"; reason = "has a question"; }
      else if (t === "idle_prompt") state = "idle";
      else if (!t) { state = /permission|approve/i.test(e.message || "") ? "blocked" : "idle"; reason = state === "blocked" ? "approve?" : ""; }
      else return; // auth_success etc: not a state change
      break;
    }
    default:
      return;
  }
  let since = Date.now();
  try {
    const prev = JSON.parse(readFileSync(file, "utf8"));
    if (prev.state === state && (prev.reason || "") === reason) since = prev.since;
  } catch {}
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ kind: "claude", id: e.session_id, cwd: e.cwd, state, reason, since, updated: Date.now() }));
  } catch {}
});
