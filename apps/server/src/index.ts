import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { SqliteWardSenRepository } from "@wardsen/database";

async function main() {
  const dataRoot = process.env.WARDSEN_DATA_DIR ?? path.join(process.cwd(), ".wardsen-data");
  fs.mkdirSync(path.join(dataRoot, "profiles"), { recursive: true });
  const repository = new SqliteWardSenRepository(path.join(dataRoot, "wardsen.sqlite"));
  const app = await buildApp({ repository, profileRoot: path.join(dataRoot, "profiles") });
  const port = Number(process.env.WARDSEN_PORT ?? 4777);

  app.addHook("onClose", async () => {
    repository.close();
  });

  await app.listen({ host: "127.0.0.1", port });
  console.log(`WardSen listening on http://127.0.0.1:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
