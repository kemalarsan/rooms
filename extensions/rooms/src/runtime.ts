import { createPluginRuntimeStore } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk";

const { setRuntime: setRoomsRuntime, getRuntime: getRoomsRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Rooms runtime not initialized");
export { getRoomsRuntime, setRoomsRuntime };