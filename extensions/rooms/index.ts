import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { roomsPlugin } from "./src/channel.js";
import { setRoomsRuntime } from "./src/runtime.js";

const plugin = {
  id: "rooms",
  name: "Rooms",
  description: "Rooms channel plugin for AI agent chat platform integration",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRoomsRuntime(api.runtime);
    api.registerChannel({ plugin: roomsPlugin as ChannelPlugin });
  },
};

export default plugin;