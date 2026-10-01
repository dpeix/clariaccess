import { createHash } from "node:crypto";
import type { NodeResult } from "axe-core";

export const SELECTOR_SEPARATOR = " >> ";

// axe targets are nested arrays when the node lives in an iframe or shadow root.
export function normalizeSelector(target: NodeResult["target"]): string {
  const parts = (target as unknown[])
    .flat(Infinity)
    .map((part) => String(part).replace(/\s+/g, " ").trim());
  return parts.join(SELECTOR_SEPARATOR);
}

export interface FingerprintInput {
  ruleId: string;
  selector: string;
  templateKey: string | null;
}

// Identity of a problem across audits: rule + selector + page template.
// JSON encoding keeps field boundaries unambiguous before hashing.
export function fingerprint(input: FingerprintInput): string {
  const payload = JSON.stringify([
    input.ruleId,
    input.selector,
    input.templateKey ?? "",
  ]);
  return createHash("sha256").update(payload).digest("hex");
}
