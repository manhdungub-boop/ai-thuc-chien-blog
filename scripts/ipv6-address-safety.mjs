import net from "node:net";

function ipv6ToBigInt(address) {
  let value = String(address).toLowerCase();
  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    if (separator < 0) return null;
    const ipv4 = value.slice(separator + 1);
    if (net.isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = value.slice(0, separator + 1) + high + ":" + low;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  return groups.reduce((result, group) => (result << 16n) | BigInt("0x" + group), 0n);
}

function inPrefixRange(value, start, end) {
  return value >= start && value < end;
}

export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a,b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0);
  }

  if (version === 6) {
    const value = ipv6ToBigInt(address);
    if (value === null) return true;

    // Accept only IPv6 global-unicast space (2000::/3), then deny
    // special-purpose and transition ranges within that allocation.
    const globalStart = 0x20000000000000000000000000000000n;
    const globalEnd = 0x40000000000000000000000000000000n;
    if (!inPrefixRange(value, globalStart, globalEnd)) return true;

    // IANA special-purpose 2001::/23 (includes Teredo and documentation /
    // protocol-assignment blocks), 6to4 2002::/16, and documentation 3fff::/20.
    const specialRanges = [
      [0x20010000000000000000000000000000n, 0x20010200000000000000000000000000n],
      [0x20020000000000000000000000000000n, 0x20030000000000000000000000000000n],
      [0x20010db8000000000000000000000000n, 0x20010db9000000000000000000000000n],
      [0x3fff0000000000000000000000000000n, 0x3fff1000000000000000000000000000n]
    ];
    return specialRanges.some(([start, end]) => inPrefixRange(value, start, end));
  }

  return true;
}
