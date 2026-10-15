import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-dual-dev/**",
    ".next-dual-production/**",
    ".next-sentences-production/**",
    ".next-particle-production/**",
    ".next-confirmation-production/**",
    ".next-video-batch-build/**",
    ".next-spatial/**",
    ".next-spatial-build/**",
    ".next-reference-audio-dev/**",
    ".next-reference-audio-build/**",
    ".next-reference-audio-production/**",
    ".next-project-planner-repair-production/**",
    ".next-reference-asr-repair-production/**",
    ".next-semantic-build/**",
    ".next-batch-build/**",
    ".next-batch-production/**",
    ".next-storyboard-production/**",
    ".next-h3-storyboard-production/**",
    ".next-clip-storyboard-production/**",
    ".next-concise-h3-production/**",
    ".next-batch-generation-production/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
