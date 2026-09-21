const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { renameAtomicFile } = require("./atomic-file.cjs");
const { runtimeBundlePaths } = require("./runtime-command.cjs");

const DEFAULT_SOURCE_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_SOURCE_WAIT_INTERVAL_MS = 50;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bundleIdFor(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function validateManifestPath(relativePath) {
  if (typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath === "manifest.json"
    || relativePath.includes("\\")
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some(segment => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Runtime manifest contains an unsafe file path: ${JSON.stringify(relativePath)}`);
  }
  return relativePath;
}

function readRuntimeManifest(runtimeRoot, { version, platform, arch, bundleId }) {
  const manifestPath = path.join(runtimeRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Runtime manifest is missing: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Runtime manifest is invalid: ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedLauncher = `bin/${platform === "win32" ? "chatgpt-jev.cmd" : "chatgpt-jev"}`;
  if (manifest?.schemaVersion !== 2
    || manifest.appVersion !== version
    || manifest.platform !== platform
    || manifest.arch !== arch
    || manifest.launcher !== expectedLauncher
    || manifest.entrypoint !== "app/cli.js"
    || typeof manifest.bunVersion !== "string"
    || typeof manifest.playwright !== "string"
    || !SHA256_PATTERN.test(manifest.bundleId)
    || (bundleId && manifest.bundleId !== bundleId)
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) {
    const received = manifest && typeof manifest === "object" ? {
      schemaVersion: manifest.schemaVersion,
      appVersion: manifest.appVersion,
      bundleId: manifest.bundleId,
      bunVersion: manifest.bunVersion,
      platform: manifest.platform,
      arch: manifest.arch,
      launcher: manifest.launcher,
      entrypoint: manifest.entrypoint,
      playwright: manifest.playwright,
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : null,
    } : manifest;
    throw new Error(
      `Runtime bundle identity mismatch: expected ${version} ${platform}/${arch}, received ${JSON.stringify(received)}`,
    );
  }

  let previousPath = null;
  const files = manifest.files.map((file, index) => {
    if (!file || typeof file !== "object"
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !SHA256_PATTERN.test(file.sha256)) {
      throw new Error(`Runtime manifest contains an invalid file record at index ${index}`);
    }
    const relativePath = validateManifestPath(file.path);
    if (previousPath !== null && comparePaths(previousPath, relativePath) >= 0) {
      throw new Error(`Runtime manifest file paths are not unique and sorted: ${relativePath}`);
    }
    previousPath = relativePath;
    return { path: relativePath, size: file.size, sha256: file.sha256 };
  });
  if (bundleIdFor(files) !== manifest.bundleId) {
    throw new Error(`Runtime manifest bundleId does not match its file records: ${manifestPath}`);
  }
  return { ...manifest, files };
}

function runtimeFilePaths(runtimeRoot) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(runtimeRoot, absolutePath).split(path.sep).join("/");
      if (relativePath === "manifest.json") continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      paths.push(relativePath);
    }
  };
  visit(runtimeRoot);
  return paths.sort(comparePaths);
}

function validateRuntimeFile(runtimeRoot, canonicalRoot, file) {
  const absolutePath = path.join(runtimeRoot, ...file.path.split("/"));
  let metadata;
  try {
    metadata = fs.statSync(absolutePath);
  } catch {
    throw new Error(`Runtime bundle file is missing: ${absolutePath}`);
  }
  if (!metadata.isFile()) throw new Error(`Runtime bundle entry is not a file: ${absolutePath}`);
  if (fs.lstatSync(absolutePath).isSymbolicLink()) {
    const target = fs.realpathSync(absolutePath);
    if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new Error(`Runtime bundle symlink escapes the bundle: ${absolutePath}`);
    }
  }
  if (metadata.size !== file.size) {
    throw new Error(`Runtime bundle file size mismatch: ${absolutePath}`);
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  if (sha256 !== file.sha256) {
    throw new Error(`Runtime bundle file checksum mismatch: ${absolutePath}`);
  }
}

function inspectRuntimeBundle(runtimeRoot, identity) {
  const manifest = readRuntimeManifest(runtimeRoot, identity);
  const expectedPaths = manifest.files.map(file => file.path);
  const expectedSet = new Set(expectedPaths);
  const paths = runtimeBundlePaths(runtimeRoot, identity.platform);
  for (const required of [
    paths.executable,
    paths.entrypoint,
    path.join(runtimeRoot, "app", "browser-helper.cjs"),
    path.join(runtimeRoot, ...manifest.launcher.split("/")),
  ]) {
    const relativePath = path.relative(runtimeRoot, required).split(path.sep).join("/");
    if (!expectedSet.has(relativePath)) {
      throw new Error(`Runtime manifest does not declare required file: ${required}`);
    }
  }

  const actualPaths = runtimeFilePaths(runtimeRoot);
  const actualSet = new Set(actualPaths);
  const missing = expectedPaths.find(relativePath => !actualSet.has(relativePath));
  if (missing) throw new Error(`Runtime bundle file is missing: ${path.join(runtimeRoot, ...missing.split("/"))}`);
  const unexpected = actualPaths.find(relativePath => !expectedSet.has(relativePath));
  if (unexpected) {
    throw new Error(`Runtime bundle contains an unmanifested file: ${path.join(runtimeRoot, ...unexpected.split("/"))}`);
  }
  if (actualPaths.length !== expectedPaths.length) {
    throw new Error(`Runtime bundle file count mismatch: expected ${expectedPaths.length}, received ${actualPaths.length}`);
  }

  const canonicalRoot = fs.realpathSync(runtimeRoot);
  for (const file of manifest.files) validateRuntimeFile(runtimeRoot, canonicalRoot, file);
  if (identity.platform !== "win32" && (fs.statSync(paths.executable).mode & 0o111) === 0) {
    throw new Error(`Bundled Bun runtime is not executable: ${paths.executable}`);
  }
  return { manifest, runtimeRoot: paths.runtimeRoot };
}

function validateRuntimeBundle(runtimeRoot, identity) {
  return inspectRuntimeBundle(runtimeRoot, identity).runtimeRoot;
}

async function waitForPackagedRuntimeSource({
  app,
  resourcesPath,
  timeoutMs = DEFAULT_SOURCE_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_SOURCE_WAIT_INTERVAL_MS,
}) {
  if (!app.isPackaged) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Packaged runtime source wait requires non-negative timeoutMs and positive intervalMs");
  }
  const source = path.join(resourcesPath, "runtime");
  const identity = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      return validateRuntimeBundle(source, identity);
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Packaged runtime did not fully materialize within ${timeoutMs}ms: ${detail}`);
}

function findReusableInstalledRuntime(destination, expectedIdentity) {
  if (!fs.existsSync(destination)) return null;
  let currentValid = false;
  try {
    validateRuntimeBundle(destination, expectedIdentity);
    currentValid = true;
  } catch {
    // A terminated installer or external cleanup can leave a version directory present but
    // incomplete. Rebuild the launcher-owned bundle transactionally from the signed package.
  }
  if (currentValid) {
    return { root: destination, locked: !safeToColdRenameDirectory(destination) };
  }
  return safeToColdRenameDirectory(destination) ? { root: null, locked: false } : { root: destination, locked: true };
}

function isTransientRenameError(error) {
  return Boolean(error) && ["EPERM", "EACCES", "EBUSY"].includes(error?.code);
}

function safeToColdRenameDirectory(directory) {
  if (!fs.existsSync(directory)) return true;
  let probe;
  try {
    probe = `${directory}.rename-probe-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    fs.renameSync(directory, probe);
    fs.renameSync(probe, directory);
    return true;
  } catch (error) {
    try {
      if (probe && fs.existsSync(probe) && !fs.existsSync(directory)) {
        fs.renameSync(probe, directory);
      }
    } catch {}
    if (isTransientRenameError(error)) return false;
    return false;
  }
}

function sweepStaleTransients(versionsRoot, baseName) {
  let entries = [];
  try {
    entries = fs.readdirSync(versionsRoot);
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (entry !== `${baseName}.tmp` && !entry.startsWith(`${baseName}.tmp-`)
      && !entry.startsWith(`${baseName}.previous-`)) {
      continue;
    }
    const candidate = path.join(versionsRoot, entry);
    let age = Number.POSITIVE_INFINITY;
    const match = /(?:^|\D)(\d{10,})($|[^0-9])/g.exec(entry);
    if (match) {
      const stamp = Number(match[1]);
      const digits = match[1].length;
      age = digits === 13 ? now - stamp : now - stamp * 1000;
    }
    if (age < 30_000 && entry.includes(`${process.pid}`)) continue;
    try {
      fs.rmSync(candidate, { recursive: true, force: true });
    } catch {}
  }
}

function fallbackInstallations(versionsRoot, baseName) {
  let entries = [];
  try {
    entries = fs.readdirSync(versionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isDirectory()
      && entry.name !== baseName
      && !entry.name.startsWith(`${baseName}.tmp`)
      && !entry.name.startsWith(`${baseName}.previous-`)
      && entry.name.startsWith(`${baseName}.fallback-`))
    .map(entry => path.join(versionsRoot, entry.name))
    .sort();
}

function findStaleFallbackCandidate(versionsRoot, baseName, expectedIdentity) {
  for (const candidate of fallbackInstallations(versionsRoot, baseName)) {
    try {
      validateRuntimeBundle(candidate, expectedIdentity);
    } catch {
      return candidate;
    }
  }
  return null;
}

function findFreshFallbackCandidate(versionsRoot, baseName, expectedIdentity) {
  for (const candidate of fallbackInstallations(versionsRoot, baseName)) {
    try {
      return validateRuntimeBundle(candidate, expectedIdentity);
    } catch {}
  }
  return null;
}

function installSideBySideFallback({ source, versionsRoot, baseName, expectedIdentity }) {
  const fallback = `${path.join(versionsRoot, baseName)}.fallback-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(fallback)) fs.rmSync(fallback, { recursive: true, force: true });
    fs.cpSync(source, fallback, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    return validateRuntimeBundle(fallback, expectedIdentity);
  } catch {
    try { fs.rmSync(fallback, { recursive: true, force: true }); } catch {}
    return null;
  }
}

function ensurePackagedRuntime({ app, coreHome, resourcesPath }) {
  if (!app.isPackaged) return null;
  const identity = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
  const source = path.join(resourcesPath, "runtime");
  const sourceBundle = inspectRuntimeBundle(source, identity);
  const expectedIdentity = { ...identity, bundleId: sourceBundle.manifest.bundleId };
  const versionsRoot = path.join(coreHome, "versions");
  const baseName = `${identity.version}-${identity.platform}-${identity.arch}`;
  const destination = path.join(versionsRoot, baseName);
  const reusable = findReusableInstalledRuntime(destination, expectedIdentity);
  if (reusable?.locked) {
    try {
      return validateRuntimeBundle(reusable.root, expectedIdentity);
    } catch {
      // The locked directory no longer matches this release: another live launcher owns it.
      // Fall through to a side-by-side fallback instead of crashing startup with EPERM.
    }
  } else if (reusable?.root) {
    return reusable.root;
  }

  fs.mkdirSync(versionsRoot, { recursive: true, mode: 0o700 });
  sweepStaleTransients(versionsRoot, baseName);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
  let previousMoved = false;
  try {
    fs.cpSync(source, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    validateRuntimeBundle(temporary, expectedIdentity);
    if (!safeToColdRenameDirectory(destination)) {
      fs.rmSync(temporary, { recursive: true, force: true });
      const staleCandidate = findStaleFallbackCandidate(
        versionsRoot, baseName, expectedIdentity,
      );
      if (staleCandidate) {
        try {
          fs.rmSync(staleCandidate, { recursive: true, force: true });
        } catch {}
      }
      const fallback = findFreshFallbackCandidate(versionsRoot, baseName, expectedIdentity)
        ?? installSideBySideFallback({ source, versionsRoot, baseName, expectedIdentity });
      if (fallback) {
        return fallback;
      }
      if (fs.existsSync(destination)) {
        try {
          return validateRuntimeBundle(destination, expectedIdentity);
        } catch (validationError) {
          throw new Error(
            `Installed runtime is in use by another process and cannot be replaced right now: ${
              validationError instanceof Error ? validationError.message : String(validationError)
            }. Close the other ChatGPT Jev window or retry once it exits, then launch again.`,
          );
        }
      }
      throw new Error(
        "Installed runtime is in use by another process and cannot be replaced right now. "
        + "Close the other ChatGPT Jev window or retry once it exits, then launch again.",
      );
    }
    if (fs.existsSync(destination)) {
      renameAtomicFile(destination, previous);
      previousMoved = true;
    }
    try {
      renameAtomicFile(temporary, destination);
      validateRuntimeBundle(destination, expectedIdentity);
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      if (previousMoved) {
        try {
          renameAtomicFile(previous, destination);
          previousMoved = false;
        } catch (restoreError) {
          throw new Error(
            `Runtime replacement failed: ${error instanceof Error ? error.message : String(error)}`
            + `; previous runtime restoration failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          );
        }
      }
      throw error;
    }
    if (previousMoved) {
      fs.rmSync(previous, { recursive: true, force: true });
      previousMoved = false;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (previousMoved && fs.existsSync(previous) && !fs.existsSync(destination)) {
      renameAtomicFile(previous, destination);
      previousMoved = false;
    }
  }
  try { fs.chmodSync(destination, 0o700); } catch {}
  return validateRuntimeBundle(destination, expectedIdentity);
}

module.exports = {
  ensurePackagedRuntime,
  validateRuntimeBundle,
  waitForPackagedRuntimeSource,
};
