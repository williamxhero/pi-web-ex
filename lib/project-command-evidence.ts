// Host-written session entries, separate from extension tool results or displayed output.
export const PROJECT_COMMAND_CLEANUP_UNCONFIRMED = "pi-web:project-command-cleanup-unconfirmed";
export const PROJECT_COMMAND_OUTCOME = "pi-web:project-command-outcome";

export type ProjectCommandOutcome = { key: string; exitCode?: number; failed: boolean };
type Session = object;
type LiveEvidence = { outcomes: Map<string, ProjectCommandOutcome>; cleanupUnconfirmed: boolean };
const runs = new WeakMap<Session, LiveEvidence>();

export function beginProjectCommandRun(session: Session): void {
  if (!runs.has(session)) runs.set(session, { outcomes: new Map(), cleanupUnconfirmed: false });
}

export function takeProjectCommandRun(session: Session): LiveEvidence | undefined {
  const run = runs.get(session);
  runs.delete(session);
  return run;
}

/** Keep live evidence before writing it: disk diagnostics cannot decide a running command's outcome. */
export function projectCommandEvidence(session: Session | undefined, append: (type: string, data?: unknown) => void) {
  return {
    record(outcome: ProjectCommandOutcome): void {
      if (session) runs.get(session)?.outcomes.set(outcome.key, outcome);
      append(PROJECT_COMMAND_OUTCOME, outcome);
    },
    cleanupUnconfirmed(): void {
      const live = session && runs.get(session);
      if (live) live.cleanupUnconfirmed = true;
      append(PROJECT_COMMAND_CLEANUP_UNCONFIRMED);
    },
  };
}
