import fs from "node:fs";

const dataDir = process.argv[2];
const readyFile = process.argv[3];
const goFile = process.argv[4];
const resultFile = process.argv[5];
const busyFile = process.argv[6];
const staleMs = Number(process.argv[7] ?? 2_000);

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
    async (signal) => {
      const aborted = () => {
        const error = new Error("runtime install lock lost");
        try {
          fs.rmSync(busyFile, { force: true });
        } catch {
          /* best-effort */
        }
        throw error;
      };
      if (signal.aborted) aborted();
      try {
        fs.writeFileSync(busyFile, `${process.pid}`, { flag: "wx" });
      } catch {
        fs.writeFileSync(resultFile, "OVERLAP\n");
        return;
      }
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, 150)),
        new Promise((_, reject) => {
          const fail = () => reject(new Error("runtime install lock lost"));
          if (signal.aborted) fail();
          signal.addEventListener("abort", fail, { once: true });
        })
      ]);
      const owner = fs.readFileSync(busyFile, "utf8");
      fs.rmSync(busyFile, { force: true });
      if (owner !== `${process.pid}`) {
        fs.writeFileSync(resultFile, "OVERLAP\n");
        return;
      }
      fs.writeFileSync(resultFile, "OK\n");
    },
    { staleMs, heartbeatMs: 40, timeoutMs: 8_000 }
  );
} catch (error) {
  try {
    fs.rmSync(busyFile, { force: true });
  } catch {
    /* best-effort */
  }
  fs.writeFileSync(resultFile, `ERROR:${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
