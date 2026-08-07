import { CapabilityResult } from './types';

/**
 * One-sided process capability, per ARCHITECTURE.md SS8.4. Given an
 * organizationally agreed Upper Specification Limit (USL -- e.g. "no more
 * than 40 weighted defect points is tolerable"), Cpu asks a different
 * question than the control chart does: not "is this build unusual for
 * *this* process" but "is this process, even when perfectly stable, able
 * to reliably stay under the specification at all."
 *
 *   Cpu = (USL - X-bar) / (3 * sigma-hat)
 *
 * Cpu >= 1.33 is conventionally "capable" (comfortable margin to the
 * spec limit). Cpu < 1.0 means that even a process with zero special-
 * cause variation -- i.e. one that passes every WECO/Nelson rule -- will
 * still routinely exceed the specification, because the spec sits too
 * close to (or below) the process's natural 3-sigma spread. That is a
 * signal about the *baseline or the policy*, not about any individual
 * build: no amount of chasing individual out-of-control points fixes a
 * Cpu < 1.0 process; the center line itself has to come down.
 */
export function analyzeCapability(centerLine: number, sigma: number, usl: number | undefined): CapabilityResult {
  if (usl === undefined) {
    return { usl: null, cpu: null, capable: null };
  }

  if (sigma === 0) {
    // A perfectly flat series (sigma-hat = 0) is trivially "capable" as
    // long as the flat value itself doesn't already exceed the spec --
    // Cpu is undefined (division by zero) so it's reported as null rather
    // than +/-Infinity.
    return { usl, cpu: null, capable: centerLine <= usl };
  }

  const cpu = (usl - centerLine) / (3 * sigma);
  return { usl, cpu, capable: cpu >= 1.33 };
}
