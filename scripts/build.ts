/**
 * Builds standalone `lucky` binaries for every supported platform using Bun.
 *
 * Run with:  bun run scripts/build.ts            (all targets)
 *            bun run scripts/build.ts darwin-arm64   (a single target)
 *
 * Output goes to ./dist-bin/lucky-<target>[.exe]
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(root, "packages/cli/src/index.tsx");
// Baked into the binary so the compiled CLI never reads package.json off disk
// (there is none inside the single-file bundle — $bunfs has no package.json).
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const outDir = join(root, "dist-bin");
const stub = join(here, "stubs/react-devtools-core.js");
// Bun-only wasm-asset module: embeds the tree-sitter grammars into the binary.
const wasmAssetsBun = join(root, "packages/core/src/graph/extract/wasm-assets.bun.ts");
const googleOAuthClientId = process.env.LUCKY_GOOGLE_OAUTH_CLIENT_ID || "__unset__";
const googleOAuthClientSecret = process.env.LUCKY_GOOGLE_OAUTH_CLIENT_SECRET || "__unset__";
const antigravityOAuthClientId = process.env.LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID || "__unset__";
const antigravityOAuthClientSecret = process.env.LUCKY_ANTIGRAVITY_OAUTH_CLIENT_SECRET || "__unset__";

// Bun cross-compilation targets -> output file name.
const TARGETS: Record<string, string> = {
  "darwin-arm64": "lucky-darwin-arm64",
  "darwin-x64": "lucky-darwin-x64",
  "linux-x64": "lucky-linux-x64",
  "linux-arm64": "lucky-linux-arm64",
  "windows-x64": "lucky-windows-x64.exe",
};

const plugins: Bun.BuildConfig["plugins"] = [
  // Replace the optional dev-only `react-devtools-core` import with an empty stub.
  {
    name: "stub-react-devtools-core",
    setup(build) {
      build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: stub }));
    },
  },
  // Swap the Node wasm-asset resolver for the Bun variant that embeds the
  // grammars into the binary (the compiled dist imports "./wasm-assets.js").
  {
    name: "embed-tree-sitter-wasm",
    setup(build) {
      build.onResolve({ filter: /wasm-assets\.js$/ }, () => ({ path: wasmAssetsBun }));
    },
  },
];

const requested = process.argv.slice(2);
const selected = requested.length
  ? requested
  : Object.keys(TARGETS);

for (const name of selected) {
  const outfile = TARGETS[name];
  if (!outfile) {
    console.error(`unknown target "${name}". valid: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  console.log(`→ building ${name} ...`);
  const result = await Bun.build({
    entrypoints: [entry],
    plugins,
    define: {
      __LUCKY_VERSION__: JSON.stringify(version),
      __LUCKY_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleOAuthClientId),
      __LUCKY_GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(googleOAuthClientSecret),
      __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID__: JSON.stringify(antigravityOAuthClientId),
      __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_SECRET__: JSON.stringify(antigravityOAuthClientSecret),
    },
    compile: { target: `bun-${name}`, outfile: join(outDir, outfile) },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`  ✓ dist-bin/${outfile}`);
}

console.log("done.");
