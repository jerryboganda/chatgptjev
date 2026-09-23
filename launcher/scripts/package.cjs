const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const launcherManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const executable = "node";
const electronBuilderCli = require.resolve("electron-builder/out/cli/cli.js", { paths: [root] });
const requested = process.argv[2];
const target = requested || "--win";
if (target !== "--win") {
  throw new Error(`Unsupported packaging target: ${requested || process.platform}. This fork packages Windows only.`);
}
const nativeTarget = process.platform === "win32" ? "--win" : null;
if (target !== nativeTarget) {
  throw new Error(
    `Cross-packaging ${target} from ${process.platform}/${process.arch} is disabled because the launcher embeds a native Bun runtime. `
    + "Build the Windows target on Windows.",
  );
}

const env = { ...process.env };
if (!env.CSC_LINK && !env.CSC_NAME) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
const builderArgs = [
  electronBuilderCli,
  target,
  "--publish",
  "never",
];

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-jev-package-"));
const artifactsDirectory = path.join(root, "artifacts");

try {
  const result = spawnSync(executable, [
    ...builderArgs,
    `--config.directories.output=${staging}`,
  ], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  fs.mkdirSync(artifactsDirectory, { recursive: true });
  for (const entry of fs.readdirSync(artifactsDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:exe|zip|blockmap)$/i.test(entry.name)) {
      fs.rmSync(path.join(artifactsDirectory, entry.name), { force: true });
    }
  }
  const artifacts = fs.readdirSync(staging, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:exe|zip|blockmap)$/i.test(entry.name));
  if (!artifacts.some((entry) => /\.(?:exe|zip)$/i.test(entry.name))) {
    throw new Error(`electron-builder produced no distributable artifact in ${staging}`);
  }
  for (const artifact of artifacts) {
    fs.copyFileSync(path.join(staging, artifact.name), path.join(artifactsDirectory, artifact.name));
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
