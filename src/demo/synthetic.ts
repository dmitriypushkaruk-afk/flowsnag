import type { XrayEvent } from '../core/types';

/**
 * Synthetic, clearly labelled demo: a software team's board, 400 issues over ~6 months.
 * Built in code with a fixed seed so the demo is identical for every visitor and every test run.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;

export function softwareTeamDemo(caseCount = 400, seed = 42): XrayEvent[] {
  const r = rng(seed);
  /** Log-normal-ish duration around a median, in hours. */
  const wait = (medianH: number, spread = 0.9) => {
    const u = Math.max(1e-9, r());
    const v = r();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.exp(Math.log(medianH) + spread * z) * HOUR;
  };
  const types = ['Story', 'Bug', 'Task'];
  const priorities = ['High', 'Medium', 'Low'];
  const start0 = Date.UTC(2026, 4, 1, 8);
  const events: XrayEvent[] = [];

  for (let i = 0; i < caseCount; i++) {
    const caseId = `DEMO-${1000 + i}`;
    const type = types[Math.floor(r() * (r() < 0.5 ? 1 : 3))]!;
    const attrs = { type, priority: priorities[Math.floor(r() * 3)]! };
    let t = start0 + r() * 170 * 24 * HOUR;
    const push = (activity: string) => events.push({ caseId, activity, timestamp: Math.round(t), attrs });

    push('To Do');
    if (r() < 0.05) {
      t += wait(200, 0.7);
      push("Won't Do");
      continue;
    }
    t += wait(type === 'Bug' ? 8 : 20, 1.0); // backlog
    push('In Progress');
    if (r() < 0.1) {
      t += wait(16);
      push('Blocked');
      t += wait(70, 0.8);
      push('In Progress');
    }
    let rounds = 0;
    for (;;) {
      t += wait(type === 'Task' ? 10 : 22);
      const skipReview = rounds === 0 && r() < 0.12;
      if (!skipReview) {
        push('Code Review');
        t += wait(40, 1.0); // the bottleneck: reviews wait
        if (r() < (rounds === 0 ? 0.18 : 0.06)) {
          push('In Progress');
          rounds++;
          continue;
        }
      }
      push('QA');
      t += wait(14, 0.8);
      if (r() < (rounds < 2 ? 0.2 : 0.05)) {
        push('In Progress');
        rounds++;
        continue;
      }
      break;
    }
    push('Done');
  }
  return events;
}
