const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

function appendLog(job, message) {
  try {
    fs.mkdirSync(path.dirname(job.logPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(job.logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  } catch {}
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForParent(pid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Launcher process ${pid} did not exit in time`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function launch(bin, args = []) {
  const child = spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function requireFile(filePath, label) {
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${filePath || "unknown"}`);
  }
}

function updateWindows(job) {
  requireFile(job.source, "Windows installer");
  const result = spawnSync(job.source, ["/S"], { encoding: "utf8", timeout: 15 * 60_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows installer exited with code ${result.status}`);
  requireFile(job.target, "Installed Windows launcher");
  launch(job.target);
}

function relaunchExisting(job) {
  try {
    if (job.platform === "win32" && fs.existsSync(job.target)) launch(job.target);
  } catch {}
}

async function main() {
  const jobPath = process.argv[2];
  if (!jobPath || !path.isAbsolute(jobPath)) throw new Error("Update worker requires an absolute job path");
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  appendLog(job, `waiting for launcher PID ${job.parentPid} before installing v${job.version}`);
  await waitForParent(job.parentPid);
  appendLog(job, `installing v${job.version} on ${job.platform}`);
  try {
    if (job.platform === "win32") updateWindows(job);
    else throw new Error(`Unsupported update platform: ${job.platform}. This fork updates Windows installs only.`);
    appendLog(job, `v${job.version} installed and relaunched`);
    try { fs.rmSync(job.tempRoot, { recursive: true, force: true }); } catch {}
  } catch (error) {
    appendLog(job, `update failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    relaunchExisting(job);
    throw error;
  }
}

void main().catch(() => process.exit(1));
