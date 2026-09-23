const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcherRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(launcherRoot, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(launcherRoot, "package.json"), "utf8"));
const repositoryManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));

test("the public launcher command uses the Electron bootstrap", () => {
  assert.equal(repositoryManifest.scripts.launcher, "bun run scripts/start-launcher.ts");
  assert.equal(repositoryManifest.scripts.launcher, repositoryManifest.scripts.app);
});

test("the full verification gate audits launcher dependencies", () => {
  const verify = fs.readFileSync(path.join(repositoryRoot, "scripts", "verify.ts"), "utf8");
  assert.equal(manifest.scripts.audit, "bun audit");
  assert.equal(repositoryManifest.scripts["launcher:audit"], "bun run --cwd launcher audit");
  assert.match(verify, /await run\(\["run", "launcher:audit"\]\);/);
});

test("launcher publishes a native Windows package", () => {
  assert.equal(manifest.build.appId, "dev.chatgptjev.launcher");
  assert.equal(manifest.build.artifactName, "chatgpt-jev-${version}-${os}-${arch}.${ext}");
  assert.deepEqual(manifest.build.win.target, ["nsis"]);
  assert.equal(manifest.build.win.icon, "assets/icon.ico");
  assert.ok(manifest.build.files.includes("assets/icon.png"));
  assert.equal(manifest.build.asarUnpack, undefined);
  assert.equal(manifest.build.afterPack, undefined);
  assert.ok(fs.existsSync(path.join(launcherRoot, "assets", "icon.ico")));
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.nsis.allowElevation, false);
  assert.equal(manifest.build.nsis.runAfterFinish, true);
  assert.match(manifest.build.nsis.guid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
});

test("release installer resolves the checksummed native launcher asset", () => {
  const windowsInstaller = fs.readFileSync(path.join(repositoryRoot, "scripts", "install-launcher.ps1"), "utf8");
  const devProfile = fs.readFileSync(path.join(repositoryRoot, "src", "dev-chat", "profile.ts"), "utf8");
  const packager = fs.readFileSync(path.join(launcherRoot, "scripts", "package.cjs"), "utf8");
  assert.match(packager, /const executable = "node"/);
  assert.doesNotMatch(packager, /process\.execPath/);
  assert.match(packager, /electron-builder\/out\/cli\/cli\.js/);
  assert.doesNotMatch(packager, /--config\.(mac|linux)\./);
  assert.doesNotMatch(packager, /electron-builder\.cmd/);
  assert.match(windowsInstaller, /chatgpt-jev-\$Version-win-\$Arch\.exe/);
  assert.match(windowsInstaller, /\[Environment\]::Is64BitOperatingSystem/);
  assert.doesNotMatch(windowsInstaller, /RuntimeInformation/);
  assert.match(windowsInstaller, /function Test-IsFullyQualifiedWindowsPath/);
  assert.match(windowsInstaller, /Test-IsFullyQualifiedWindowsPath \$InstallLocation/);
  assert.doesNotMatch(windowsInstaller, /IsPathFullyQualified/);
  const windowsPathPattern = windowsInstaller.match(/return \$Path -match '([^']+)'/)?.[1];
  assert.ok(windowsPathPattern, "the Windows installer must expose its absolute-path contract");
  const fullyQualifiedWindowsPath = new RegExp(windowsPathPattern);
  assert.equal(fullyQualifiedWindowsPath.test("C:\\Users\\tester\\ChatGPT Jev"), true);
  assert.equal(fullyQualifiedWindowsPath.test("\\\\server\\share\\ChatGPT Jev"), true);
  assert.equal(fullyQualifiedWindowsPath.test("C:ChatGPT Jev"), false);
  assert.equal(fullyQualifiedWindowsPath.test("\\ChatGPT Jev"), false);
  assert.equal(fullyQualifiedWindowsPath.test("ChatGPT Jev"), false);
  assert.ok(windowsInstaller.includes(`HKCU:\\Software\\${manifest.build.nsis.guid}`));
  assert.ok(devProfile.includes(`WINDOWS_LAUNCHER_GUID = "${manifest.build.nsis.guid}"`));
  assert.match(windowsInstaller, /Get-ItemPropertyValue[\s\S]*InstallLocation/);
  assert.ok(windowsInstaller.includes(`Join-Path $InstallLocation "${manifest.build.productName}.exe"`));
  assert.match(windowsInstaller, /-ArgumentList "\/S", "\/currentuser"/);
  const packageSmoke = fs.readFileSync(path.join(launcherRoot, "scripts", "smoke-package.cjs"), "utf8");
  assert.match(packageSmoke, /run\(installer, \["\/S", "\/currentuser"\]/);
  assert.match(packageSmoke, /reg\.exe[\s\S]*InstallLocation/);
});

test("packaged launcher owns a detached checksummed Windows updater", () => {
  const updater = fs.readFileSync(path.join(launcherRoot, "electron", "update.cjs"), "utf8");
  const worker = fs.readFileSync(path.join(launcherRoot, "electron", "update-worker.cjs"), "utf8");
  assert.match(updater, /platform === "win32"/);
  assert.match(worker, /job\.platform === "win32"/);
  assert.match(updater, /expectedChecksum/);
  assert.match(updater, /SHA-256 verification failed/);
  assert.match(updater, /detached:\s*true/);
  assert.match(worker, /waitForParent/);
  assert.doesNotMatch(worker, /backup/i);
});

test("CI packages and smoke-launches on Windows only", () => {
  const ci = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const release = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.match(ci, /os: \[windows-latest\]/);
  assert.match(ci, /bun run app:package/);
  assert.match(ci, /bun run app:smoke/);
  assert.match(ci, /prepare-windows-baseline-bun\.ps1 -Version 1\.4\.0/);
  assert.doesNotMatch(ci, /prepare-linux-libnotify/);
  assert.doesNotMatch(ci, /appimage/i);
  // macOS never appears. Linux survives only as the seconds-long build-ref/publish
  // coordinators (runs-on ubuntu-latest) and never as a build runner.
  assert.doesNotMatch(release, /macos/);
  assert.doesNotMatch(release, /darwin/);
  for (const linuxBuild of ["appimage", "libnotify", "xvfb", "archlinux", "AppImage"]) {
    assert.doesNotMatch(release, new RegExp(linuxBuild, "i"));
  }
  assert.match(release, /windows-latest/);
  assert.match(release, /chatgpt-jev-windows-amd64\.zip/);
  assert.match(release, /launcher\/build\/runtime/);
  assert.match(release, /bun run app:smoke/);
  assert.match(release, /prepare-windows-baseline-bun\.ps1 -Version 1\.4\.0/);
  assert.doesNotMatch(release, /prepare-linux-libnotify/);
  assert.doesNotMatch(release, /appimage/i);
  assert.doesNotMatch(release, /codesign/);
  assert.doesNotMatch(release, /ChatGPT Jev\.app/);
  assert.doesNotMatch(release, /gh release create[\s\S]*?--draft/);
});

test("release does not publish demo or screenshot assets", () => {
  const release = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.doesNotMatch(release, /assets\/demo\.gif/);
  assert.doesNotMatch(release, /release-assets\/[^\n]*(?:demo|screenshot)/i);
});

test("Windows packages embed the checksummed Bun baseline runtime for CPUs without AVX2", () => {
  const builder = fs.readFileSync(path.join(repositoryRoot, "scripts", "build-runtime-bundle.ts"), "utf8");
  const baseline = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "prepare-windows-baseline-bun.ps1"),
    "utf8",
  );
  assert.match(builder, /CODEX_CHATGPT_WEB_EMBEDDED_BUN/);
  assert.match(builder, /Embedded Bun must be/);
  assert.match(baseline, /bun-windows-x64-baseline\.zip/);
  assert.match(baseline, /SHASUMS256\.txt/);
  assert.match(baseline, /Get-FileHash[^\n]+SHA256/);
  assert.match(baseline, /CODEX_CHATGPT_WEB_EMBEDDED_BUN=/);
});
