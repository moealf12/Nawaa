import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicHttpsTarget } from "../server/url-resolver.mjs";

// Literal-IP resolution does not connect to any target or probe a real network.
// The resolver must reject non-public special-use targets before socket creation.
test("P1 acquisition target policy rejects benchmark and documentation IPv4 networks", async () => {
  for (const ip of [
    "198.18.0.1", "198.19.255.255",
    "192.0.2.1", "198.51.100.1", "203.0.113.1",
  ]) {
    await assert.rejects(
      resolvePublicHttpsTarget(`https://${ip}/product`),
      /Private\/internal addresses are not allowed/,
      `special-use IPv4 target accepted: ${ip}`,
    );
  }
});

test("P1 acquisition target policy rejects 6to4 and Teredo IPv6 transition targets", async () => {
  for (const ip of ["2002:a00:1::1", "2001::1", "2001:0:abcd::1"]) {
    await assert.rejects(
      resolvePublicHttpsTarget(`https://[${ip}]/product`),
      /Private\/internal addresses are not allowed/,
      `IPv6 transition target accepted: ${ip}`,
    );
  }
});

test("P1 acquisition target policy preserves ordinary public IPv4 and IPv6 targets", async () => {
  for (const ip of ["8.8.8.8", "1.1.1.1"]) {
    const target = await resolvePublicHttpsTarget(`https://${ip}/product`);
    assert.equal(target.address, ip);
    assert.equal(target.family, 4);
  }
  const ipv6 = "2606:4700:4700::1111";
  const target = await resolvePublicHttpsTarget(`https://[${ipv6}]/product`);
  assert.equal(target.address, ipv6);
  assert.equal(target.family, 6);
});
