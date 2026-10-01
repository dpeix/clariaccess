// How a customer proves they own a site. Shared by the API (instructions shown
// to the customer) and the worker (the check), so both always agree.

const PROOF_PREFIX = "clariaccess-verify=";

export interface VerificationInstructions {
  dnsRecord: { type: "TXT"; name: string; value: string };
  file: { path: string; content: string };
}

export function verificationInstructions(
  baseUrl: string,
  token: string,
): VerificationInstructions {
  const proof = `${PROOF_PREFIX}${token}`;
  return {
    dnsRecord: {
      type: "TXT",
      // hostname excludes the port: DNS knows nothing about it.
      name: `_clariaccess.${new URL(baseUrl).hostname}`,
      value: proof,
    },
    file: { path: `/.well-known/clariaccess-${token}.txt`, content: proof },
  };
}
