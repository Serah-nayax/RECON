import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../logger.js";

/**
 * Keeps Windows from going to sleep while a Maps search runs: sleep froze the browser, then
 * every running cell hit its time limit at once on wake-up. The screen may still turn off.
 *
 * A hidden PowerShell asks Windows to stay awake (SetThreadExecutionState) for as long as it
 * lives; killing it (last search done) lets the PC sleep again. It also quits by itself once
 * the server is gone (closed with Ctrl+C, crashed), so it can never keep the PC awake for nothing.
 * Other systems: nothing to do.
 */
const holders = new Set<string>();
let child: ChildProcess | null = null;

const SCRIPT = `
Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[W.P]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
while (Get-Process -Id $env:RECON_PID -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }
`;

export function keepAwake(holder: string): void {
  if (process.platform !== "win32") return;
  holders.add(holder);
  if (child) return;
  try {
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SCRIPT], {
      stdio: "ignore",
      env: { ...process.env, RECON_PID: String(process.pid) },
      windowsHide: true,
    });
    child.on("error", (err) => {
      logger.warn({ err: err.message }, "Could not keep the PC awake during the search");
      child = null;
    });
    child.on("exit", () => {
      child = null;
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Could not keep the PC awake during the search");
    child = null;
  }
}

export function allowSleep(holder: string): void {
  holders.delete(holder);
  if (holders.size || !child) return;
  child.kill();
  child = null;
}

process.once("exit", () => child?.kill());
