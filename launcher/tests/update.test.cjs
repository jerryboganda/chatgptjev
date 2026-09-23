const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildJob,
  compareVersions,
  createUpdateController,
  expectedChecksum,
  releaseApiUrl,
  releaseAssetName,
  releaseRepository,
  validateReleaseAssetUrl,
} = require("../electron/update.cjs");

test("Windows update jobs target the silent NSIS installer and refuse other platforms", () => {
  const job = buildJob({
    version: "1.2.0",
    platform: "win32",
    executablePath: "C:\\Users\\tester\\AppData\\Local\\Programs\\ChatGPT Jev\\ChatGPT Jev.exe",
    assetPath: "C:\\Users\\tester\\AppData\\Local\\Temp\\chatgpt-jev-1.2.0-win-x64.exe",
    tempRoot: "C:\\Users\\tester\\AppData\\Local\\Temp\\stage",
    logPath: "C:\\Users\\tester\\AppData\\Roaming\\ChatGPT Jev\\logs\\update-worker.log",
  });
  assert.equal(job.platform, "win32");
  assert.equal(job.version, "1.2.0");
  assert.equal(job.source, "C:\\Users\\tester\\AppData\\Local\\Temp\\chatgpt-jev-1.2.0-win-x64.exe");
  assert.equal(job.target, "C:\\Users\\tester\\AppData\\Local\\Programs\\ChatGPT Jev\\ChatGPT Jev.exe");
  assert.equal(job.parentPid, process.pid);
  assert.throws(() => buildJob({
    version: "1.2.0",
    platform: "linux",
    executablePath: "/tmp/launcher",
    assetPath: "/tmp/update.AppImage",
    tempRoot: "/tmp/stage",
    logPath: "/tmp/update.log",
  }), /Updates are not supported on linux/);
  assert.throws(() => buildJob({
    version: "1.2.0",
    platform: "darwin",
    executablePath: "/Applications/ChatGPT Jev.app/Contents/MacOS/ChatGPT Jev",
    assetPath: "/tmp/update.zip",
    tempRoot: "/tmp/stage",
    logPath: "/tmp/update.log",
  }), /Updates are not supported on darwin/);
});

test("release comparison and platform assets are strict", () => {
  assert.equal(compareVersions("1.1.5", "1.1.4"), 1);
  assert.equal(compareVersions("1.1.4", "1.1.4"), 0);
  assert.equal(compareVersions("1.1.3", "1.1.4"), -1);
  assert.equal(compareVersions("1.2.0", "1.1.99"), 1);
  assert.equal(releaseAssetName("1.2.0", "win32", "x64"), "chatgpt-jev-1.2.0-win-x64.exe");
  assert.equal(releaseAssetName("1.2.0", "win32", "arm64"), null);
  assert.equal(releaseAssetName("1.2.0", "darwin", "arm64"), null);
  assert.equal(releaseAssetName("1.2.0", "darwin", "x64"), null);
  assert.equal(releaseAssetName("1.2.0", "linux", "x64"), null);
  assert.equal(releaseAssetName("1.2.0", "linux", "arm64"), null);
});

test("checksums and release URLs bind the exact expected asset", () => {
  const hash = "a".repeat(64);
  assert.equal(expectedChecksum(`${hash}  launcher.exe\n`, "launcher.exe"), hash);
  assert.throws(() => expectedChecksum(`${hash}  other.exe\n`, "launcher.exe"), /no entry/);
  assert.equal(
    validateReleaseAssetUrl(
      "https://github.com/jerryboganda/chatgptjev/releases/download/v1.2.0/launcher.exe",
      "1.2.0",
      "launcher.exe",
    ),
    "https://github.com/jerryboganda/chatgptjev/releases/download/v1.2.0/launcher.exe",
  );
  assert.throws(
    () => validateReleaseAssetUrl("https://example.com/launcher.exe", "1.2.0", "launcher.exe"),
    /unexpected release asset URL/,
  );
});

test("the detached Windows worker installs silently after the parent exits", () => {
  const worker = fs.readFileSync(path.join(__dirname, "..", "electron", "update-worker.cjs"), "utf8");
  assert.match(worker, /job\.platform === "win32"/);
  assert.match(worker, /spawnSync\(job\.source, \["\/S"\]/);
  assert.match(worker, /waitForParent/);
  assert.match(worker, /requireFile\(job\.source, "Windows installer"\)/);
  assert.match(worker, /requireFile\(job\.target, "Installed Windows launcher"\)/);
  assert.match(worker, /installed and relaunched/);
  assert.match(worker, /Unsupported update platform/);
  assert.doesNotMatch(worker, /AppImage|darwin|runnerSource|wrapper/);
});

test("startup check runs once and exposes only a newer complete release", async () => {
  let calls = 0;
  const published = [];
  const controller = createUpdateController({
    currentVersion: "1.1.4",
    platform: "win32",
    arch: "x64",
    packaged: true,
    executablePath: "C:\\Program Files\\ChatGPT Jev\\ChatGPT Jev.exe",
    runtimeExecutable: "C:\\Program Files\\ChatGPT Jev\\resources\\runtime\\runtime\\bun.exe",
    logsDirectory: "C:\\logs",
    publish: (state) => published.push(state),
    dependencies: {
      fetchRelease: async () => {
        calls += 1;
        return {
          tag_name: "v1.2.0",
          assets: [
            {
              name: "chatgpt-jev-1.2.0-win-x64.exe",
              browser_download_url: "https://github.com/jerryboganda/chatgptjev/releases/download/v1.2.0/chatgpt-jev-1.2.0-win-x64.exe",
            },
            {
              name: "checksums.txt",
              browser_download_url: "https://github.com/jerryboganda/chatgptjev/releases/download/v1.2.0/checksums.txt",
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(await controller.checkOnce(), { status: "available", version: "1.2.0" });
  assert.deepEqual(await controller.checkOnce(), { status: "available", version: "1.2.0" });
  assert.equal(calls, 1);
  assert.deepEqual(published.map((state) => state.status), ["checking", "available"]);
});

test("verified update is handed to one detached worker", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-update-test-"));
  const assetBody = Buffer.from("new installer");
  const hash = require("node:crypto").createHash("sha256").update(assetBody).digest("hex");
  let spawned = null;
  try {
    const controller = createUpdateController({
      currentVersion: "1.1.4",
      platform: "win32",
      arch: "x64",
      packaged: true,
      executablePath: "C:\\Program Files\\ChatGPT Jev\\ChatGPT Jev.exe",
      runtimeExecutable: "C:\\durable\\bun.exe",
      logsDirectory: path.join(root, "logs"),
      dependencies: {
        fetchRelease: async () => ({
          tag_name: "v1.2.0",
          assets: [
            {
              name: "chatgpt-jev-1.2.0-win-x64.exe",
              browser_download_url: "https://github.com/jerryboganda/chatgptjev/releases/download/v1.2.0/chatgpt-jev-1.2.0-win-x64.exe",
            },
            {
              name: "checksums.txt",
              browser_download_url: "https://github.com/jerryboganda/chatgptjev/releases/download/v1.2.0/checksums.txt",
            },
          ],
        }),
        downloadText: async () => `${hash}  chatgpt-jev-1.2.0-win-x64.exe\n`,
        downloadFile: async (_url, destination) => fs.writeFileSync(destination, assetBody),
        sha256: (filePath) => require("node:crypto").createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
        spawnWorker: (runtime, worker, job) => {
          spawned = { runtime, worker, job, data: JSON.parse(fs.readFileSync(job, "utf8")) };
          return { pid: 123, unref() {}, kill() {} };
        },
      },
    });
    await controller.checkOnce();
    const launch = await controller.beginInstall();
    assert.equal(spawned.runtime, "C:\\durable\\bun.exe");
    assert.equal(spawned.data.version, "1.2.0");
    assert.equal(spawned.data.platform, "win32");
    assert.equal(spawned.data.source, path.join(launch.tempRoot, "chatgpt-jev-1.2.0-win-x64.exe"));
    assert.equal(spawned.data.target, "C:\\Program Files\\ChatGPT Jev\\ChatGPT Jev.exe");
    assert.equal(controller.getState().status, "installing");
    controller.cancelInstall(launch);
    assert.equal(fs.existsSync(launch.tempRoot), false);
    assert.deepEqual(controller.getState(), { status: "available", version: "1.2.0" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release channel defaults to the fork repository and honors the environment override", () => {
  const previous = process.env.CHATGPT_JEV_UPDATE_REPO;
  delete process.env.CHATGPT_JEV_UPDATE_REPO;
  try {
    assert.equal(releaseRepository(), "jerryboganda/chatgptjev");
    assert.equal(releaseApiUrl(), "https://api.github.com/repos/jerryboganda/chatgptjev/releases/latest");
    process.env.CHATGPT_JEV_UPDATE_REPO = "staging-owner/chatgptjev-staging";
    assert.equal(releaseRepository(), "staging-owner/chatgptjev-staging");
    assert.equal(releaseApiUrl(), "https://api.github.com/repos/staging-owner/chatgptjev-staging/releases/latest");
    assert.equal(
      validateReleaseAssetUrl(
        "https://github.com/staging-owner/chatgptjev-staging/releases/download/v1.2.0/launcher.exe",
        "1.2.0",
        "launcher.exe",
      ),
      "https://github.com/staging-owner/chatgptjev-staging/releases/download/v1.2.0/launcher.exe",
    );
    assert.throws(
      () => validateReleaseAssetUrl(
        "https://github.com/miuuyy/codex-chatgpt-web/releases/download/v1.2.0/launcher.exe",
        "1.2.0",
        "launcher.exe",
      ),
      /unexpected release asset URL/,
    );
    assert.throws(
      () => validateReleaseAssetUrl("https://example.com/launcher.exe", "1.2.0", "launcher.exe"),
      /unexpected release asset URL/,
    );
  } finally {
    if (previous === undefined) delete process.env.CHATGPT_JEV_UPDATE_REPO;
    else process.env.CHATGPT_JEV_UPDATE_REPO = previous;
  }
});

test("whitespace-padded or empty channel overrides fall back to the fork repository", () => {
  const previous = process.env.CHATGPT_JEV_UPDATE_REPO;
  try {
    process.env.CHATGPT_JEV_UPDATE_REPO = "   ";
    assert.equal(releaseRepository(), "jerryboganda/chatgptjev");
    process.env.CHATGPT_JEV_UPDATE_REPO = "";
    assert.equal(releaseRepository(), "jerryboganda/chatgptjev");
  } finally {
    if (previous === undefined) delete process.env.CHATGPT_JEV_UPDATE_REPO;
    else process.env.CHATGPT_JEV_UPDATE_REPO = previous;
  }
});
