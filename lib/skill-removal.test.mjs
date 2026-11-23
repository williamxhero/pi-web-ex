import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { removeSkillFiles } = await jiti.import("./skill-removal.ts");

// Junctions need no elevation on Windows; directory symlinks do.
const linkType = process.platform === "win32" ? "junction" : "dir";

function writeSkill(filePath, name) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`,
    "utf8",
  );
  return filePath;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pi-web-skill-removal-"));
  const cwd = join(root, "project");
  const homeDir = join(root, "home");
  const agentDir = join(homeDir, ".pi", "agent");
  const globalLockPath = join(homeDir, ".agents", ".skill-lock.json");
  const projectLockPath = join(cwd, "skills-lock.json");
  const options = { cwd, agentDir, homeDir, globalLockPath, projectLockPath };
  return { root, cwd, homeDir, agentDir, globalLockPath, projectLockPath, options };
}

test("a globally installed folder skill takes its lock entry with it", () => {
  const { root, agentDir, globalLockPath, options } = setup();
  try {
    const filePath = writeSkill(join(agentDir, "skills", "edge-tts", "SKILL.md"), "edge-tts");
    writeJson(globalLockPath, {
      version: 3,
      skills: {
        "edge-tts": { source: "aahl/skills", skillPath: "skills/edge-tts/SKILL.md" },
        keep: { source: "someone/skills" },
      },
    });

    const result = removeSkillFiles({ name: "edge-tts", filePath }, options);

    assert.deepEqual(result, { ok: true, removed: [dirname(filePath)] });
    assert.equal(existsSync(dirname(filePath)), false);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(globalLockPath, "utf8")).skills), ["keep"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a single-file skill deletes the file, never the folder holding every skill", () => {
  const { root, cwd, projectLockPath, options } = setup();
  try {
    const skillsDir = join(cwd, ".pi", "skills");
    const filePath = writeSkill(join(skillsDir, "loose.md"), "loose");
    const neighbor = writeSkill(join(skillsDir, "neighbor", "SKILL.md"), "neighbor");
    writeJson(projectLockPath, { version: 1, skills: { loose: { source: "here/local" } } });

    const result = removeSkillFiles({ name: "loose", filePath }, options);

    assert.deepEqual(result, { ok: true, removed: [filePath] });
    assert.equal(existsSync(filePath), false);
    assert.equal(existsSync(skillsDir), true);
    assert.equal(existsSync(neighbor), true);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(projectLockPath, "utf8")).skills), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a skill outside the skills folders is refused and left alone", () => {
  const { root, agentDir, options } = setup();
  try {
    // A pi package's skill lives under the agent dir but is removed with its package.
    const filePath = writeSkill(join(agentDir, "packages", "pkg", "skills", "packaged", "SKILL.md"), "packaged");

    const result = removeSkillFiles({ name: "packaged", filePath }, options);

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(existsSync(filePath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a skill linked out of a skills folder loses the link, not the shared target", () => {
  const { root, agentDir, options } = setup();
  try {
    const target = writeSkill(join(root, "shared", "linked", "SKILL.md"), "linked");
    const link = join(agentDir, "skills", "linked");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(dirname(target), link, linkType);

    const result = removeSkillFiles({ name: "linked", filePath: join(link, "SKILL.md") }, options);

    assert.equal(result.ok, true);
    assert.equal(existsSync(link), false);
    assert.equal(existsSync(target), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a skill linked into another skills folder removes the copy pi would list next", () => {
  const { root, homeDir, agentDir, options } = setup();
  try {
    const canonical = writeSkill(join(homeDir, ".agents", "skills", "copy", "SKILL.md"), "copy");
    const link = join(agentDir, "skills", "copy");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(dirname(canonical), link, linkType);

    const result = removeSkillFiles({ name: "copy", filePath: join(link, "SKILL.md") }, options);

    assert.equal(result.ok, true);
    assert.equal(existsSync(link), false);
    assert.equal(existsSync(dirname(canonical)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a link to a sibling skill folder is an alias: only the link goes", () => {
  const { root, agentDir, options } = setup();
  try {
    const real = writeSkill(join(agentDir, "skills", "real", "SKILL.md"), "real");
    const alias = join(agentDir, "skills", "alias");
    symlinkSync(dirname(real), alias, linkType);

    const result = removeSkillFiles({ name: "alias", filePath: join(alias, "SKILL.md") }, options);

    assert.equal(result.ok, true);
    assert.equal(existsSync(alias), false);
    assert.equal(existsSync(real), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses to delete a skills folder that is itself a skill", () => {
  const { root, agentDir, options } = setup();
  try {
    const filePath = writeSkill(join(agentDir, "skills", "SKILL.md"), "root-skill");

    const result = removeSkillFiles({ name: "root-skill", filePath }, options);

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(existsSync(filePath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing skill file is reported instead of removing anything", () => {
  const { root, agentDir, options } = setup();
  try {
    const filePath = join(agentDir, "skills", "gone", "SKILL.md");

    const result = removeSkillFiles({ name: "gone", filePath }, options);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
