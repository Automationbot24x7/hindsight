// Start the server from the project folder regardless of the caller's working directory.
import { fileURLToPath } from "node:url";
import path from "node:path";
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
await import("../server/index.js");
