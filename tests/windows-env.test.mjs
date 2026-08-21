import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  mergeWindowsPath,
  parseWindowsShellCommandOutput,
  parseWindowsWhereOutput,
  resolveWindowsPowerShell,
  windowsInstallInvocation
} from "../dist-electron/cli/windowsEnv.js";

const POWERSHELL_51 =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const PWSH7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

function filesExist(...paths) {
  const existing = new Set(paths.map((value) => value.toLowerCase()));
  return (candidate) => existing.has(candidate.toLowerCase());
}

test("mergeWindowsPath prefers fresh entries and removes case-insensitive duplicates", () => {
  assert.equal(
    mergeWindowsPath(
      "C:\\Program Files\\nodejs;C:\\Users\\Ada\\AppData\\Roaming\\npm",
      "c:\\program files\\nodejs\\;C:\\Windows\\System32"
    ),
    "C:\\Program Files\\nodejs;C:\\Users\\Ada\\AppData\\Roaming\\npm;C:\\Windows\\System32"
  );
});

test("mergeWindowsPath ignores empty path entries", () => {
  assert.equal(mergeWindowsPath("; C:\\node ;;", undefined), "C:\\node");
});

test("mergeWindowsPath removes wrapping quotes from registry entries", () => {
  assert.equal(
    mergeWindowsPath('"D:\\software\\envs\\npm\\";C:\\Windows\\System32'),
    "D:\\software\\envs\\npm\\;C:\\Windows\\System32"
  );
});

test("where result prefers npm.cmd over a directory and POSIX npm shim", () => {
  const directory = "D:\\software\\envs\\npm\\";
  const posixShim = "D:\\software\\envs\\npm";
  const executable = "D:\\software\\envs\\npm.cmd";
  assert.equal(
    parseWindowsWhereOutput(
      `${directory}\r\n${posixShim}\r\n${executable}\r\n`,
      (candidate) => candidate === posixShim || candidate === executable
    ),
    executable
  );
});

test("Windows npm installs avoid quoted absolute paths and select the right host", () => {
  const command = "npm install -g @agentclientprotocol/claude-agent-acp";
  assert.deepEqual(
    windowsInstallInvocation(command, "D:\\software\\envs\\npm.ps1"),
    {
      command,
      requiresPowerShell: true
    }
  );
  assert.deepEqual(
    windowsInstallInvocation(command, "D:\\software\\envs\\npm.cmd"),
    {
      command,
      requiresPowerShell: false
    }
  );
});

test("PowerShell command resolution ignores profile output before its marker", () => {
  assert.equal(
    parseWindowsShellCommandOutput(
      "Conda environment activated\r\n__FREEBUDDY_COMMAND__C:\\tools\\npm.cmd"
    ),
    "C:\\tools\\npm.cmd"
  );
  assert.equal(parseWindowsShellCommandOutput("profile output only"), undefined);
});

test("resolveWindowsPowerShell prefers FREEBUDDY_PWSH when that file exists", () => {
  const override = "D:\\tools\\pwsh.exe";
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        FREEBUDDY_PWSH: `"${override}"`,
        ProgramFiles: "C:\\Program Files"
      },
      filesExist(override, PWSH7, POWERSHELL_51)
    ),
    override
  );
});

test("resolveWindowsPowerShell ignores a relative FREEBUDDY_PWSH override", () => {
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        FREEBUDDY_PWSH: "pwsh.exe",
        ProgramFiles: "C:\\Program Files"
      },
      filesExist("pwsh.exe", PWSH7, POWERSHELL_51)
    ),
    PWSH7
  );
});

test("resolveWindowsPowerShell ignores a missing FREEBUDDY_PWSH override", () => {
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        FREEBUDDY_PWSH: "D:\\missing\\pwsh.exe",
        ProgramFiles: "C:\\Program Files"
      },
      filesExist(PWSH7, POWERSHELL_51)
    ),
    PWSH7
  );
});

test("resolveWindowsPowerShell prefers PowerShell 7 over Windows PowerShell 5.1", () => {
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        ProgramFiles: "C:\\Program Files"
      },
      filesExist(PWSH7, POWERSHELL_51)
    ),
    PWSH7
  );
});

test("resolveWindowsPowerShell derives Program Files from SystemRoot when unset", () => {
  assert.equal(
    resolveWindowsPowerShell(
      { SystemRoot: "C:\\Windows" },
      filesExist(PWSH7, POWERSHELL_51)
    ),
    PWSH7
  );
});

test("resolveWindowsPowerShell uses ProgramW6432 when ProgramFiles has no pwsh", () => {
  const wow64Pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        ProgramFiles: "C:\\Program Files (x86)",
        ProgramW6432: "C:\\Program Files"
      },
      filesExist(wow64Pwsh, POWERSHELL_51)
    ),
    wow64Pwsh
  );
});

test("resolveWindowsPowerShell does not use PATH-discovered pwsh.exe", () => {
  const pathPwsh = "D:\\scoop\\shims\\pwsh.exe";
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        ProgramFiles: "C:\\Program Files",
        PATH: "D:\\scoop\\shims;C:\\Windows\\System32"
      },
      filesExist(pathPwsh, POWERSHELL_51)
    ),
    POWERSHELL_51
  );
});

test("resolveWindowsPowerShell falls back to Windows PowerShell 5.1", () => {
  assert.equal(
    resolveWindowsPowerShell(
      {
        SystemRoot: "C:\\Windows",
        ProgramFiles: "C:\\Program Files"
      },
      filesExist(POWERSHELL_51)
    ),
    POWERSHELL_51
  );
});

test("sandbox runtime reuses resolveWindowsPowerShell instead of hardcoding 5.1", () => {
  const sandboxSource = fs.readFileSync(
    new URL("../electron/cli/sandboxRuntime.ts", import.meta.url),
    "utf8"
  );
  assert.match(sandboxSource, /resolveWindowsPowerShell/);
  assert.equal(
    sandboxSource.includes("function windowsPowerShell("),
    false
  );
});
