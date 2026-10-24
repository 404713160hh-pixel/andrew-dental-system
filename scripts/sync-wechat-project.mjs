/** Synchronize the already-built native mini-program into an existing IDE project.
 * Configurations are preserved. Every overwritten/removed file is backed up.
 * No build, IDE operation, recursive deletion, or database operation is performed.
 */
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactHash } from '../miniprogram/scripts/artifact-hash.mjs';

const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const requestedTarget = resolve(process.env.WECHAT_PROJECT_PATH || 'D:/AndrewDentalMiniProgram');
const dryRun = process.argv.includes('--dry-run');
assert.ok(process.argv.slice(2).every(argument => argument === '--dry-run'), 'Only --dry-run is supported');
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const statIfPresent = path => {
  try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const inside = (parent, child) => {
  const part = relative(parent, child);
  return part === '' || part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
};
function noLinks(path, boundary) {
  assert.ok(inside(boundary, path), `Path escaped its intended directory: ${path}`);
  let current = path;
  while (true) {
    const stat = statIfPresent(current);
    if (stat) assert.ok(!stat.isSymbolicLink(), `Symlinks/junctions are forbidden: ${current}`);
    if (current === boundary) break;
    const parent = dirname(current); assert.notEqual(parent, current); current = parent;
  }
}
function snapshot(directory, boundary) {
  noLinks(directory, boundary);
  if (!existsSync(directory)) return { exists: false, hash: null, files: {}, directories: [] };
  assert.ok(lstatSync(directory).isDirectory(), `Expected a directory: ${directory}`);
  const files = Object.create(null), directories = [];
  function visit(folder, part = '') {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const local = join(part, entry.name), absolute = join(folder, entry.name);
      const stat = lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink(), `Symlinks/junctions are forbidden: ${absolute}`);
      if (stat.isDirectory()) { directories.push(local); visit(absolute, local); }
      else { assert.ok(stat.isFile(), `Unsupported filesystem entry: ${absolute}`); files[local] = hashFile(absolute); }
    }
  }
  visit(directory);
  return { exists: true, hash: artifactHash(directory), files, directories };
}
assert.ok(existsSync(requestedTarget), 'WECHAT_PROJECT_PATH must be an existing native IDE project');
assert.ok(!lstatSync(requestedTarget).isSymbolicLink(), 'The target project cannot be a symlink/junction');
const target = realpathSync(requestedTarget);
assert.ok(!inside(repository, target) && !inside(target, repository), 'The target and repository must be separate, non-overlapping directories');
const targetConfigPath = resolve(target, 'project.config.json');
noLinks(targetConfigPath, target);
const targetConfig = JSON.parse(readFileSync(targetConfigPath, 'utf8'));
assert.equal(targetConfig.compileType, 'miniprogram', 'Target project.config.json must describe a native mini-program');
assert.ok(typeof targetConfig.miniprogramRoot === 'string' && targetConfig.miniprogramRoot.trim(), 'Target configuration must declare miniprogramRoot');
const targetCompiled = resolve(target, targetConfig.miniprogramRoot);
const targetSource = resolve(target, 'src');
assert.ok(targetCompiled !== target && inside(target, targetCompiled), 'Configured miniprogramRoot must remain strictly inside the target project');
assert.ok(!inside(targetSource, targetCompiled) && !inside(targetCompiled, targetSource), 'Target source and compiled directories must not overlap');
noLinks(targetSource, target); noLinks(targetCompiled, target);
const configurations = ['project.config.json', 'project.private.config.json'].filter(name => statIfPresent(resolve(target, name))).map(name => {
  const path = resolve(target, name); noLinks(path, target); assert.ok(lstatSync(path).isFile());
  return { name, hash: hashFile(path) };
});
const pairs = [
  { name: 'src', source: resolve(repository, 'miniprogram/src'), destination: targetSource },
  { name: 'dist', source: resolve(repository, 'miniprogram/dist'), destination: targetCompiled },
].map(pair => ({ ...pair, sourceBefore: snapshot(pair.source, repository), targetBefore: snapshot(pair.destination, target) }));
assert.ok(pairs.every(pair => pair.sourceBefore.exists), 'Build the mini-program first; both repository src and dist must exist');
for (const required of ['app.js', 'app.json', 'config.js']) assert.ok(required in pairs[1].sourceBefore.files, `Compiled output is incomplete: ${required}`);
const ignored = readFileSync(resolve(repository, '.gitignore'), 'utf8').split(/\r?\n/).some(line => line.trim() === '.booking-data/');
assert.ok(ignored, 'The backup directory must be covered by the repository .booking-data/ ignore rule');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + '-' + randomBytes(3).toString('hex');
const backup = resolve(repository, '.booking-data/wechat-backups', stamp);
noLinks(backup, repository);
const manifest = {
  startedAt: new Date().toISOString(), status: dryRun ? 'dry-run' : 'running', repository,
  targetProjectPath: target, configuredMiniprogramRoot: targetConfig.miniprogramRoot,
  preservedConfigurations: configurations, backupDirectory: backup,
  pairs: pairs.map(({ name, source, destination, sourceBefore, targetBefore }) => ({ name, source, destination, sourceBefore, targetBefore })),
  changes: [],
};
function configurationUnchanged() {
  for (const item of configurations) {
    noLinks(resolve(target, item.name), target);
    assert.equal(hashFile(resolve(target, item.name)), item.hash, `Target configuration changed: ${item.name}`);
  }
}
function mirror(pair) {
  const { sourceBefore, targetBefore, source, destination, name } = pair;
  assert.equal(snapshot(source, repository).hash, sourceBefore.hash, `Source changed before synchronization: ${name}`);
  assert.equal(snapshot(destination, target).hash, targetBefore.hash, `Target changed after backup: ${name}`);
  // Remove only exact previously inventoried, backed-up regular files. Each
  // directory removal below is non-recursive and must already be empty.
  for (const [part, expectedHash] of Object.entries(targetBefore.files)) if (!(part in sourceBefore.files)) {
    const path = resolve(destination, part); noLinks(path, target);
    assert.equal(hashFile(path), expectedHash, `Target file changed before cleanup: ${path}`);
    unlinkSync(path); manifest.changes.push({ tree: name, action: 'remove-backed-up-file', path: part });
  }
  const requiredDirectories = new Set(sourceBefore.directories);
  for (const part of [...targetBefore.directories].sort((a, b) => b.split(sep).length - a.split(sep).length)) if (!requiredDirectories.has(part)) {
    const path = resolve(destination, part); noLinks(path, target);
    rmdirSync(path); manifest.changes.push({ tree: name, action: 'remove-empty-directory', path: part });
  }
  noLinks(destination, target); mkdirSync(destination, { recursive: true });
  for (const part of sourceBefore.directories) {
    const path = resolve(destination, part); noLinks(path, target); mkdirSync(path, { recursive: true });
  }
  for (const [part, expectedHash] of Object.entries(sourceBefore.files)) {
    const from = resolve(source, part), to = resolve(destination, part);
    noLinks(from, repository); noLinks(to, target);
    assert.equal(hashFile(from), expectedHash, `Source file changed: ${from}`);
    if (existsSync(to)) assert.equal(hashFile(to), targetBefore.files[part], `Target file changed or appeared during synchronization: ${to}`);
    copyFileSync(from, to);
    assert.equal(hashFile(to), expectedHash, `Copied file hash mismatch: ${to}`);
    manifest.changes.push({ tree: name, action: 'copy-file', path: part });
  }
  const after = snapshot(destination, target);
  assert.equal(after.hash, sourceBefore.hash, `Synchronized tree hash mismatch: ${name}`);
  assert.equal(snapshot(source, repository).hash, sourceBefore.hash, `Source changed during synchronization: ${name}`);
  manifest.pairs.find(item => item.name === name).targetAfter = after;
}
if (dryRun) {
  console.log(JSON.stringify({ status: 'dry-run', targetProjectPath: target, configuredMiniprogramRoot: targetCompiled,
    sourceHashes: Object.fromEntries(pairs.map(pair => [pair.name, pair.sourceBefore.hash])),
    targetHashes: Object.fromEntries(pairs.map(pair => [pair.name, pair.targetBefore.hash])), wouldPreserve: configurations.map(item => item.name) }, null, 2));
} else {
  mkdirSync(backup, { recursive: true });
  const manifestPath = resolve(backup, 'manifest.json');
  const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  try {
    saveManifest();
    for (const item of configurations) {
      copyFileSync(resolve(target, item.name), resolve(backup, item.name));
      assert.equal(hashFile(resolve(backup, item.name)), item.hash, `Configuration backup mismatch: ${item.name}`);
    }
    for (const pair of pairs) if (pair.targetBefore.exists) {
      const path = resolve(backup, pair.name); cpSync(pair.destination, path, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
      assert.equal(snapshot(path, backup).hash, pair.targetBefore.hash, `Backup hash mismatch: ${pair.name}`);
    }
    configurationUnchanged();
    for (const pair of pairs) { mirror(pair); configurationUnchanged(); saveManifest(); }
    manifest.status = 'passed';
  } catch (error) {
    manifest.status = 'failed'; manifest.error = error.message; process.exitCode = 1;
    console.error(`同步未完成；原文件备份保留在 ${backup}。${error.message}`);
  } finally {
    manifest.finishedAt = new Date().toISOString(); saveManifest();
    console.log(JSON.stringify({ status: manifest.status, targetProjectPath: target, backupDirectory: backup,
      hashes: Object.fromEntries(manifest.pairs.map(pair => [pair.name, pair.targetAfter?.hash ?? null])),
      configurationsPreserved: configurations.map(item => item.name), manifest: manifestPath }, null, 2));
  }
}
