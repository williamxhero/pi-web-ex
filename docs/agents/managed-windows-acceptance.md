# Acceptance: managed Windows automation

Use this runbook when moving a validation job to a managed Agent, or when a Windows subprocess may open a desktop window. See the [managed delegation guide](subagents.md#managed-delegation-operator-and-agent-guide) for normal operation. These checks exercise an isolated test server; they do not change global Agent settings, a production service, or a scheduled task.

## Migrate a project check

1. Freeze the input revision and test name. For the [pi-nf](https://github.com/williamxhero/pi-needs-forever) sample, the `stale closed child` regression lives in the [T44 checkout](https://github.com/williamxhero/pi-needs-forever/issues/44), not necessarily on main. Export the authorized revision with `git archive <revision> pi-nf` and extract it under a new scratch directory. Compile in that copy with the package's locked dependencies. Never build or clean another worker's checkout. Record the source SHA, scoped launch-option changes, and build command.
2. Replace the old standalone validation-agent wrapper with a named background `Agent` from its parent session. Give the child just the PowerShell or Bash permission it needs. Its shell runs the bounded validation command **in the foreground within that child**. Use the existing parent **Agents** list and Stop. If the built-in tool is disabled or cannot register, report that limitation or run an appropriate short command in the current session and wait. Do not start a fallback Pi process. This migrates the validation invocation, not NF's formal durable Handoff.
3. Fix the actual launches within the test and project-owned code. For Node direct Git calls, pass an argument array to `execFile` or `execFileSync`, with `shell: false` and `windowsHide: true`; preserve cwd, timeouts, pipe output and errors. Apply the same policy to nested launchers. In a noninteractive Git environment disable terminal and credential-manager prompts; if authentication is needed, record the failure instead of starting a browser. Hiding the parent is not proof about its children.
4. For the T44 sample choose the single compiled test via `node --test --test-concurrency=1 --test-name-pattern="stale closed child" dist/test/current-spec-implementation.test.js`. Run through a local fixture runner that keeps stdout/stderr and propagates the exit code. Use a fresh allocation with the test temp directory directly below it, an isolated Git/agent home, fixture-only GitHub and a loopback-only model; permit Git's file protocol only. Supply the authorized installed Pi host and skill root using T44's documented fixture environment. Set `NF43_ALLOCATION` and `NF44_ALLOCATION` to the allocation and `NF_REQUIRE_INSTALLED_PI_TEST=1`; skip is not a pass. The runner should report `T44 selected test exit 0` only after the selected test passes and return its actual exit code. A PowerShell wrapper must use `exit $LASTEXITCODE` after the native command.

External launchers, third-party GUI applications and Task Scheduler are not covered by this migration. A user deliberately opening a browser or terminal is not an automation failure.

## Collect desktop and session evidence

Use an elevated Windows PowerShell on a logged-in desktop in a separate Pi Web checkout, with locked local dependencies (`npm ci`) and Playwright Chromium already available. Close or wait out unrelated validators if attribution is unclear; never terminate another worker. The probe uses a temporary ETW session and does not enable a permanent audit policy. Keep raw traces local: they contain process metadata for the machine, not just the test. Use new trace output paths. The CLI allocates an exclusive `run-*` directory inside `PI_WEB_ACCEPTANCE_OUTPUT` and prints that directory; keep its server log with the matching desktop evidence.

~~~powershell
$evidence = Join-Path $env:TEMP ('pi-web-windows-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$node = (Get-Command node).Source
$env:PI_WEB_ACCEPTANCE_OUTPUT = "$evidence/project-logs"
& powershell.exe -NoProfile -File e2e/windows-desktop-trace.ps1 -Control -OutputDirectory "$evidence/control"
if ($LASTEXITCODE) { throw 'Console positive control did not pass' }
& powershell.exe -NoProfile -File e2e/windows-desktop-trace.ps1 -TaskbarControl -OutputDirectory "$evidence/taskbar-control"
if ($LASTEXITCODE) { throw 'Taskbar positive control did not pass' }
foreach ($mode in 'success','failure','interaction','stop','restart','restart-cleanup') {
  & powershell.exe -NoProfile -File e2e/windows-desktop-trace.ps1 -Executable $node -Arguments "e2e/managed-windows.mjs $mode" -OutputDirectory "$evidence/$mode"
  if ($LASTEXITCODE) { throw "Acceptance failed: $mode" }
}
# Set PI_WEB_ACCEPTANCE_T44_RUNNER to the absolute path of the prepared local runner.
& powershell.exe -NoProfile -File e2e/windows-desktop-trace.ps1 -Executable $node -Arguments 'e2e/managed-windows.mjs t44' -OutputDirectory "$evidence/t44"
if ($LASTEXITCODE) { throw 'T44 acceptance failed' }
~~~

The control intentionally shows one console; require both a show and a focus event from its process instance. The ordinary-project modes run Git, CMD and PowerShell, assert a persisted deliberate failure with stdout/stderr/exit 7, and assert the child row is failed rather than completed, even after a normal assistant summary. The stop probe exercises **Agents** reload and Stop in Playwright. An unconfirmed Windows cleanup stays visible alongside the cancellation; the separate process checks verify the test's shell and Node descendant actually exited. The Stop case checks that both the shell and its Node descendant exited and that an independent, separately started Node process stayed alive. `interaction` uses a loopback Git server that actually returns an HTTP Basic authentication challenge; Git must fail explicitly with terminal prompts disabled, not timeout or open a login UI. `restart-cleanup` starts a fresh isolated server from the exact persisted prefix ending at the cleanup warning, with no finalized run entry, and checks the real Agents row. Only outcomes from Pi Web's own shell execution are used for managed command status. An exact retry in the same shell and directory supersedes that command's prior failure; a different successful command does not. The headless Playwright browser is deliberate; success, failure and T44 should start no browser. Keep the command's stdout/stderr, JSON summary, window CSV, owned-process CSV, and ETL. For a passing run require zero attributed visible windows, focus events, ambiguous console events and missing owned exit events. Correlate Windows process sequence numbers and lifetimes, never a bare PID; an ambiguous console event requires a repeat, not subtraction from the count.

**Taskbar and activation:** The shell hook captures taskbar window creation and flash notifications separately from WinEvent show/focus. The taskbar control must produce both notifications. The trace records common headed browser process starts and show/focus events for browser window classes, plus a before/after process-instance inventory. An event in an already-running browser may be incidental or an activation brokered by Windows; without independent attribution, repeat on a logged-in desktop where no unrelated browser is active. Do not infer a pass from the absence of new browser processes alone.

## Evidence: Pi Web Ex #1 / #4

Windows logged-in desktop, Next 16.4.6, runtime candidate `d1dc46fe916120c02f060381533539f8820745c9`; T44 sample from `2b525d69917c42889ae0746808db5b2685a59fa2` in an exported, patched copy. The commands used a loopback fixture model, not a live external model. No existing NF worktree was changed.

| Run | Evidence | Visible | Focus | Owned processes missing exit |
| --- | --- | ---: | ---: | ---: |
| Console control | Command exit 0; visible and focus belong to the same process instance | 1 | 1 | 0 |
| Taskbar control | Deliberate window created one taskbar add and four flash notifications | 1 | 1 | 0 |
| Ordinary project: success | Managed PowerShell → Git/CMD; both outputs persisted; no browser process | 0 | 0 | 0 |
| Ordinary project: failure | Both streams and exit 7 in the child transcript; no browser process | 0 | 0 | 0 |
| Ordinary project: Stop | Parent idle; child visible after reload; browser Stop killed the shell and nested Node; headless browser was the test driver | 0 | 0 | 0 |
| Isolated Next restart | A live child read back as interrupted, not active; shell and its Node descendant had exited | 0 | 0 | 0 |
| T44 sample | Selected regression 1/1 passed; exit 0 persisted; 2,813 Git processes, no browser process | 0 | 0 | 0 |

An independent earlier T44 capture counted 2,845 Git starts, zero attributed show/focus events and no unmatched console events; it attributed 135 shows and 134 focus events to a concurrent, unrelated NF run. The versioned experiment above rechecked the ordinary project and T44 using the reusable probe. The shell-hook rerun saw zero attributed taskbar additions or flashes across the ordinary project and T44. The ordinary-project runs also passed the browser check (only the intentional headless test driver started in the Stop case). In the latest T44 run the selected case and taskbar checks passed and no browser process started, but the probe recorded 12 show/focus events in two pre-existing browser processes. The before/after browser instance inventory did not change. Those events lack causal attribution, so the full T44 browser-activation gate remains open pending a browser-quiescent logged-in desktop. The restart used only the probe's own Next process tree and reused its isolated session directory. Its probe was introduced in `1175797a5ab8e4aa856ab8fa8a2d5ee1e659b349`; the runtime code did not change between that commit and `d1dc46f`.

The following artifact names refer to sanitized local acceptance summaries; binary ETL and raw desktop metadata stay out of Git:

| Run | Summary SHA-256 |
| --- | --- |
| `shell-hook-control-1` | `42A474236724194603FFAFD365E5F9E140FC9E6E78951AC271191ED2ACF2B721` |
| `shell-hook-success-1` | `BA0AF160AC67B8EA4DB28C107704ACF2E56A894D8A5C809646048E43ED2E69D8` |
| `shell-hook-failure-1` | `EF77F26A112753DAC8034FF6194961BEE4848512231DA16A03F1029E57212FDC` |
| `shell-hook-stop-1` | `C3A8EDE1BFAAFE6870FB29D81278B4A69538FA68D881B9446EF7B8D9594C6FC1` |
| `shell-hook-restart-1` | `FDA21DA6B69E50F318DD6535FF1ADD5A0B408725FB8EF536D788722C9C77E6E4` |
| `shell-hook-t44-quiet-slot` (T44 case passes; browser gate exits 12) | `38D6847E4493337329B0601A8C49D3C20EDAA6C28F2C51B27130D577E55A1BEF` |
