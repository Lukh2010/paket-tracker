/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('desktop installer works with spaces, is repeatable, and preserves existing launchers', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'unterwegs install '));
  try {
    const project = path.join(temp, 'my project');
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(project, 'bin'));
    for (const file of ['scripts/install-desktop.sh', 'bin/unterwegs', 'bin/unterwegs-mcp'])
      fs.copyFileSync(path.join(root, file), path.join(project, file));
    const env = { ...process.env, HOME: path.join(temp, 'user'), XDG_DATA_HOME: path.join(temp, 'data') };
    const run = () => execFileSync('bash', [path.join(project, 'scripts/install-desktop.sh')], { env, stdio: 'pipe' });
    run(); run();
    const launcher = path.join(env.HOME, '.local/bin/unterwegs');
    assert.equal(fs.realpathSync(launcher), path.join(project, 'bin/unterwegs'));
    assert.match(fs.readFileSync(path.join(env.XDG_DATA_HOME, 'applications/unterwegs.desktop'), 'utf8'), /Exec=".*my project\/bin\/unterwegs"/);
    fs.unlinkSync(launcher);
    fs.writeFileSync(launcher, 'existing launcher');
    assert.throws(run);
    assert.equal(fs.readFileSync(launcher, 'utf8'), 'existing launcher');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
