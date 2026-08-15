/**
 * Deterministic PRNG utilities shared by every synthetic telemetry
 * generator (src/telemetry/experimentGenerator.ts, Experiment A's
 * five-phase cohort; src/telemetry/stableProcessGenerator.ts, Experiment
 * B's stable-process cohort). Extracted so both generators use the exact
 * same seeding/sampling mechanics instead of two copies drifting apart --
 * pure functions, no I/O, entirely unrelated to and never imported by any
 * SPC or gate calculation.
 */

/** mulberry32: a small, standard, seedable PRNG (public domain). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard Box-Muller transform, driven entirely by the seeded uniform generator above -- deterministic given the same seed and call order. */
export function nextGaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** round(mean + spread * gaussian), clamped to >= 0 -- the shared sampling primitive for a synthetic severity count. */
export function sampleCount(rand: () => number, mean: number, spread: number): number {
  const raw = mean + spread * nextGaussian(rand);
  return Math.max(0, Math.round(raw));
}
