import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
  DefaultResourceLoader,
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
  getPowerShellConfig,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const {
  createProjectCommandBashExtension,
  createProjectCommandBashOperations,
  createProjectCommandPowerShellExtension,
  preferUserBashExtension,
  preferUserPowerShellExtension,
  sanitizeProjectCommandEnvironment,
} = await createJiti(import.meta.url).import("./project-command-env.ts");

function powerShellAvailable() {
  try {
    getPowerShellConfig();
    return true;
  } catch {
    return false;
  }
}

const HOST_ENVIRONMENT = {
  PORT: "30141",
  NODE_ENV: "production",
  NEXT_RUNTIME: "nodejs",
  NEXT_PRIVATE_WORKER: "1",
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/home/pi",
  HTTPS_PROXY: "http://proxy.example",
  OPENROUTER_API_KEY: "secret",
  PI_USER_SETTING: "preserved",
  PI_WEB_PASSWORD: "web-login-password",
};

test("sanitizes host variables using platform casing rules", () => {
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(HOST_ENVIRONMENT, "linux"),
    {
      PATH: HOST_ENVIRONMENT.PATH,
      HOME: HOST_ENVIRONMENT.HOME,
      HTTPS_PROXY: HOST_ENVIRONMENT.HTTPS_PROXY,
      OPENROUTER_API_KEY: HOST_ENVIRONMENT.OPENROUTER_API_KEY,
      PI_USER_SETTING: HOST_ENVIRONMENT.PI_USER_SETTING,
    },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        Port: "30141",
        node_env: "production",
        Next_Runtime: "nodejs",
        NEXT_PUBLIC_FLAG: "1",
        Pi_Web_Password: "web-login-password",
        Path: "C:\\Windows",
      },
      "win32",
    ),
    { Path: "C:\\Windows" },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        PORT: "30141",
        Port: "project-value",
        NODE_ENV: "production",
        node_env: "project-mode",
        NEXT_RUNTIME: "nodejs",
        Next_Runtime: "project-runtime",
      },
      "linux",
    ),
    {
      Port: "project-value",
      node_env: "project-mode",
      Next_Runtime: "project-runtime",
    },
  );
});

test("agent bash removes host variables while preserving SDK and user environment", async () => {
  const original = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NEXT_PRIVATE_WORKER: process.env.NEXT_PRIVATE_WORKER,
    PI_USER_SETTING: process.env.PI_USER_SETTING,
    PI_WEB_PASSWORD: process.env.PI_WEB_PASSWORD,
  };
  Object.assign(process.env, {
    PORT: "30141",
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    NEXT_PRIVATE_WORKER: "1",
    PI_USER_SETTING: "preserved",
    PI_WEB_PASSWORD: "web-login-password",
  });

  try {
    const extension = createProjectCommandBashExtension({
      cwd: process.cwd(),
      settings: {
        getShellCommandPrefix: () => undefined,
        getShellPath: () => undefined,
      },
    });
    let registeredTool;
    await extension.factory({
      registerTool(tool) {
        registeredTool = tool;
      },
    });

    const result = await registeredTool.execute(
      "issue-484",
      {
        command: `node -e 'console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,NEXT_PRIVATE_WORKER:process.env.NEXT_PRIVATE_WORKER,PI_USER_SETTING:process.env.PI_USER_SETTING,PI_WEB_PASSWORD:process.env.PI_WEB_PASSWORD,PI_SESSION_ID:process.env.PI_SESSION_ID,PATH:process.env.PATH}))'`,
      },
      undefined,
      undefined,
      {
        model: undefined,
        thinkingLevel: "off",
        sessionManager: {
          getSessionId: () => "session-484",
          getSessionFile: () => undefined,
        },
      },
    );
    const childEnvironment = JSON.parse(result.content[0].text);

    assert.equal(childEnvironment.PORT, undefined);
    assert.equal(childEnvironment.NODE_ENV, undefined);
    assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
    assert.equal(childEnvironment.NEXT_PRIVATE_WORKER, undefined);
    assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
    assert.equal(childEnvironment.PI_WEB_PASSWORD, undefined);
    assert.equal(childEnvironment.PI_SESSION_ID, "session-484");
    assert.ok(childEnvironment.PATH.split(delimiter).includes(join(getAgentDir(), "bin")));
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test(
  "agent powershell removes host variables while preserving SDK and user environment",
  { skip: powerShellAvailable() ? false : "no PowerShell executable" },
  async () => {
    const names = ["PORT", "NODE_ENV", "NEXT_RUNTIME", "NEXT_PRIVATE_WORKER", "PI_USER_SETTING", "PI_WEB_PASSWORD"];
    const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      PORT: "30141",
      NODE_ENV: "production",
      NEXT_RUNTIME: "nodejs",
      NEXT_PRIVATE_WORKER: "1",
      PI_USER_SETTING: "preserved",
      PI_WEB_PASSWORD: "web-login-password",
    });

    try {
      const extension = createProjectCommandPowerShellExtension({ cwd: process.cwd() });
      let registeredTool;
      await extension.factory({
        registerTool(tool) {
          registeredTool = tool;
        },
      });
      assert.equal(registeredTool.name, "powershell");
      assert.equal(registeredTool.defaultActive, false);

      const result = await registeredTool.execute(
        "powershell-env",
        {
          command: `node -e "console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,NEXT_PRIVATE_WORKER:process.env.NEXT_PRIVATE_WORKER,PI_USER_SETTING:process.env.PI_USER_SETTING,PI_WEB_PASSWORD:process.env.PI_WEB_PASSWORD,PI_SESSION_ID:process.env.PI_SESSION_ID,PATH:process.env.PATH}))"`,
        },
        undefined,
        undefined,
        {
          model: undefined,
          thinkingLevel: "off",
          sessionManager: {
            getSessionId: () => "session-powershell",
            getSessionFile: () => undefined,
          },
        },
      );
      const text = result.content.map((part) => part.text).join("").trim();
      const childEnvironment = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

      assert.equal(childEnvironment.PORT, undefined);
      assert.equal(childEnvironment.NODE_ENV, undefined);
      assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
      assert.equal(childEnvironment.NEXT_PRIVATE_WORKER, undefined);
      assert.equal(childEnvironment.PI_WEB_PASSWORD, undefined);
      assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
      assert.equal(childEnvironment.PI_SESSION_ID, "session-powershell");
      assert.ok(childEnvironment.PATH.split(delimiter).includes(join(getAgentDir(), "bin")));
    } finally {
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  },
);

test("agent bash reads current shell settings for every execution", async () => {
  let commandPrefix = "export PI_WEB_PREFIX=first";
  const extension = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => commandPrefix,
      getShellPath: () => undefined,
    },
  });
  let registeredTool;
  await extension.factory({
    registerTool(tool) {
      registeredTool = tool;
    },
  });
  const execute = () => registeredTool.execute(
    "settings-reload",
    { command: "printf %s \"$PI_WEB_PREFIX\"" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal((await execute()).content[0].text, "first");
  commandPrefix = "export PI_WEB_PREFIX=second";
  assert.equal((await execute()).content[0].text, "second");
});

test("direct bash removes host variables and allows explicit project values", async () => {
  const agentBinDir = join(process.cwd(), ".test-agent", "bin");
  const operations = createProjectCommandBashOperations({
    agentBinDir,
    baseEnvironment: {
      ...HOST_ENVIRONMENT,
      PATH: process.env.PATH,
      PI_SESSION_ID: "stale-host-value",
    },
    localOperations: createLocalBashOperations(),
  });
  let output = "";

  await operations.exec(
    `NODE_ENV=test PORT=3200 node -e 'console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,PI_USER_SETTING:process.env.PI_USER_SETTING,PATH:process.env.PATH}))'`,
    process.cwd(),
    { onData: (chunk) => { output += chunk.toString(); } },
  );
  const childEnvironment = JSON.parse(output);

  assert.equal(childEnvironment.PORT, "3200");
  assert.equal(childEnvironment.NODE_ENV, "test");
  assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
  assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
  assert.ok(childEnvironment.PATH.split(delimiter).includes(agentBinDir));
});

test("direct bash preserves execution controls and streaming callbacks", async () => {
  const signal = new AbortController().signal;
  let received;
  let streamed = "";
  const operations = createProjectCommandBashOperations({
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      async exec(command, cwd, options) {
        received = { command, cwd, options };
        options.onData(Buffer.from("streamed"));
        return { exitCode: 0 };
      },
    },
  });

  await operations.exec("echo ready", "/project", {
    onData: (chunk) => { streamed += chunk.toString(); },
    signal,
    timeout: 12,
  });

  assert.equal(received.command, "echo ready");
  assert.equal(received.cwd, "/project");
  assert.equal(received.options.signal, signal);
  assert.equal(received.options.timeout, 12);
  assert.equal(streamed, "streamed");
});

test("Stop releases a command whose output a surviving process keeps open", async () => {
  let forward;
  let settleLocal;
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 20,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec(_command, _cwd, options) {
        forward = options.onData;
        // Pi's backend keeps waiting while an inherited pipe is still written to.
        return new Promise((_resolve, reject) => {
          settleLocal = () => reject(new Error("aborted"));
        });
      },
    },
  });
  const controller = new AbortController();
  let streamed = "";
  const execution = operations.exec("python a.py & python b.py & wait", "/project", {
    onData: (chunk) => { streamed += chunk.toString(); },
    signal: controller.signal,
  });

  forward(Buffer.from("before "));
  controller.abort();
  forward(Buffer.from("during "));
  await assert.rejects(execution, { message: "aborted" });
  forward(Buffer.from("after"));
  // The survivor finally exits; its late settlement must go nowhere.
  settleLocal();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(streamed, process.platform === "win32"
    ? "before during \nWindows child-process cleanup could not be confirmed.\n"
    : "before during ");
});

test("Stop keeps pi's own abort result when the process tree dies in time", async () => {
  const piAbortError = new Error("aborted");
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 5_000,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec(_command, _cwd, options) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => setTimeout(() => reject(piAbortError), 10));
        });
      },
    },
  });
  const controller = new AbortController();
  const startedAt = Date.now();
  const execution = operations.exec("python a.py", "/project", {
    onData() {},
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(execution, (error) => error === piAbortError);
  assert.ok(Date.now() - startedAt < 1_000);
});

test(
  "Stop ends the bash tool while an escaped descendant keeps writing",
  { skip: process.platform === "win32", timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-bash-abort-"));
    const pidFile = join(directory, "survivor.pid");
    t.after(async () => {
      try {
        process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL");
      } catch {}
      await rm(directory, { recursive: true, force: true });
    });
    // `detached` puts the writer in its own session, out of reach of the
    // process-group kill, while it still holds the tool's stdout.
    const survivor = [
      "const { spawn } = require('node:child_process');",
      "const writer = spawn(process.execPath, ['-e', 'setInterval(() => console.log(Date.now()), 20)'],",
      "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(writer.pid));`,
      "setInterval(() => {}, 1000);",
    ].join(" ");
    const tool = createBashToolDefinition(directory, {
      operations: createProjectCommandBashOperations({ abortSettleGraceMs: 200 }),
    });
    const controller = new AbortController();
    let outputSeen;
    const outputStarted = new Promise((resolve) => { outputSeen = resolve; });
    const execution = tool.execute(
      "issue-647",
      { command: `node -e ${JSON.stringify(survivor)}` },
      controller.signal,
      (update) => {
        if (update.content[0]?.text) outputSeen();
      },
      undefined,
    );

    await outputStarted;
    const abortedAt = Date.now();
    controller.abort();
    await assert.rejects(execution, /Command aborted$/);

    assert.ok(Date.now() - abortedAt < 3_000);
    // The release came from Pi Web, not from the writer going away.
    const survivorPid = Number(await readFile(pidFile, "utf8"));
    assert.doesNotThrow(() => process.kill(survivorPid, 0));
  },
);

test("bash reports unconfirmed Windows child-process cleanup only after cancellation of a started command", async (t) => {
  const warning = "Windows child-process cleanup could not be confirmed.";
  for (const [name, platform, outcome, expectedWarning] of [
    ["abort grace expires", "win32", "pending", true],
    ["SDK aborts promptly", "win32", "aborted", true],
    ["timeout grace expires", "win32", "timeout", true],
    ["already aborted", "win32", "pre-aborted", false],
    ["ordinary failure", "win32", "failure", false],
    ["nonzero exit", "win32", "nonzero", false],
    ["POSIX abort", "linux", "aborted", false],
  ]) {
    await t.test(name, async () => {
      const controller = new AbortController();
      const timeout = outcome === "timeout" ? 0.01 : undefined;
      if (outcome === "pre-aborted") controller.abort();
      const tool = createBashToolDefinition(process.cwd(), {
        operations: createProjectCommandBashOperations({
          platform,
          abortSettleGraceMs: 5,
          localOperations: {
            async exec(_command, _cwd, { onData, signal }) {
              if (signal.aborted) throw new Error("aborted");
              onData(Buffer.from("started\n"));
              if (outcome === "failure") throw new Error("spawn failed");
              if (outcome === "nonzero") return { exitCode: 1 };
              return new Promise((_resolve, reject) => {
                if (outcome === "aborted") {
                  signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                }
              });
            },
          },
        }),
      });
      let output = "";
      const execution = tool.execute("cleanup", { command: "test command", timeout }, controller.signal,
        (update) => { output = update.content[0]?.text ?? ""; }, undefined);
      if (outcome === "pending" || outcome === "aborted") controller.abort();
      if (outcome === "nonzero") {
        const result = await execution;
        assert.match(result.content[0].text, /Command exited with code 1$/);
        assert.ok(!result.content[0].text.includes(warning));
        assert.ok(!output.includes(warning));
        return;
      }
      const status = outcome === "failure" ? /spawn failed$/
        : timeout ? /Command timed out after 0\.01 seconds$/ : /Command aborted$/;
      await assert.rejects(execution, (error) => {
        assert.match(error.message, status);
        assert.equal(error.message.split(warning).length - 1, Number(expectedWarning));
        return true;
      });
      assert.equal(output.split(warning).length - 1, Number(expectedWarning));
      if (outcome === "pre-aborted") assert.equal(output, "");
    });
  }
});

test("a cleanup warning write error does not strand an aborted command", async () => {
  const controller = new AbortController();
  let warningAttempts = 0;
  const operations = createProjectCommandBashOperations({
    platform: "win32",
    abortSettleGraceMs: 5,
    onCleanupUnconfirmed() { warningAttempts++; throw new Error("fixture disk write failed"); },
    localOperations: { async exec() { return new Promise(() => {}); } },
  });
  const chunks = [];
  const executing = operations.exec("fixture", process.cwd(), { signal: controller.signal, onData: (chunk) => chunks.push(chunk) });
  controller.abort();
  await assert.rejects(executing, { message: "aborted" });
  assert.equal(warningAttempts, 1);
  assert.match(Buffer.concat(chunks).toString(), /cleanup could not be confirmed/);
});

test("a timeout releases a command whose output a surviving process keeps open", async () => {
  let settleLocal;
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 20,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec() {
        // Pi's timeout killed the tree but an inherited pipe is still written to.
        return new Promise((_resolve, reject) => {
          settleLocal = () => reject(new Error("timeout:0.01"));
        });
      },
    },
  });

  await assert.rejects(
    operations.exec("python a.py", "/project", { onData() {}, timeout: 0.01 }),
    { message: "timeout:0.01" },
  );
  settleLocal();
  await new Promise((resolve) => setImmediate(resolve));
});

test("a command that finishes before its timeout keeps its result", async () => {
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 20,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec: async () => ({ exitCode: 0 }),
    },
  });

  assert.deepEqual(
    await operations.exec("true", "/project", { onData() {}, timeout: 0.01 }),
    { exitCode: 0 },
  );
  // Nothing may fire after the result: the timer is cleared with the release.
  await new Promise((resolve) => setTimeout(resolve, 60));
});

test(
  "a timeout ends the bash tool while an escaped descendant keeps writing",
  { skip: process.platform === "win32", timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-bash-timeout-"));
    const pidFile = join(directory, "survivor.pid");
    t.after(async () => {
      try {
        process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL");
      } catch {}
      await rm(directory, { recursive: true, force: true });
    });
    const survivor = [
      "const { spawn } = require('node:child_process');",
      "const writer = spawn(process.execPath, ['-e', 'setInterval(() => console.log(Date.now()), 20)'],",
      "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(writer.pid));`,
      "setInterval(() => {}, 1000);",
    ].join(" ");
    const tool = createBashToolDefinition(directory, {
      operations: createProjectCommandBashOperations({ abortSettleGraceMs: 200 }),
    });
    const startedAt = Date.now();

    await assert.rejects(
      tool.execute(
        "issue-647-timeout",
        { command: `node -e ${JSON.stringify(survivor)}`, timeout: 1 },
        undefined,
        undefined,
        undefined,
      ),
      /Command timed out after 1 seconds$/,
    );

    assert.ok(Date.now() - startedAt < 4_000);
    const survivorPid = Number(await readFile(pidFile, "utf8"));
    assert.doesNotThrow(() => process.kill(survivorPid, 0));
  },
);

async function captureOperationEnvironment(options) {
  let environment;
  const operations = createProjectCommandBashOperations({
    ...options,
    localOperations: {
      async exec(_command, _cwd, executionOptions) {
        environment = executionOptions.env;
        return { exitCode: 0 };
      },
    },
  });
  await operations.exec("echo ready", "/project", {
    onData() {},
  });
  return environment;
}

test("direct bash updates the platform PATH key", async () => {
  const agentBinDir = join(process.cwd(), ".test-agent", "bin");
  const cases = [
    {
      options: { agentBinDir, baseEnvironment: { Path: "project-metadata", PATH: "/usr/bin" }, platform: "linux" },
      expected: { Path: "project-metadata", PATH: `${agentBinDir}:/usr/bin` },
    },
    {
      options: {
        agentBinDir: "C:\\pi-agent\\bin",
        baseEnvironment: { Path: "C:\\Windows", git_terminal_prompt: "1", Gcm_Interactive: "always" },
        platform: "win32",
      },
      expected: {
        Path: "C:\\pi-agent\\bin;C:\\Windows",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        GCM_INTERACTIVE: "never",
        SSH_ASKPASS_REQUIRE: "force",
        SSH_ASKPASS: "NUL",
      },
    },
  ];

  for (const { options, expected } of cases) {
    assert.deepEqual(await captureOperationEnvironment(options), expected);
  }
});

test("Windows noninteractive defaults preserve case-insensitive Git SSH client overrides", async () => {
  const existing = { git_ssh_command: 'ssh -o BatchMode=yes -i existing-key', Git_Ssh_Variant: 'ssh', SSH_ASKPASS: 'interactive-helper' };
  const env = await captureOperationEnvironment({ baseEnvironment: existing, platform: 'win32' });
  assert.equal(env.git_ssh_command, existing.git_ssh_command);
  assert.equal(env.Git_Ssh_Variant, existing.Git_Ssh_Variant);
  assert.equal(env.GIT_SSH_COMMAND, undefined);
  assert.equal(env.GIT_SSH_VARIANT, undefined);
  assert.equal(env.SSH_ASKPASS, 'NUL');
  assert.equal(env.SSH_ASKPASS_REQUIRE, 'force');
});

test("a user extension keeps priority over the Pi Web fallback bash tool", async () => {
  const userBash = {
    name: "user-bash",
    factory: (pi) => {
      pi.registerTool({
        name: "bash",
        label: "user bash",
        description: "user override",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: "user override" }], details: undefined };
        },
      });
    },
  };
  const hostBash = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => undefined,
      getShellPath: () => undefined,
    },
  });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: join(process.cwd(), ".test-agent"),
    extensionFactories: [userBash, hostBash],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionsOverride: (base) => preferUserBashExtension(base),
  });
  await loader.reload();
  const extensions = loader.getExtensions();
  const bashDefinitions = extensions.extensions
    .map((extension) => extension.tools.get("bash")?.definition)
    .filter(Boolean);

  assert.equal(bashDefinitions.length, 1);
  assert.equal(bashDefinitions[0].description, "user override");
  assert.deepEqual(extensions.errors, []);
});

test("a user extension keeps priority over the Pi Web powershell tool, and only over it", async () => {
  const userPowerShell = {
    name: "user-powershell",
    factory: (pi) => {
      pi.registerTool({
        name: "powershell",
        label: "user powershell",
        description: "user override",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: "user override" }], details: undefined };
        },
      });
    },
  };
  const hostBash = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => undefined,
      getShellPath: () => undefined,
    },
  });
  const hostPowerShell = createProjectCommandPowerShellExtension({ cwd: process.cwd() });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: join(process.cwd(), ".test-agent"),
    extensionFactories: [userPowerShell, hostBash, hostPowerShell],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionsOverride: (base) => preferUserPowerShellExtension(preferUserBashExtension(base)),
  });
  await loader.reload();
  const extensions = loader.getExtensions();
  const definitions = (name) => extensions.extensions
    .map((extension) => extension.tools.get(name)?.definition)
    .filter(Boolean);

  assert.equal(definitions("powershell").length, 1);
  assert.equal(definitions("powershell")[0].description, "user override");
  // The bash override is a separate extension, so it stays.
  assert.equal(definitions("bash").length, 1);
  assert.deepEqual(extensions.errors, []);
});
