import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setPumbleRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getPumbleRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Pumble runtime not initialized");
  }
  return runtime;
}
