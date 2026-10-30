// Usage: node install.mjs            install
//        node install.mjs --uninstall remove
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const uninstall = process.argv.includes("--uninstall");

const targets = [
  ["status-beacon.ts", join(home, ".pi", "agent", "extensions", "status-beacon.ts")],
  ["pi-status.mjs", join(home, ".pi", "pi-status.mjs")],
  ["cc-beacon.mjs", join(home, ".pi", "cc-beacon.mjs")],
  ["fooboard.mjs", join(home, ".pi", "fooboard.mjs")],
];
const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Notification", "Stop", "SessionEnd", "SubagentStart", "SubagentStop"];
const settingsPath = join(home, ".claude", "settings.json");
const hookCmd = `node ${join(home, ".pi", "cc-beacon.mjs").replace(/\\/g, "/")}`;
// Claude Code custom command: /fooboard (absolute path baked in, so it works from any shell)
const cmdFile = join(home, ".claude", "commands", "fooboard.md");
const launcher = join(home, ".pi", "fooboard.mjs").replace(/\\/g, "/");
const cmdBody = `---
description: Open the foo-needs-me dashboard in a new window
allowed-tools: Bash(node:*)
---
!\`node "${launcher}"\`

Reply with one short line: say the dashboard opened, or relay the message printed above if it could not open a window.
`;
const isOurs = (h) => typeof h?.command === "string" && h.command.includes("cc-beacon.mjs");

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

if (uninstall) {
  for (const [, dest] of targets) { try { unlinkSync(dest); console.log("removed", dest); } catch {} }
  try {
    if (readFileSync(cmdFile, "utf8").includes("foo-needs-me")) { unlinkSync(cmdFile); console.log("removed", cmdFile); }
  } catch {}
  const s = loadSettings();
  if (s?.hooks) {
    for (const ev of EVENTS) {
      if (!Array.isArray(s.hooks[ev])) continue;
      s.hooks[ev] = s.hooks[ev]
        .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
        .filter((g) => g.hooks.length);
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
    saveSettings(s);
    console.log("removed Claude Code hooks");
  }
  process.exit(0);
}

for (const [src, dest] of targets) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(here, src), dest);
  console.log("installed", dest);
}

mkdirSync(dirname(cmdFile), { recursive: true });
writeFileSync(cmdFile, cmdBody);
console.log("installed", cmdFile);

const s = loadSettings() ?? {};
s.hooks ??= {};
let added = 0;
for (const ev of EVENTS) {
  s.hooks[ev] ??= [];
  const present = s.hooks[ev].some((g) => (g.hooks || []).some(isOurs));
  if (!present) { s.hooks[ev].push({ hooks: [{ type: "command", command: hookCmd }] }); added++; }
}
if (added) { saveSettings(s); console.log(`added ${added} Claude Code hook(s) to ${settingsPath} (backup saved)`); }
else console.log("Claude Code hooks already present");

console.log(`
Done. Next:
  pi:          /reload in each pi session (or restart it), then type /fooboard
  Claude Code: restart running sessions (hooks load at startup), then type /fooboard
  either way:  node ${join(home, ".pi", "pi-status.mjs")}   in any spare terminal`);
