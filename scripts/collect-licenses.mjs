import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const root = process.cwd(),
  out = path.join(root, "assets/licenses");
fs.mkdirSync(out, { recursive: true });
function notices(dirs) {
  return dirs
    .flatMap((dir) => {
      if (!fs.existsSync(dir)) return [];
      const files = fs
        .readdirSync(dir)
        .filter(
          (f) =>
            /^(license|licence|copying|notice)(?:[.\-_]|$)/i.test(f) &&
            fs.statSync(path.join(dir, f)).isFile(),
        );
      let name = path.basename(dir);
      try {
        const p = JSON.parse(
          fs.readFileSync(path.join(dir, "package.json"), "utf8"),
        );
        name = `${p.name} ${p.version} (${p.license ?? ""})`;
      } catch {}
      return files.map(
        (f) =>
          `\n${"=".repeat(72)}\n${name} — ${f}\n${"=".repeat(72)}\n${fs.readFileSync(path.join(dir, f), "utf8")}\n`,
      );
    })
    .join("\n");
}
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
fs.writeFileSync(
  path.join(out, "javascript-notices.txt"),
  notices(
    Object.keys(lock.packages)
      .filter((p) => p.startsWith("node_modules/"))
      .map((p) => path.join(root, p)),
  ),
);
const cargoRoot = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"),
  registry = path.join(cargoRoot, "registry/src");
if (fs.existsSync(registry)) {
  const dirs = fs
    .readdirSync(registry)
    .flatMap((r) =>
      fs
        .readdirSync(path.join(registry, r))
        .map((d) => path.join(registry, r, d)),
    );
  fs.writeFileSync(path.join(out, "rust-notices.txt"), notices(dirs));
}
process.stdout.write("Collected third-party notices.\n");
