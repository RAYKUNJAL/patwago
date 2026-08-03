'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function jsFilesIn(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((file) => file.endsWith('.js'))
    .map((file) => path.join(dir, file));
}

const files = ['server.js', ...jsFilesIn('lib'), ...jsFilesIn('public/app')];

let failed = false;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'pipe' });
    console.log(`ok   ${file}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${file}`);
    console.error(String(error.stderr || error.message).trim());
  }
}

if (failed) {
  console.error(`\n${files.length} files checked, at least one failed.`);
  process.exit(1);
}
console.log(`\n${files.length} files checked, all OK.`);
