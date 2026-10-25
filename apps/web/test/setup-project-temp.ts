import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This module runs only inside Vitest workers. Application/service environments
// remain unchanged; test children inherit the same project-owned scratch root.
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const defaultRoot = process.platform === "win32" && existsSync("I:/")
  ? "I:/AI/asmr_director/qa/test-temp"
  : path.join(projectRoot, ".local", "tmp", "tests");
const testRoot = path.resolve(process.env.ASMR_TEST_TEMP_ROOT || defaultRoot);
mkdirSync(testRoot, { recursive: true });
for (const name of ["TEMP", "TMP", "TMPDIR"]) process.env[name] = testRoot;
