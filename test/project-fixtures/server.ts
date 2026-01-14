import { Config } from "./shared.js";

export function startServer(config: Config): string {
  return config.host + ":" + config.port;
}
