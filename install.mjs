// Usage:
//   node install.mjs                 install for the tools it finds (pi, Claude Code); safe to re-run
//   node install.mjs --pi            only pi
//   node install.mjs --claude        only Claude Code
//   node install.mjs --opencode      only opencode (experimental)
//   node install.mjs --uninstall     remove everything it installed
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const base = join(home, ".foo-needs-me"); // scripts + status files live here, whatever tools you use
const args = new Set(process.argv.slice(2));
const uninstall = args.has("--uninstall");

const hasCmd = (c) => {
  try { return spawnSync(process.platform === "win32" ? "where" : "which", [c], { stdio: "ignore" }).status === 0; }
  catch { return false; }
};
const only = ["--pi", "--claude", "--opencode"].some((f) => args.has(f)); // an explicit flag means "just those"
const wantPi = args.has("--pi") || (!only && (hasCmd("pi") || existsSync(join(home, ".pi", "agent", "settings.json"))));
const wantClaude = args.has("--claude") || (!only && (hasCmd("claude") || existsSync(join(home, ".claude"))));
const wantOpencode = args.has("--opencode") || (!only && (hasCmd("opencode") || existsSync(join(home, ".config", "opencode"))));

const piExt = join(home, ".pi", "agent", "extensions", "foo-needs-me.ts");
const ocPlugin = join(home, ".config", "opencode", "plugins", "foo-needs-me.ts");
const cmdFile = join(home, ".claude", "commands", "fooboard.md");
const settingsPath = join(home, ".claude", "settings.json");
const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Notification", "Stop", "SessionEnd", "SubagentStart", "SubagentStop"];
const beaconPath = join(base, "cc-beacon.mjs").replace(/\\/g, "/");
const hookCmd = `node ${beaconPath}`;
const launcher = join(base, "fooboard.mjs").replace(/\\/g, "/");
const cmdBody = `---
description: Open the foo-needs-me dashboard in a new window
allowed-tools: Bash(node:*)
---
!\`node "${launcher}"\`

Reply with one short line: say the dashboard opened, or relay the message printed above if it could not open a window.
`;
const isOurs = (h) => typeof h?.command === "string" && h.command.includes("cc-beacon.mjs");

// files from the first version of this project, which lived under ~/.pi
const legacy = [
  join(home, ".pi", "pi-status.mjs"),
  join(home, ".pi", "cc-beacon.mjs"),
  join(home, ".pi", "fooboard.mjs"),
  join(home, ".pi", "agent", "extensions", "status-beacon.ts"),
];

function loadSettings() {
  if (!existsSync(settingsPath)) return null;
  try { return JSON.parse(readFileSync(settingsPath, "utf8")); }
  catch { console.error(`! ${settingsPath} is not valid JSON; not touching it. Add the hooks manually.`); process.exit(1); }
}
function saveSettings(s) {
  if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.bak-${Date.now()}`);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(s, null, 2) + "\n");
}
function stripOurHooks(s) {
  if (!s?.hooks) return false;
  let changed = false;
  for (const ev of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    const before = JSON.stringify(s.hooks[ev]);
    s.hooks[ev] = s.hooks[ev]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
    if (JSON.stringify(s.hooks[ev] ?? []) !== before) changed = true;
  }
  return changed;
}
const rm = (p) => { if (existsSync(p)) { try { unlinkSync(p); console.log("removed", p); } catch {} } };

if (uninstall) {
  for (const p of [piExt, ocPlugin, ...legacy]) rm(p);
  try { if (readFileSync(cmdFile, "utf8").includes("foo-needs-me")) rm(cmdFile); } catch {}
  if (existsSync(base)) { rmSync(base, { recursive: true, force: true }); console.log("removed", base); }
  const s = loadSettings();
  if (s && stripOurHooks(s)) { saveSettings(s); console.log("removed Claude Code hooks"); }
  process.exit(0);
}

// shared: viewer + launcher
mkdirSync(base, { recursive: true });
for (const f of ["pi-status.mjs", "fooboard.mjs"]) { copyFileSync(join(here, f), join(base, f)); console.log("installed", join(base, f)); }
for (const p of legacy) rm(p); // migrate from the old ~/.pi layout

if (wantPi) {
  mkdirSync(dirname(piExt), { recursive: true });
  copyFileSync(join(here, "status-beacon.ts"), piExt);
  console.log("installed", piExt);
}

if (wantOpencode) {
  mkdirSync(dirname(ocPlugin), { recursive: true });
  copyFileSync(join(here, "opencode-beacon.ts"), ocPlugin);
  console.log("installed", ocPlugin);
}

if (wantClaude) {
  copyFileSync(join(here, "cc-beacon.mjs"), join(base, "cc-beacon.mjs"));
  console.log("installed", join(base, "cc-beacon.mjs"));
  mkdirSync(dirname(cmdFile), { recursive: true });
  writeFileSync(cmdFile, cmdBody);
  console.log("installed", cmdFile);
  const s = loadSettings() ?? {};
  s.hooks ??= {};
  stripOurHooks(s); // drops old-path hooks too, so re-running always leaves exactly one copy
  for (const ev of EVENTS) (s.hooks[ev] ??= []).push({ hooks: [{ type: "command", command: hookCmd }] });
  saveSettings(s);
  console.log(`set ${EVENTS.length} Claude Code hooks in ${settingsPath} (backup saved)`);
}

console.log(`\nInstalled for: ${[wantPi && "pi", wantClaude && "Claude Code", wantOpencode && "opencode"].filter(Boolean).join(" + ") || "nothing yet (no tool found)"}`);
if (!wantPi && !wantClaude && !wantOpencode) console.log("No pi, Claude Code or opencode found. Re-run with --pi, --claude or --opencode to force one.");
console.log(`Next:
${wantPi ? "  pi:          /reload in each pi session (or restart it), then type /fooboard\n" : ""}${wantClaude ? "  Claude Code: restart running sessions (hooks load at startup), then type /fooboard\n" : ""}${wantOpencode ? "  opencode:    restart opencode (plugins load at startup); no slash command, use the line below\n" : ""}  either way:  node ${join(base, "pi-status.mjs")}   in any spare terminal`);
