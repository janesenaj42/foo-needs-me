import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const dir = join(homedir(), ".pi", "status");
const STALE_MS = 12 * 3600 * 1000; // claude entries (no pid) expire after 12h without updates
const SUB_TTL_MS = 3600 * 1000;    // subagent entries that never got a SubagentStop expire after 1h
const PARK_MS = Number(process.env.PI_STATUS_PARK_MIN || 60) * 60000; // done for longer than this = "parked" (you moved on)
let hideParked = false; // press p to toggle
const ONCE = process.argv.includes("--once"); // print a single frame and exit
const TICK_ARG = process.argv.find((a) => a.startsWith("--tick="));

const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const parked = (r, now = Date.now()) => r.state === "idle" && now - r.since > PARK_MS;
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m` : m ? `${m}m${s % 60}s` : `${s}s`;
};
const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

let rows = [];
let subs = [];
// claude subagents link by session id; pi workers link by parent pid (nested workers roll up to the root pi)
function rootPid(sub) {
  let pp = sub.parent_pid;
  for (let i = 0; i < 10; i++) {
    const up = subs.find((x) => x.pid === pp);
    if (!up) break;
    pp = up.parent_pid;
  }
  return pp;
}
const subsOf = (r) =>
  r.kind === "claude"
    ? subs.filter((x) => x.session_id === r.id)
    : subs.filter((x) => x.pid && rootPid(x) === r.pid);

function load() {
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch {}
  const out = [], subOut = [];
  const now = Date.now();
  for (const f of files) {
    const p = join(dir, f);
    try {
      const r = JSON.parse(readFileSync(p, "utf8"));
      if (r.kind === "sub") {
        const dead = r.pid ? !alive(r.pid) : now - r.updated > SUB_TTL_MS;
        if (dead) { try { unlinkSync(p); } catch {} } else subOut.push(r);
        continue;
      }
      const dead = r.pid ? !alive(r.pid) : now - r.updated > STALE_MS;
      if (dead) { try { unlinkSync(p); } catch {} continue; }
      out.push(r);
    } catch {}
  }
  // needs you, then freshly done (newest first), then working, then parked (done long ago, you moved on)
  const rank = (r) => (r.state === "blocked" ? 0 : r.state === "working" ? 2 : parked(r, now) ? 3 : 1);
  out.sort((a, b) => (rank(a) !== rank(b) ? rank(a) - rank(b) : rank(a) === 1 ? b.since - a.since : a.since - b.since));
  rows = out;
  subs = subOut;
}

const SPIN = ["|", "/", "-", "\\"];

// only "needs you" is urgent. done is calm, and fades to "parked" once you've clearly moved on.
function mood(r, waitedMs, tick) {
  if (r.state === "blocked") {
    return { face: Math.floor(tick / 2) % 2 ? "(!_!)" : "(!o!)", note: r.reason || "needs you", col: "1;33" };
  }
  if (r.state !== "idle") {
    return { face: "(-_-) " + SPIN[Math.floor(tick / 2) % 4], note: "busy", col: "36" };
  }
  if (waitedMs > PARK_MS) return { face: "(-.-)zZ", note: "parked", col: "2" };
  if (waitedMs > 2 * 60000) return { face: "(^_^)", note: "done", col: "32" };
  return { face: "\\(^o^)/", note: "just finished!", col: "1;32" };
}

function quip(blocked, fresh, total) {
  if (!total) return "nobody's home. enjoy it.";
  if (blocked) return blocked === 1 ? "one is stuck on you. unblock it first." : `${blocked} are stuck on you. unblock them first.`;
  if (fresh) return fresh === 1 ? "nothing urgent. one fresh result when you're free." : `nothing urgent. ${fresh} fresh results when you're free.`;
  return "nothing urgent. carry on.";
}

function frame(tick) {
  const now = Date.now();
  const blocked = rows.filter((r) => r.state === "blocked").length;
  const parkedN = rows.filter((r) => parked(r, now)).length;
  const fresh = rows.filter((r) => r.state === "idle").length - parkedN;
  const working = rows.length - blocked - fresh - parkedN;
  const barW = 24;
  const seg = (n) => (rows.length ? Math.round((n / rows.length) * barW) : 0);
  const bFill = seg(blocked); // the bar is only about what needs a response; done/parked stay out of it
  const bar = c("1;33", "#".repeat(bFill)) + c("2;36", ".".repeat(barW - bFill));
  const urgent = blocked ? c("1;33", `${blocked} need you`) : c("32", "nothing urgent");

  const L = [];
  L.push("  " + c("1;35", "~ who needs me? foo needs me. ~"));
  L.push("");
  L.push(
    `  agents ${c("1", rows.length)}   ${c("1;33", "needs you " + blocked)}   ${c("32", "done " + fresh)}   ${c("36", "working " + working)}   ${c("2", "parked " + parkedN)}   subagents ${c("1", subs.length)}`,
  );
  L.push(`  [${bar}] ${urgent}`);
  L.push("");
  for (const r of rows) {
    if (hideParked && parked(r, now)) continue;
    const waited = now - r.since;
    const m = mood(r, waited, tick);
    const tool = r.kind === "claude" ? c("38;5;208", pad("claude", 7)) : c("35", pad("pi", 7));
    const n = subsOf(r).length;
    const line =
      c(m.col, pad(m.face, 8)) + " " + pad(basename(r.cwd) || r.cwd, 22) + " " + tool + " " +
      pad(fmt(waited), 7) + c(m.col === "36" ? "2" : m.col, pad(m.note, 20)) + (n ? c("33", `+${n} sub`) : "");
    L.push("  " + (m.col === "2" ? c("2", line.replace(/\x1b\[[0-9;]*m/g, "")) : line)); // parked rows fade out
  }
  if (hideParked && parkedN) L.push("  " + c("2", `(${parkedN} parked hidden)`));
  L.push("");
  L.push("  " + c("2", quip(blocked, fresh, rows.length)));
  L.push(c("2", "  q quit   p show/hide parked"));
  return L;
}

function draw(tick) {
  process.stdout.write("\x1b[H" + frame(tick).map((l) => l + "\x1b[K").join("\n") + "\n\x1b[J");
}

load();
if (ONCE) {
  if (process.argv.includes("--hide-parked")) hideParked = true;
  console.log(frame(TICK_ARG ? Number(TICK_ARG.slice(7)) : 0).join("\n"));
  process.exit(0);
}

const quit = () => { process.stdout.write("\x1b[?25h\x1b[?1049l"); process.exit(0); };
process.stdout.write("\x1b[?1049h\x1b[?25l");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on("data", (d) => {
    const k = String(d);
    if (k === "q" || k === "\x03") quit();
    if (k === "p") hideParked = !hideParked;
  });
}
process.on("SIGINT", quit);
let tick = 0;
draw(tick);
setInterval(() => {
  tick++;
  if (tick % 4 === 0) load(); // re-read status files 1x/s
  draw(tick);                 // redraw 4x/s (spinner)
}, 250);
