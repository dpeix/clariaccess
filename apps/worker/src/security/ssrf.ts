import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class UrlNotAllowedError extends Error {
  constructor(
    readonly target: string,
    reason = "not allowed",
    options?: ErrorOptions,
  ) {
    super(`URL ${reason}: ${target}`, options);
    this.name = "UrlNotAllowedError";
  }
}

// Resolves a hostname to every address it points to.
export type Resolver = (hostname: string) => Promise<string[]>;

// Checked by the browser for every request it makes (redirects, subresources).
export type UrlGuard = (url: string) => Promise<unknown>;

export const dnsResolver: Resolver = async (hostname) => {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    // Unresolvable hosts are rejected by the caller (empty list).
    return [];
  }
};

// Only globally routable unicast addresses are allowed: everything else
// (loopback, private, link-local incl. cloud metadata, CGNAT, multicast,
// reserved, 6to4/teredo tunnels, ...) is refused.
export function isPublicIp(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (
    parsed.kind() === "ipv6" &&
    (parsed as ipaddr.IPv6).isIPv4MappedAddress()
  ) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
}

export async function assertPublicUrl(
  input: string,
  resolver: Resolver = dnsResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new UrlNotAllowedError(input, "is malformed", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlNotAllowedError(input, "has an unsupported scheme");
  }
  if (url.username !== "" || url.password !== "") {
    throw new UrlNotAllowedError(input, "contains credentials");
  }

  // WHATWG parsing already canonicalises 2130706433 / 0x7f.1 to 127.0.0.1.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(hostname)
    ? [hostname]
    : await resolver(hostname);

  if (addresses.length === 0) {
    throw new UrlNotAllowedError(input, "does not resolve");
  }
  if (!addresses.every(isPublicIp)) {
    throw new UrlNotAllowedError(input, "targets a non-public address");
  }
  return url;
}
