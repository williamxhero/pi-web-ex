import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, statSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function input(name) {
  const value = process.env[name];
  assert.ok(value && isAbsolute(value), `${name} must name an absolute path`);
  return realpathSync.native(value);
}

async function run() {
  assert.equal(process.platform, 'win32');
  const cwd = input('PI_WEB_T44_COPY');
  assert.ok(statSync(cwd).isDirectory());
  // The documented export has no Git metadata. Never run this acceptance in a checkout.
  for (const dir of [cwd, join(cwd, '..')]) {
    try { lstatSync(join(dir, '.git')); throw new Error('T44 must run in an isolated export, not a Git working tree'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const runtime = input('PI_WEB_T44_PI_HOST');
  const skills = input('PI_WEB_T44_SKILL_ROOT');
  const evidence = input('PI_WEB_T44_EVIDENCE');
  const commandPath = process.env.PI_WEB_T44_PATH;
  assert.ok(commandPath && commandPath.split(';').every(isAbsolute), 'Provide an absolute-path-only, fixture-safe PI_WEB_T44_PATH');
  const runDir = mkdtempSync(join(evidence, 't44-'));
  const allocation = mkdtempSync(join(realpathSync.native(tmpdir()), 'piweb-t44-migration-'));
  const work = mkdtempSync(join(allocation, 'only-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(systemroot|windir|comspec|pathext|processor_architecture|systemdrive|os|number_of_processors)$/i.test(key)));
  Object.assign(env, {
    PATH: commandPath, TEMP: work, TMP: work, TMPDIR: work, HOME: work, USERPROFILE: work,
    APPDATA: join(work, 'appdata'), LOCALAPPDATA: join(work, 'local'),
    PI_CODING_AGENT_DIR: join(work, 'empty-agent'), GH_CONFIG_DIR: join(work, 'empty-gh'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_ALLOW_PROTOCOL: 'file',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1',
    NF_TEST_PI_HOST: runtime, NF_REQUIRE_INSTALLED_PI_TEST: '1', NF44_ALLOCATION: allocation,
    NF43_ALLOCATION: allocation, NF_TEST_SKILL_ROOT: skills,
    NODE_OPTIONS: '--require ' + JSON.stringify(fileURLToPath(new URL('./pi-nf-t44-offline.cjs', import.meta.url))),
  });
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'PI_CODING_AGENT_DIR', 'GH_CONFIG_DIR']) mkdirSync(env[key]);
  const logPath = join(runDir, 't44-case.log');
  closeSync(openSync(logPath, 'wx'));
  const log = createWriteStream(logPath, { flags: 'a' });
  const flushed = finished(log);
  let rawExit = 1;
  let passed = false;
  let skipped = true;
  try {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=stale closed child', 'dist/test/current-spec-implementation.test.js'], {
      cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    rawExit = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8');
        let pending = '';
        stream.on('data', (data) => {
          log.write(data);
          const lines = (pending + data).split(/\r?\n/);
          pending = lines.pop();
          for (const line of lines) {
            if (/^ℹ pass 1$/.test(line)) passed = true;
            if (/^ℹ skipped 0$/.test(line)) skipped = false;
            if (line.length < 800 && /stale closed child|^ℹ |^✖ |^AssertionError/.test(line)) console.log(line);
          }
        });
      }
    });
  } finally {
    log.end();
    await flushed;
  }
  console.log('T44 evidence: ' + logPath);
  const exit = rawExit || (!passed || skipped ? 1 : 0);
  console.log('T44 selected test exit ' + exit);
  process.exitCode = exit;
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
