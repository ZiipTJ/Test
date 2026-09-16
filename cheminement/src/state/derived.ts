/** Résultats dérivés du projet, mémorisés sur l'identité de l'objet projet.
 *  Immer produit un nouvel objet à chaque modification : comparer les références
 *  suffit donc, et tant que rien ne bouge on ne recalcule rien. */
import { buildBom, buildCutList, type BomLine, type CutListRow } from '../core/harness/bom';
import { runChecks, summarizeChecks, type CheckItem, type Severity } from '../core/harness/checks';
import { flattenHarness, type FlatLayout } from '../core/harness/flatten';
import { computeHarness, type HarnessComputation } from '../core/harness/routing';
import type { HarnessProject } from '../core/harness/types';

export interface DerivedResult {
  computation: HarnessComputation;
  checks: CheckItem[];
  checkSummary: Record<Severity, number>;
  cutList: CutListRow[];
  bom: BomLine[];
  flatten: FlatLayout;
}

let cached: { project: HarnessProject; result: DerivedResult } | null = null;

export function deriveAll(project: HarnessProject): DerivedResult {
  if (cached && cached.project === project) return cached.result;
  const computation = computeHarness(project);
  const checks = runChecks(project, computation);
  const result: DerivedResult = {
    computation,
    checks,
    checkSummary: summarizeChecks(checks),
    cutList: buildCutList(project, computation),
    bom: buildBom(project, computation),
    flatten: flattenHarness(project, computation),
  };
  cached = { project, result };
  return result;
}
