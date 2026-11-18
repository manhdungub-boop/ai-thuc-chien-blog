import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const dependencies = packageJson.devDependencies ?? {};
const errors = [];

if (packageJson.engines?.node !== ">=22 <23") {
  errors.push("Node engine must be pinned to >=22 <23");
}

for (const [name, version] of Object.entries(dependencies)) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push(\`Dependency \${name} must use an exact version, received: \${String(version)}\`);
  }
}

for (const required of ["@cloudflare/vitest-plugin", "vitest"]) {
  if (!(required in dependencies)) errors.push(\`Missing required test dependency: \${required}\`);
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(\`ERROR: \${error}\n\`);
  process.exitCode = 1;
} else {
  process.stdout.write("Direct test dependency versions are exact; Node major is constrained.\n");
}
