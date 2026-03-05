import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { pumblePlugin } from "./src/channel.js";
import { setPumbleRuntime } from "./src/runtime.js";
import { registerPumbleSubagentHooks } from "./src/subagent-hooks.js";

const plugin = {
  id: "pumble",
  name: "Pumble",
  description: "Pumble channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setPumbleRuntime(api.runtime);
    api.registerChannel({ plugin: pumblePlugin });
    registerPumbleSubagentHooks(api);
  },
};

export default plugin;
