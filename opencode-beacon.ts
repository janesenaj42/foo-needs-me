// foo-needs-me plugin for opencode (experimental: written from opencode's documented plugin events, not yet run against a real opencode).
// Install: copy to ~/.config/opencode/plugins/foo-needs-me.ts (the installer does this), then restart opencode.
import { mkdirSync, writeFileSync, unlinkSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".foo-needs-me", "status");
const fileOf = (id: string, sub: boolean) => join(dir, `${sub ? "sub-opencode" : "opencode"}-${id}.json`);

type State = "idle" | "working" | "blocked";
type Entry = { state: State; reason: string; since: number; parent?: string };
const sessions = new Map<string, Entry>();

export const FooNeedsMe = async ({ directory }: any) => {
  const cwd = directory || process.cwd();

  function flush(id: string) {
    const e = sessions.get(id);
    if (!e) return;
    try {
      mkdirSync(dir, { recursive: true });
      const body = e.parent
        ? { kind: "sub", pid: process.pid, session_id: e.parent, since: e.since, updated: Date.now() }
        : { kind: "opencode", id, pid: process.pid, cwd, state: e.state, reason: e.reason, since: e.since, updated: Date.now() };
      writeFileSync(fileOf(id, !!e.parent), JSON.stringify(body));
    } catch {}
  }
  function set(id: string | undefined, state: State, reason = "", parent?: string) {
    if (!id) return;
    const prev = sessions.get(id);
    const changed = !prev || prev.state !== state || prev.reason !== reason;
    sessions.set(id, { state, reason, since: changed ? Date.now() : prev!.since, parent: parent ?? prev?.parent });
    flush(id);
  }
  function drop(id: string | undefined) {
    if (!id) return;
    const e = sessions.get(id);
    sessions.delete(id);
    try { unlinkSync(fileOf(id, !!e?.parent)); } catch {}
  }
  process.on("exit", () => { for (const id of [...sessions.keys()]) drop(id); });

  return {
    event: async ({ event }: any) => {
      const p = event?.properties ?? {};
      switch (event?.type) {
        case "session.created":
        case "session.updated": {
          const id = p.info?.id ?? p.sessionID;
          if (id && !sessions.has(id)) set(id, "idle", "", p.info?.parentID || undefined);
          break;
        }
        case "session.deleted":
          drop(p.info?.id ?? p.sessionID);
          break;
        case "session.status": {
          const t = p.status?.type;
          if (t === "idle") set(p.sessionID, "idle");
          else if (t === "busy" || t === "retry") set(p.sessionID, "working");
          break;
        }
        case "session.idle":
          set(p.sessionID, "idle");
          break;
        case "permission.asked":
        case "permission.updated":
          set(p.sessionID, "blocked", "approve?");
          break;
        case "permission.replied":
          set(p.sessionID, "working");
          break;
      }
    },
  };
};
