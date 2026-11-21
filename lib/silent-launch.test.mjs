import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { runNpx } = await jiti.import('./npx.ts');
const { checkPluginUpdates } = await jiti.import('./plugin-updates.ts');

for (const fails of [false, true]) test(`plugin Git and npx stay silent and preserve ${fails ? 'failure' : 'success'} evidence`, async t => {
  const calls = [];
  t.mock.method(ChildProcess.prototype, 'spawn', function (options) {
    calls.push(options);
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    const target = options.args.some(arg => arg === 'ls-remote' || arg === '--version');
    queueMicrotask(() => {
      const output = options.file !== 'git' ? '1.0.0\n' : options.args.includes('ls-remote') ? 'a'.repeat(40) + '\tHEAD\n'
        : options.args.includes('@{upstream}') ? 'origin/main\n' : 'a'.repeat(40) + '\n';
      this.stdout.end(output);
      this.stderr.end(target && fails ? 'fixture remote failure' : '');
      this.emit('close', target && fails ? 7 : 0, null);
    });
    return 0;
  });
  const result = await checkPluginUpdates(process.cwd(), undefined, { packages: [
    { source: 'git:https://github.com/test/fixture', scope: 'user', installedPath: process.cwd() },
  ] });
  assert.equal(result[0].state, fails ? 'error' : 'up-to-date');
  if (fails) assert.match(result[0].message, /fixture remote failure/);
  const npx = runNpx(['--version']);
  if (fails) await assert.rejects(npx, error => error.code === 7 && error.stderr.includes('fixture remote failure'));
  else assert.equal((await npx).stdout.trim(), '1.0.0');
  assert.deepEqual(calls.filter(c => c.file === 'git').map(c => c.args[1]), ['rev-parse', 'rev-parse', 'ls-remote']);
  for (const call of calls) assert.equal(call.windowsHide, true);
  if (process.platform === 'win32') for (const call of calls.filter(c => c.file === 'git')) {
    assert.ok(call.envPairs.includes('GIT_TERMINAL_PROMPT=0'));
    assert.ok(call.envPairs.includes('GCM_INTERACTIVE=never'));
  }
});
