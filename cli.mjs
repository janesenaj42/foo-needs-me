#!/usr/bin/env node
// foo-needs-me <command>
//   start [--window]   open the dashboard here (or in a new window on Windows)
//   install [flags]    install the beacons (same as install.mjs)
//   uninstall          remove everything install put in place
//   (no command)       install, as before
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const node = process.execPath;
const run = (script, args) => process.exit(spawnSync(node, [join(here, script), ...args], { stdio: "inherit" }).status ?? 1);

switch (cmd) {
  case "start": {
    const viewer = join(here, "dashboard.mjs");
    const args = rest.filter((a) => a !== "--window");
    if (rest.includes("--window") && process.platform === "win32") {
      spawn("cmd.exe", ["/d", "/c", `start "fooboard" "${node}" "${viewer}" ${args.join(" ")}`], {
        detached: true, stdio: "ignore", windowsVerbatimArguments: true,
      }).unref();
      console.log("fooboard opened in a new window");
    } else {
      run("dashboard.mjs", args);
    }
    break;
  }
  case "install": run("install.mjs", rest); break;
  case "uninstall": run("install.mjs", ["--uninstall", ...rest]); break;
  case "-h": case "--help": case "help":
    console.log("usage: foo-needs-me [start [--window] | install [--pi|--claude|--opencode] | uninstall]");
    break;
  default: run("install.mjs", cmd ? [cmd, ...rest] : []); // bare `foo-needs-me` and old flags (e.g. --uninstall) still install
}
