import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-skills-route-"));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { PATCH, DELETE } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(dir, name, frontmatter = "") {
  const filePath = join(dir, name, "SKILL.md");
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(filePath, `---\nname: ${name}\n${frontmatter}description: ${name} skill\n---\n\n# ${name}\n`);
  return filePath;
}

function patchSkills(body) {
  return PATCH(new Request("http://localhost/api/skills", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function deleteSkill(body) {
  return DELETE(new Request("http://localhost/api/skills", {
    method: "DELETE",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("a batch hides every listed skill and reports each file on its own", async () => {
  const skillsDir = join(agentDir, "skills");
  const visible = await writeSkill(skillsDir, "visible");
  const hidden = await writeSkill(skillsDir, "hidden", "disable-model-invocation: true\n");
  const outside = await writeSkill(join(root, "outside"), "outside");
  const missing = join(skillsDir, "missing", "SKILL.md");
  const hiddenBefore = await stat(hidden);
  const outsideBefore = await readFile(outside, "utf8");

  const response = await patchSkills({
    filePaths: [visible, hidden, outside, missing, visible],
    disableModelInvocation: true,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [
      { filePath: visible },
      { filePath: hidden },
      { filePath: outside, error: "Access denied" },
      { filePath: missing, error: "file not found" },
    ],
  });
  assert.equal(
    await readFile(visible, "utf8"),
    "---\ndisable-model-invocation: true\nname: visible\ndescription: visible skill\n---\n\n# visible\n",
  );
  // A skill already hidden is not rewritten, and a refused one is untouched.
  assert.equal((await stat(hidden)).mtimeMs, hiddenBefore.mtimeMs);
  assert.equal(await readFile(outside, "utf8"), outsideBefore);
});

test("a batch keeps going past a skill whose frontmatter cannot be edited", async () => {
  const skillsDir = join(agentDir, "skills");
  const hidden = await writeSkill(skillsDir, "to-show", "disable-model-invocation: true\n");
  const unsupported = join(skillsDir, "unsupported", "SKILL.md");
  await mkdir(join(skillsDir, "unsupported"), { recursive: true });
  // Parsed as frontmatter, but the key sits on a flow-mapping line the surgical
  // editor refuses to rewrite.
  await writeFile(unsupported, "---\n{ name: unsupported, disable-model-invocation: true }\n---\nbody\n");

  const response = await patchSkills({ filePaths: [unsupported, hidden], disableModelInvocation: false });
  const { results } = await response.json();

  assert.equal(response.status, 200);
  assert.match(results[0].error, /unsupported frontmatter formatting/);
  assert.deepEqual(results[1], { filePath: hidden });
  assert.doesNotMatch(await readFile(hidden, "utf8"), /disable-model-invocation/);
});

test("a single-skill toggle keeps its original response shape", async () => {
  const skill = await writeSkill(join(agentDir, "skills"), "single");

  const response = await patchSkills({ filePath: skill, disableModelInvocation: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.match(await readFile(skill, "utf8"), /disable-model-invocation: true/);

  const refused = await patchSkills({ filePath: join(root, "outside", "outside", "SKILL.md"), disableModelInvocation: true });
  assert.equal(refused.status, 403);
});

test("a malformed batch is rejected before any file is edited", async () => {
  const skill = await writeSkill(join(agentDir, "skills"), "untouched");
  const before = await readFile(skill, "utf8");

  assert.equal((await patchSkills({ filePaths: [skill, 42], disableModelInvocation: true })).status, 400);
  assert.equal((await patchSkills({ filePaths: skill, disableModelInvocation: true })).status, 400);
  assert.equal((await patchSkills({ filePaths: [skill], disableModelInvocation: "yes" })).status, 400);
  assert.equal(await readFile(skill, "utf8"), before);
});

test("only markdown files are edited, however they are named in the request", async () => {
  // auth.json and settings.json sit inside the agent dir, which the route
  // allows; a frontmatter block at their top would break them.
  const authPath = join(agentDir, "auth.json");
  const auth = JSON.stringify({ provider: { type: "api_key", key: "test" } });
  await mkdir(agentDir, { recursive: true });
  await writeFile(authPath, auth);

  const single = await patchSkills({ filePath: authPath, disableModelInvocation: true });
  assert.equal(single.status, 400);
  const batch = await patchSkills({ filePaths: [authPath], disableModelInvocation: true });
  assert.deepEqual(await batch.json(), { results: [{ filePath: authPath, error: "Not a skill file" }] });
  assert.equal(await readFile(authPath, "utf8"), auth);
});

test("DELETE removes a listed skill and refuses one the cwd does not list", async () => {
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  allowFileRoot(cwd);

  const filePath = await writeSkill(join(agentDir, "skills"), "deletable");
  const response = await deleteSkill({ cwd, filePath });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(existsSync(join(agentDir, "skills", "deletable")), false);

  // A path that exists but is not a loaded skill must not be deleted by
  // asking for it directly.
  const outside = await writeSkill(join(root, "outside"), "outside");
  const refused = await deleteSkill({ cwd, filePath: outside });
  assert.equal(refused.status, 404);
  assert.equal(existsSync(outside), true);
});

test("DELETE refuses a skill from a settings path and leaves it in place", async () => {
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  allowFileRoot(cwd);

  // A skill at an explicit `skills` path is listed, but only the standard
  // skills folders may be deleted here.
  const external = await writeSkill(join(root, "path-skills"), "external");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ skills: [join(root, "path-skills")] }),
  );

  const response = await deleteSkill({ cwd, filePath: external });
  assert.equal(response.status, 403);
  assert.equal(existsSync(external), true);
  await rm(join(agentDir, "settings.json"), { force: true });
});

test("DELETE needs a JSON body and a cwd Pi Web may open", async () => {
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });

  const plain = await DELETE(new Request("http://localhost/api/skills", {
    method: "DELETE",
    headers: { host: "localhost", "content-type": "text/plain" },
    body: JSON.stringify({ cwd, filePath: "x" }),
  }));
  assert.equal(plain.status, 415);

  const missing = await deleteSkill({ filePath: "x" });
  assert.equal(missing.status, 400);

  // A folder that no session or explicit choice allows is off limits even
  // when the body is well formed.
  const denied = await deleteSkill({ cwd: join(root, "not-allowed"), filePath: "x" });
  assert.equal(denied.status, 403);
});
