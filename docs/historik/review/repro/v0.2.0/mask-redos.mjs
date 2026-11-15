const { maskSecrets } = await import(process.argv[2]);
import crypto from "node:crypto";
for (const [name, s] of [["a*100k", "a".repeat(100000)], ["base64url 100k random", crypto.randomBytes(75000).toString("base64url")], ["hex 100k", crypto.randomBytes(50000).toString("hex")]]) {
  const t = performance.now(); maskSecrets(s); console.log(name, (performance.now() - t).toFixed(0), "ms");
}
