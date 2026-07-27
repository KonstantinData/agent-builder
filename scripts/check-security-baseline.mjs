import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const forbiddenActionReference = /uses:\s*[^\s@]+@(?![a-f0-9]{40}(?:\s|$))/;
const secretPattern = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})/;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") return [];
    return entry.isDirectory() ? files(path) : [path];
  });
}

const workflows = files(join(root, ".github", "workflows")).filter((path) => /\.ya?ml$/.test(path));
for (const path of workflows) {
  if (forbiddenActionReference.test(readFileSync(path, "utf8"))) throw new Error(`GitHub Action is not pinned by commit SHA: ${path}`);
}
for (const path of files(root)) {
  if (/\.(png|zip|lock)$/i.test(path)) continue;
  if (secretPattern.test(readFileSync(path, "utf8"))) throw new Error(`possible secret material detected: ${path}`);
}
console.log("security baseline checks passed");
