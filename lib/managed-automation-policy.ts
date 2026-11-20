// Loaded for Pi Web project agents even when the built-in Agent tool is disabled.
export const MANAGED_AUTOMATION_POLICY = [
  "Pi Web managed automation policy:",
  "Use the built-in managed Agent for independent work so it can be seen and stopped in the Agents panel. If it is unavailable, disabled, or dispatch fails, do not launch a separate Pi, detached agent, or no-session fallback. Run a suitable short command in this session and wait for it if authorized; otherwise report that delegation is unavailable.",
  "On Windows, start owned automation commands and each nested launcher without a visible console. Keep command output and the exit result, and do not start an interactive prompt or browser to recover an authentication failure. Report any cleanup that cannot be confirmed.",
].join("\n");
