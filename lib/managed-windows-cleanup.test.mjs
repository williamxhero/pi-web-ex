import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { stopOwnedTree, withAcceptanceCleanup } from '../e2e/owned-process.mjs';

function processFixture() {
  return Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
}

test('owned server stop fails by deadline when the process never exits', async () => {
  const process = processFixture();
  const logs = [];
  await assert.rejects(stopOwnedTree(process, { write: value => logs.push(value) }, {
    deadline: 20,
    kill(_command, args, options) {
      assert.deepEqual(args, ['/pid', '123', '/t', '/f']);
      assert.equal(options.windowsHide, true);
      return { status: 0, stdout: 'stop requested' };
    },
  }), /Timed out waiting/);
  assert.match(logs.join(''), /exit=0\nstop requested/);
  assert.equal(process.listenerCount('exit'), 0);
});

test('cleanup failure retains the original acceptance failure and the cleanup diagnostic', async () => {
  const original = new Error('acceptance assertion failed');
  const process = processFixture();
  const logs = [];
  await assert.rejects(withAcceptanceCleanup(async () => { throw original; }, () =>
    stopOwnedTree(process, { write: value => logs.push(value) }, {
      kill: () => ({ status: 5, stderr: 'fixture cleanup denied' }),
    })), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, original);
    assert.equal(error.errors[0], original);
    assert.match(error.errors[1].message, /exit 5/);
    return true;
  });
  assert.match(logs.join(''), /fixture cleanup denied/);
});
