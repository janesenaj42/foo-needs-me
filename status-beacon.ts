import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".foo-needs-me", "status");
const viewer = join(homedir(), ".foo-needs-me", "pi-status.mjs");
// Pi subagent extensions run workers as child pi processes and set PI_SUBAGENT_DEPTH (>0 inside a worker).
const isSub = Number(process.env.PI_SUBAGENT_DEPTH || 0) > 0;
const file = join(dir, `${isSub ? "sub" : "pi"}-${process.pid}.json`);

type State = "idle" | "working" | "blocked"; // idle = finished its turn; blocked = needs your input
let state: State = "idle";
let reason = "";
let since = Date.now();

function write(next?: State, why = "") {
  if (next && (next !== state || why !== reason)) {
    state = next;
    reason = why;
    since = Date.now();
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ kind: "pi", pid: process.pid, cwd: process.cwd(), state, reason, since, updated: Date.now() }),
    );
  } catch {}
}

// workers are counted as subagents of the pi process that spawned them
function writeSub() {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        kind: "sub",
        pid: process.pid,
        parent_pid: process.ppid,
        agent_type: process.env.PI_SUBAGENT_NAME || "",
        since,
        updated: Date.now(),
      }),
    );
  } catch {}
}

function clear() {
  try {
    unlinkSync(file);
  } catch {}
}

export default function (pi: any) {
  process.on("exit", clear);
  pi.on("session_shutdown", () => clear());

  if (isSub) {
    pi.on("session_start", () => writeSub());
    pi.on("agent_start", () => writeSub());
    return;
  }

  pi.on("session_start", () => write("idle"));
  pi.on("agent_start", () => write("working"));
  // anything that happens after you answer a prompt means it is working again
  pi.on("turn_start", () => write("working"));
  pi.on("tool_execution_start", () => write("working"));
  pi.on("tool_execution_end", () => write("working"));
  pi.on("agent_end", (e: any) => {
    if (e?.willContinue !== true) write("idle");
  });
  // best effort: pi-notify documents this event for approvals and select/confirm/input dialogs (pi >= 0.85)
  try {
    pi.on("ui_prompt_start", () => write("blocked", "needs input"));
  } catch {}

  pi.registerCommand("fooboard", {
    description: "Open the foo-needs-me dashboard in a new window",
    handler: async (_args: string, ctx: any) => {
      if (process.platform !== "win32") {
        ctx.ui.notify(`Run: node ${viewer}`, "info");
        return;
      }
      try {
        spawn("cmd.exe", ["/d", "/c", `start "sessions" node "${viewer}"`], {
          detached: true,
          stdio: "ignore",
          windowsVerbatimArguments: true,
        }).unref();
      } catch (err: any) {
        ctx.ui.notify(`Could not open dashboard: ${err?.message ?? err}`, "error");
      }
    },
  });
}
