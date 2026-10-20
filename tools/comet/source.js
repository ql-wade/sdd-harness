import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

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
archive, destination, prefix = sys.argv[1:]
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
    source.extractall(destination, members=members, filter='data')
`;

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
  const root = await fs.realpath(projectRoot);
  const target = await managedParent(root, lock.source.commit);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, '.preparing-'));
  try {
    const verifiedArchive = path.join(staging, 'verified-source.tar.gz');
    await fs.writeFile(verifiedArchive, archive, { flag: 'wx', mode: 0o600 });
    try {
      await execFileAsync('python3', ['-c', extractArchive, verifiedArchive, staging, lock.source.directory]);
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
      package: { name: pkg.name, version: pkg.version }, files: manifest,
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
