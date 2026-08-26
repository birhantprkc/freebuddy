import path from "node:path";
import { app } from "electron";

export function bundledRuntimePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "runtime-bundled");
  }
  return path.join(process.cwd(), ".build", "runtime-pack");
}
