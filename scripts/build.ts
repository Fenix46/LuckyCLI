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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(root, "packages/cli/src/index.tsx");
const outDir = join(root, "dist-bin");
const stub = join(here, "stubs/react-devtools-core.js");
const googleOAuthClientId = process.env.LUCKY_GOOGLE_OAUTH_CLIENT_ID || "__unset__";
const googleOAuthClientSecret = process.env.LUCKY_GOOGLE_OAUTH_CLIENT_SECRET || "__unset__";

// Bun cross-compilation targets -> output file name.
const TARGETS: Record<string, string> = {
  "darwin-arm64": "lucky-darwin-arm64",
  "darwin-x64": "lucky-darwin-x64",
  "linux-x64": "lucky-linux-x64",
  "linux-arm64": "lucky-linux-arm64",
  "windows-x64": "lucky-windows-x64.exe",
};

// Replace the optional dev-only `react-devtools-core` import with an empty stub.
const stubDevtools: Bun.BuildConfig["plugins"] = [
  {
    name: "stub-react-devtools-core",
    setup(build) {
      build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: stub }));
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
    plugins: stubDevtools,
    define: {
      __LUCKY_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleOAuthClientId),
      __LUCKY_GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(googleOAuthClientSecret),
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
