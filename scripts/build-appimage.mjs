import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
execFileSync(process.execPath, ['node_modules/vinext/dist/cli.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, UNTERWEGS_DESKTOP_BUILD: '1' },
});
const stage = path.join(root, 'desktop-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync('desktop', path.join(stage, 'desktop'), { recursive: true });
fs.copyFileSync('LICENSE', path.join(stage, 'LICENSE'));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, description: pkg.description,
  author: pkg.author, license: pkg.license, main: 'desktop/main.cjs',
}, null, 2));
execFileSync(process.execPath, ['node_modules/electron-builder/cli.js', '--linux', 'AppImage', '--x64', '--publish', 'never'], { stdio: 'inherit' });
