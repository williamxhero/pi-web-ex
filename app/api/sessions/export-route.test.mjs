import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { createJiti } from "jiti";
import test from "node:test";

const source = await readFile(new URL("./[id]/export/route.ts", import.meta.url), "utf8");

test("session export uses a private per-request temp directory", () => {
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "pi-web-export-"\)\)/);
  assert.doesNotMatch(source, /join\(tmpdir\(\), "pi-web-export"\)/);
  assert.match(source, /rmSync\(tempDir, \{ recursive: true, force: true \}\)/);
});

for (const failing of [false, true]) test(`HTML export keeps the Pi CLI silent on ${failing ? 'failure' : 'success'} and exposes the result`, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-export-silent-test-'));
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = agentDir;
    await rm(dir,{recursive:true,force:true});
  });
  await mkdir(join(dir,'sessions','fixture'),{recursive:true});
  const id = 'export-fixture';
  const path = join(dir,'sessions','fixture',`2026-01-01T00-00-00-000Z_${id}.jsonl`);
  await writeFile(path, JSON.stringify({type:'session',version:3,id,cwd:dir,timestamp:'2026-01-01T00:00:00.000Z'})+'\n');
  const jiti = createJiti(import.meta.url, {alias:{'@':process.cwd()}});
  const {cacheSessionPath} = await jiti.import('../../../lib/session-reader.ts');
  cacheSessionPath(id,path);
  const {GET} = await jiti.import('./[id]/export/route.ts');
  const options=[];
  t.mock.method(ChildProcess.prototype,'spawn',function (opts) {
    options.push(opts);
    this.stdout=new PassThrough(); this.stderr=new PassThrough();
    queueMicrotask(async()=>{
      if(!failing) await writeFile(opts.args.at(-1),'<html>fixture export</html>');
      this.stdout.end(); this.stderr.end(failing?'fixture export failed':'');
      this.emit('close',failing?7:0,null);
    });
    return 0;
  });
  const response=await GET(new Request('http://localhost/api/sessions/export-fixture/export'),{params:Promise.resolve({id})});
  assert.equal(response.status,failing?500:200);
  assert.match(await response.text(),failing?/fixture export failed/:/fixture export/);
  assert.equal(options.length,1);
  assert.equal(options[0].windowsHide,true);
});
