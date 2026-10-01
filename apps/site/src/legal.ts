export const PLACEHOLDER = "À COMPLÉTER";

// Single source for the legal pages. Real values come from the publisher
// (company registration, host contract): they must not be invented, so the
// production build refuses to run while a placeholder remains.
export const legal = {
  companyName: PLACEHOLDER,
  legalForm: PLACEHOLDER,
  siren: PLACEHOLDER,
  address: PLACEHOLDER,
  publisher: PLACEHOLDER,
  hostName: PLACEHOLDER,
  hostAddress: PLACEHOLDER,
  contactEmail: PLACEHOLDER,
  dpoEmail: PLACEHOLDER,
  mailProvider: PLACEHOLDER,
  dataRetention: PLACEHOLDER,
};

export type LegalInfo = typeof legal;

export function findPlaceholders(info: LegalInfo): string[] {
  return Object.entries(info)
    .filter(([, value]) => value.trim() === "" || value === PLACEHOLDER)
    .map(([key]) => key);
}

export function assertLegalComplete(
  info: LegalInfo,
  siteEnv: string | undefined,
): void {
  if (siteEnv !== "production") return;
  const missing = findPlaceholders(info);
  if (missing.length > 0) {
    throw new Error(
      `Legal information still to be filled in (src/legal.ts): ${missing.join(", ")}`,
    );
  }
}
