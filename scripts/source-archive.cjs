// Ship actual working-tree source, including the embedded submodule and local patches.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-source-'));
const prefix = `hammer-source-${version}`;
const destination = path.join(stage, prefix);
const manifest = {};
function list(directory, tracked) {
  return execFileSync('git', ['ls-files', '-z', ...(tracked ? ['--cached'] : ['--others', '--exclude-standard'])], {
    cwd: directory,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}
function copy(directory, relative, namespace = '') {
  const source = path.join(directory, relative);
  if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) return;
  const target = path.join(namespace, relative);
  const content = fs.readFileSync(source);
  fs.mkdirSync(path.dirname(path.join(destination, target)), { recursive: true });
  fs.writeFileSync(path.join(destination, target), content);
  fs.chmodSync(path.join(destination, target), fs.statSync(source).mode);
  manifest[target] = crypto.createHash('sha256').update(content).digest('hex');
}
try {
  for (const file of list(root, true)) copy(root, file);
  // Limit untracked content to reviewed source/configuration locations; never user data.
  for (const file of list(root, false)) {
    if (
      /^(src|tests|docs|scripts|licenses)\//.test(file) ||
      /^(LICENSE|tsconfig\.overlay\.json|vite\.renderer-chat-overlay\.config\.mts)$/.test(file)
    )
      copy(root, file);
  }
  const overlay = path.join(root, 'chat-overlay');
  for (const file of list(overlay, true)) copy(overlay, file, 'chat-overlay');
  for (const file of list(overlay, false)) {
    if (file.startsWith('src/')) copy(overlay, file, 'chat-overlay');
  }
  fs.writeFileSync(
    path.join(destination, 'SOURCE_MANIFEST.json'),
    JSON.stringify(
      {
        overlayUpstream: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: overlay, encoding: 'utf8' }).trim(),
        files: manifest,
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  const archive = path.join(root, 'out', `${prefix}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', stage, prefix]);
  console.log(`Source archive: ${archive} (${Object.keys(manifest).length} files)`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
