import assert from "node:assert/strict";
import { isPrivateAddress } from "./ipv6-address-safety.mjs";

const cases = [
  ["127.0.0.1", true, "IPv4 loopback"],
  ["10.1.2.3", true, "IPv4 private"],
  ["8.8.8.8", false, "public IPv4"],
  ["192.88.99.1", true, "deprecated 6to4 relay anycast"],
  ["::", true, "IPv6 unspecified"],
  ["::1", true, "IPv6 loopback"],
  ["fc00::1", true, "IPv6 unique-local"],
  ["fe80::1", true, "IPv6 link-local"],
  ["ff02::1", true, "IPv6 multicast"],
  ["::ffff:8.8.8.8", true, "IPv4-mapped IPv6"],
  ["64:ff9b::808:808", true, "well-known NAT64 translation"],
  ["64:ff9b:1::808:808", true, "local-use NAT64 translation"],
  ["2002:0808:0808::1", true, "6to4 transition"],
  ["2001:0000:4136:e378:8000:63bf:3fff:fdd2", true, "Teredo transition"],
  ["2001:db8::1", true, "IPv6 documentation"],
  ["3fff::1", true, "IPv6 documentation allocation"],
  ["2001:4860:4860::8888", false, "public IPv6 DNS address"],
  ["2606:4700:4700::1111", false, "public IPv6 CDN address"]
];

for (const [address, expected, description] of cases) {
  assert.equal(isPrivateAddress(address), expected, description + " (" + address + ")");
}
console.log("PASS: " + cases.length + " offline IP-address safety regression cases.");
