import fs from "node:fs";

const dataDir = process.argv[2];
const readyFile = process.argv[3];
const goFile = process.argv[4];
const resultFile = process.argv[5];
const busyFile = process.argv[6];
const staleMs = Number(process.argv[7] ?? 50);

const { withInstallLock } = await import("../../packages/runtime-host/dist/runtimeStateStore.js");

fs.writeFileSync(readyFile, `${process.pid}\n`);
const waitStarted = Date.now();
while (!fs.existsSync(goFile)) {
  if (Date.now() - waitStarted > 10_000) {
    fs.writeFileSync(resultFile, "TIMEOUT_GO\n");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}

try {
  await withInstallLock(
    dataDir,
    async () => {
      try {
        fs.writeFileSync(busyFile, `${process.pid}`, { flag: "wx" });
      } catch {
        fs.writeFileSync(resultFile, "OVERLAP\n");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      const owner = fs.readFileSync(busyFile, "utf8");
      fs.rmSync(busyFile, { force: true });
      if (owner !== `${process.pid}`) {
        fs.writeFileSync(resultFile, "OVERLAP\n");
        return;
      }
      fs.writeFileSync(resultFile, "OK\n");
    },
    { staleMs, heartbeatMs: 0, timeoutMs: 8_000 }
  );
} catch (error) {
  fs.writeFileSync(resultFile, `ERROR:${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
