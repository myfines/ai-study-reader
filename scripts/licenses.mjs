import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
for (const folder of ["standard_fonts", "cmaps", "wasm"]) {
  const dir = `node_modules/pdfjs-dist/${folder}`;
  await mkdir("licenses", { recursive: true });
  for (const file of await readdir(dir))
    if (/^(license|licence|notice)/i.test(file)) await cpNotice(dir, file);
}
async function cpNotice(dir, file) {
  await writeFile(
    `licenses/pdfjs-${path.basename(dir)}-${file}.txt`,
    await readFile(path.join(dir, file)),
  );
}
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
await mkdir("licenses", { recursive: true });
const rows = [];
for (const [folder, entry] of Object.entries(lock.packages)) {
  if (!folder) continue;
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(folder, "package.json"), "utf8"));
  } catch {
    continue;
  }
  rows.push([
    pkg.name,
    pkg.version,
    typeof pkg.license === "object"
      ? pkg.license.type
      : pkg.license || entry.license || "UNKNOWN",
  ]);
  const notices = (await readdir(folder)).filter((n) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(n),
  );
  for (const n of notices) {
    const text = await readFile(path.join(folder, n), "utf8").catch(() => null);
    if (text !== null)
      await writeFile(
        path.join(
          "licenses",
          `${pkg.name.replace(/[@/]/g, "_")}-${pkg.version}-${n.replace(/[^a-z0-9.-]/gi, "_")}.txt`,
        ),
        text,
      );
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
await writeFile(
  "DEPENDENCY-LICENSES.md",
  "# Dependency licenses\n\nGenerated from installed npm packages and package-lock.json. Full notices are in licenses/. Rust dependency inventory: RUST-LICENSES.md.\n\n| Package | Version | License |\n|---|---|---|\n" +
    rows.map((r) => `| ${r.join(" | ")} |`).join("\n") +
    "\n",
);
console.log(
  `Recorded ${rows.length} npm dependencies and available full notices.`,
);
