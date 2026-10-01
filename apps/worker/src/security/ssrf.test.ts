import { describe, expect, it } from "vitest";
import {
  UrlNotAllowedError,
  assertPublicUrl,
  isPublicIp,
  type Resolver,
} from "./ssrf.js";

describe("isPublicIp", () => {
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (ip) => expect(isPublicIp(ip)).toBe(true),
  );

  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // carrier-grade NAT
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254", // AWS IPv6 metadata
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1",
    "2002:7f00:1::", // 6to4 embedding 127.0.0.1
    "not-an-ip",
    "",
  ])("rejects %s", (ip) => expect(isPublicIp(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  const resolverFor =
    (map: Record<string, string[]>): Resolver =>
    async (host) =>
      map[host] ?? [];

  it("returns the parsed URL when every address is public", async () => {
    const url = await assertPublicUrl(
      "https://example.com/page",
      resolverFor({ "example.com": ["93.184.216.34", "2606:4700::1"] }),
    );
    expect(url.href).toBe("https://example.com/page");
  });

  it.each(["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)"])(
    "rejects scheme of %s",
    async (input) => {
      await expect(assertPublicUrl(input, resolverFor({}))).rejects.toThrow(
        UrlNotAllowedError,
      );
    },
  );

  it("rejects malformed URLs and embedded credentials", async () => {
    await expect(assertPublicUrl("not a url", resolverFor({}))).rejects.toThrow(
      UrlNotAllowedError,
    );
    await expect(
      assertPublicUrl("https://user:pw@example.com", resolverFor({})),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it("rejects a host when any resolved address is private", async () => {
    await expect(
      assertPublicUrl(
        "https://mixed.example",
        resolverFor({ "mixed.example": ["93.184.216.34", "10.0.0.1"] }),
      ),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it("rejects a host that does not resolve", async () => {
    await expect(
      assertPublicUrl("https://nowhere.example", resolverFor({})),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://localhost:8080/",
    "http://169.254.169.254/latest/meta-data",
    "http://2130706433/", // decimal form of 127.0.0.1
    "http://0x7f.1/", // hex/short form of 127.0.0.1
    "http://[::ffff:7f00:1]/",
  ])("rejects private target %s", async (input) => {
    // localhost resolves to loopback; IP literals never reach the resolver.
    const resolver: Resolver = async (host) =>
      host === "localhost" ? ["127.0.0.1"] : [];
    await expect(assertPublicUrl(input, resolver)).rejects.toThrow(
      UrlNotAllowedError,
    );
  });

  it("does not call the resolver for IP literals", async () => {
    const calls: string[] = [];
    const resolver: Resolver = async (host) => {
      calls.push(host);
      return ["93.184.216.34"];
    };
    await assertPublicUrl("http://93.184.216.34/", resolver);
    expect(calls).toEqual([]);
  });
});
