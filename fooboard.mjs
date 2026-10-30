// Opens the foo-needs-me dashboard in a new terminal window. Used by the Claude Code /fooboard command.
// (In pi, the /fooboard command does the same thing from inside the extension.)
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const viewer = join(homedir(), ".pi", "pi-status.mjs");

if (process.platform === "win32") {
  spawn("cmd.exe", ["/d", "/c", `start "fooboard" node "${viewer}"`], {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: true,
  }).unref();
  console.log("fooboard opened in a new window");
} else {
  console.log(`No auto-open on this OS. Run this in another terminal: node ${viewer}`);
}
