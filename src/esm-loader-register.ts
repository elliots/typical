import { register } from "node:module";
register("./esm-loader.js", { parentURL: import.meta.url });
