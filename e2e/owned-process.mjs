import { spawnSync } from 'node:child_process';

const exited = (process) => process.exitCode !== null || process.signalCode !== null;

export async function stopOwnedTree(process, log, { kill = spawnSync, deadline = 7000 } = {}) {
  if (!process?.pid || exited(process)) return;
  let listener, timer;
  const exit = new Promise((resolve, reject) => {
    listener = resolve;
    process.once('exit', listener);
    timer = setTimeout(() => reject(new Error('Timed out waiting for isolated server exit')), deadline);
  });
  try {
    const killed = kill('taskkill.exe', ['/pid', String(process.pid), '/t', '/f'], {
      windowsHide: true, encoding: 'utf8', timeout: 5000,
    });
    log.write(`Server stop: exit=${killed.status ?? 'none'}\n${killed.stdout ?? ''}${killed.stderr ?? ''}\n`);
    if (killed.status !== 0) throw new Error(`Could not confirm isolated server cleanup: exit ${killed.status ?? 'unknown'}`, { cause: killed.error });
    await exit;
  } finally {
    clearTimeout(timer);
    process.removeListener('exit', listener);
  }
}

export async function withAcceptanceCleanup(run, cleanup) {
  let original;
  try { return await run(); }
  catch (error) { original = error; throw error; }
  finally {
    try { await cleanup(); }
    catch (error) {
      if (original) throw new AggregateError([original, error], `Acceptance failed: ${original.message}; cleanup also failed: ${error.message}`, { cause: original });
      throw error;
    }
  }
}
