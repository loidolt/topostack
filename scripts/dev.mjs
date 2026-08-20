import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let shuttingDown = false;

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // The child already stopped between the exit-code check and signal.
    }
  }
  setTimeout(() => process.exit(exitCode), 2_000);
}

function start(script, label) {
  const child = spawn(npmCommand, ["run", script], { detached: process.platform !== "win32", stdio: "inherit" });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`${label} stopped unexpectedly${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}.`);
      shutdown(code ?? 1);
    }
  });
  child.once("error", (error) => {
    console.error(`Could not start ${label}: ${error.message}`);
    shutdown(1);
  });
  return child;
}

async function waitForMapApi(api) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error("The map API exited before becoming ready.");
    try {
      const response = await fetch("http://127.0.0.1:8787/health");
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The map API did not become healthy on http://127.0.0.1:8787 within 45 seconds.");
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

const api = start("dev:api", "map API");
try {
  await waitForMapApi(api);
  console.log("Map API ready; starting the generator at http://localhost:5173.");
  start("dev:web", "generator");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
