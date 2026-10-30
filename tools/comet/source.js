import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const SOURCE_EXTRACTION_POLICY = 'safe-data-owner-execute-v1';

function minimumPython(lock) {
  if (lock?.toolchain?.sourceExtractionPolicy !== SOURCE_EXTRACTION_POLICY) {
    reject('LOCK_INVALID', 'The locked source extraction policy is missing or unsupported');
  }
  const value = lock?.toolchain?.pythonMinimum;
  const match = typeof value === 'string' && /^(\d+)\.(\d+)$/.exec(value);
  if (!match) reject('LOCK_INVALID', 'An explicit Python minimum major.minor is required');
  const minimum = [Number(match[1]), Number(match[2])];
  if (!minimum.every(Number.isSafeInteger) || minimum[0] < 3 || (minimum[0] === 3 && minimum[1] < 12)) {
    reject('LOCK_INVALID', 'The safe extraction policy requires Python 3.12 or later');
  }
  return minimum;
}

function supportedPython(version, minimum) {
  return Array.isArray(version) && version.length === 3 && version.every(Number.isSafeInteger)
    && (version[0] > minimum[0] || (version[0] === minimum[0] && version[1] >= minimum[1]));
}

async function selectPython(minimum) {
  let value;
  try {
    const probe = await execFileAsync('python3', ['-c', 'import json,sys; print(json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable}))'], { timeout: 10000, maxBuffer: 16384 });
    value = JSON.parse(probe.stdout.trim());
  } catch { reject('TOOLCHAIN_MISMATCH', 'Python 3.12+ is required and must be runnable'); }
  if (!supportedPython(value?.version, minimum) || typeof value.executable !== 'string' || !path.isAbsolute(value.executable)) {
    reject('TOOLCHAIN_MISMATCH', `Source extraction requires Python ${minimum.join('.')} or later`);
  }
  let executable;
  try { executable = await fs.realpath(value.executable); }
  catch { reject('TOOLCHAIN_MISMATCH', 'The selected Python executable cannot be resolved'); }
  return { executable, version: value.version.join('.') };
}

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function managedParent(root, commit) {
  let current = root;
  for (const segment of ['.sdd', 'vendor', 'comet', commit]) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        reject('SOURCE_PATH_UNSAFE', 'Comet source parents must be real project directories');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

async function sourceManifest(directory, prefix = '') {
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    reject('SOURCE_PATH_UNSAFE', 'Comet pristine source must be a real directory');
  }
  const files = Object.create(null);
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const stat = await fs.lstat(file);
      files[relative] = { kind: 'directory', executeBits: stat.mode & 0o111 };
      Object.assign(files, await sourceManifest(file, relative));
    } else if (entry.isFile()) {
      const stat = await fs.lstat(file);
      files[relative] = { kind: 'file', sha256: sha256(await fs.readFile(file)), executeBits: stat.mode & 0o111 };
    }
    else reject('SOURCE_PATH_UNSAFE', 'Comet source must contain only real files and directories');
  }
  return files;
}

const extractArchive = String.raw`
import pathlib, sys, tarfile
archive, destination, prefix, expected_version = sys.argv[1:]
if '.'.join(str(part) for part in sys.version_info[:3]) != expected_version:
    raise ValueError('selected Python version changed before extraction')
with tarfile.open(archive, 'r:gz') as source:
    members = source.getmembers()
    if not members or len(members) > 20000 or sum(m.size for m in members) > 512 * 1024 * 1024:
        raise ValueError('unsafe archive size or member count')
    for member in members:
        parts = pathlib.PurePosixPath(member.name).parts
        if not parts or pathlib.PurePosixPath(member.name).is_absolute() or '..' in parts or parts[0] != prefix:
            raise ValueError('unsafe archive path')
        if not (member.isfile() or member.isdir()):
            raise ValueError('archive links and special files are not allowed')
    # Uniform safe modes: only source owner-executable files retain execution.
    for member in members:
        member.mode = 0o755 if member.isdir() or member.mode & 0o100 else 0o644
    source.extractall(destination, members=members, filter='data')
`;

// Verifies an already-prepared pristine source against its recorded v2
// provenance without needing the archive: provenance identity, manifest
// equality and on-disk reality must all agree.
export async function verifyPreparedSource({ projectRoot, lock }) {
  const minimum = minimumPython(lock);
  if (!/^[a-f0-9]{40}$/.test(lock?.source?.commit ?? '')) {
    reject('LOCK_INVALID', 'A fixed Comet source commit is required');
  }
  const root = await fs.realpath(projectRoot);
  const target = await managedParent(root, lock.source.commit);
  let provenance;
  try {
    provenance = JSON.parse(await fs.readFile(path.join(target, 'provenance.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') reject('SOURCE_NOT_PREPARED', 'Comet pristine source has not been prepared in this project');
    throw error;
  }
  if (provenance.schemaVersion !== 2 || provenance.commit !== lock.source.commit
      || provenance.archiveSha256 !== lock.source.sha256
      || provenance.package?.name !== lock.package.name
      || provenance.package?.version !== lock.package.version) {
    reject('SOURCE_BASELINE_DRIFT', 'Prepared Comet source provenance does not match the fixed source lock');
  }
  const recordedVersion = /^(\d+)\.(\d+)\.(\d+)$/.exec(provenance.extraction?.pythonVersion ?? '');
  if (provenance.extraction?.policy !== SOURCE_EXTRACTION_POLICY
      || provenance.extraction?.pythonMinimum !== lock.toolchain.pythonMinimum
      || !recordedVersion || !supportedPython(recordedVersion.slice(1).map(Number), minimum)) {
    reject('SOURCE_BASELINE_DRIFT', 'Prepared Comet source has no current verified extraction policy; preserve it and prepare a new target');
  }
  const actual = await sourceManifest(path.join(target, 'pristine'));
  const sameFiles = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((name) => JSON.stringify(a[name]) === JSON.stringify(b[name]));
  if (!sameFiles(actual, provenance.files)) {
    reject('SOURCE_BASELINE_DRIFT', 'Comet pristine source differs from its recorded provenance');
  }
  let sourcePackage;
  try { sourcePackage = JSON.parse(await fs.readFile(path.join(target, 'pristine', 'package.json'), 'utf8')); }
  catch { reject('SOURCE_BASELINE_DRIFT', 'Prepared Comet source package identity is unreadable'); }
  if (sourcePackage?.name !== lock.package.name || sourcePackage?.version !== lock.package.version) {
    reject('SOURCE_BASELINE_DRIFT', 'Prepared Comet source package identity differs from the fixed source lock');
  }
  return { sourceDir: path.join(target, 'pristine'), provenancePath: path.join(target, 'provenance.json') };
}

export async function prepareCometSource({ projectRoot, lock, archivePath }) {
  if (lock?.schemaVersion !== 1
      || lock.package?.name !== '@rpamis/comet'
      || !/^\d+\.\d+\.\d+$/.test(lock.package?.version ?? '')
      || !/^[a-f0-9]{40}$/.test(lock.source?.commit ?? '')
      || lock.source?.directory !== `comet-${lock.source?.commit}`
      || !/^[a-f0-9]{64}$/.test(lock.source?.sha256 ?? '')
      || !Number.isSafeInteger(lock.source?.bytes) || lock.source.bytes <= 0) {
    reject('LOCK_INVALID', 'A fixed Comet package, source commit, size and SHA256 are required');
  }
  const archive = await fs.readFile(archivePath);
  if (archive.length !== lock.source.bytes || sha256(archive) !== lock.source.sha256) {
    reject('ARCHIVE_INTEGRITY_MISMATCH', 'The Comet source archive does not match its fixed lock');
  }
  const minimum = minimumPython(lock);
  const python = await selectPython(minimum);
  const root = await fs.realpath(projectRoot);
  const target = await managedParent(root, lock.source.commit);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, '.preparing-'));
  try {
    const verifiedArchive = path.join(staging, 'verified-source.tar.gz');
    await fs.writeFile(verifiedArchive, archive, { flag: 'wx', mode: 0o600 });
    try {
      await execFileAsync(python.executable, ['-c', extractArchive, verifiedArchive, staging, lock.source.directory, python.version]);
    } catch {
      reject('UNSAFE_ARCHIVE', 'Comet source extraction failed its bounded path and member checks');
    }
    await fs.unlink(verifiedArchive);
    const extracted = path.join(staging, lock.source.directory);
    const pkg = JSON.parse(await fs.readFile(path.join(extracted, 'package.json'), 'utf8'));
    if (pkg.name !== lock.package.name || pkg.version !== lock.package.version) {
      reject('SOURCE_IDENTITY_MISMATCH', 'The extracted package identity does not match the fixed source lock');
    }
    await fs.rename(extracted, path.join(staging, 'pristine'));
    const manifest = await sourceManifest(path.join(staging, 'pristine'));
    const provenance = {
      schemaVersion: 2, commit: lock.source.commit, archiveSha256: lock.source.sha256,
      package: { name: pkg.name, version: pkg.version },
      extraction: { policy: SOURCE_EXTRACTION_POLICY, pythonMinimum: lock.toolchain.pythonMinimum, pythonVersion: python.version }, files: manifest,
    };
    await fs.writeFile(path.join(staging, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
    await managedParent(root, lock.source.commit);
    try {
      await fs.lstat(target);
      const previous = JSON.parse(await fs.readFile(path.join(target, 'provenance.json'), 'utf8'));
      const actual = await sourceManifest(path.join(target, 'pristine'));
      const sameFiles = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length
        && Object.keys(a).every((name) => JSON.stringify(a[name]) === JSON.stringify(b[name]));
      if (previous.schemaVersion !== 2 || previous.commit !== provenance.commit
          || previous.archiveSha256 !== provenance.archiveSha256
          || previous.package?.name !== provenance.package.name
          || previous.package?.version !== provenance.package.version
          || previous.extraction?.policy !== SOURCE_EXTRACTION_POLICY
          || previous.extraction?.pythonMinimum !== lock.toolchain.pythonMinimum
          || !supportedPython((/^(\d+)\.(\d+)\.(\d+)$/.exec(previous.extraction?.pythonVersion ?? '') ?? []).slice(1).map(Number), minimum)
          || !sameFiles(manifest, previous.files) || !sameFiles(manifest, actual)) {
        reject('SOURCE_BASELINE_DRIFT', 'Existing Comet pristine source differs from the verified archive');
      }
      return { sourceDir: path.join(target, 'pristine'), provenancePath: path.join(target, 'provenance.json'), reused: true };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Only an absent target may be installed; incomplete existing caches must not be overwritten.
      try {
        await fs.lstat(target);
      } catch (targetError) {
        if (targetError.code === 'ENOENT') {
          await fs.rename(staging, target);
          return { sourceDir: path.join(target, 'pristine'), provenancePath: path.join(target, 'provenance.json'), reused: false };
        }
        throw targetError;
      }
      reject('SOURCE_BASELINE_DRIFT', 'Existing Comet source cache is incomplete');
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
