import type { LoopPhase } from "@/lib/loop-to-done-toolbar";
import styles from "./LoopPhaseIcon.module.css";

export function LoopPhaseIcon({ phase }: { phase: LoopPhase }) {
  const shapes = {
    off: <circle cx="10" cy="10" r="6" />,
    task: <><path d="M3 4h14v10H8l-4 3v-3H3z" />{[6,10,14].map((x,i)=><circle key={x} cx={x} cy="9" r="1" fill="currentColor" stroke="none" className={styles.dot} style={{animationDelay: i * -0.16 + 's'}} />)}</>,
    turn: <g className={styles.hourglass}><path d="M5 3h10c0 4-2 5-5 7 3 2 5 3 5 7H5c0-4 2-5 5-7-3-2-5-3-5-7Z" /></g>,
    judging: <path className={styles.spin} d="M16 10a6 6 0 1 1-6-6" />,
    sent: <path className={styles.arrow} d="M3 10h12m-5-5 5 5-5 5" />,
    retry: <g className={styles.retry}><path d="M15 7a6 6 0 1 0 1 6M16 3v5h-5" /></g>,
    completed: <path d="m3 10 4 4 10-9" />,
    blocked: <><circle cx="10" cy="10" r="7" /><path d="m5 5 10 10" /></>,
    stopped: <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" />,
  };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" data-loop-phase={phase}>{shapes[phase]}</svg>;
}
