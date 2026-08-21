import { spawn } from "node:child_process";
import { createServer } from "node:net";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const DEFAULT_API_PORT = 8787;
const DEFAULT_WEB_PORT = 5273;
const PORT_SCAN_LIMIT = 20;
const children = new Set();
let shuttingDown = false;

// Both dev ports are configurable because their defaults are the ones every
// other project reaches for first. The children read them from the
// environment, so normalize them once here and hand the values down.
function requestedPort(variable, fallback) {
  const raw = process.env[variable];
  if (raw === undefined || raw === "") return { port: fallback, explicit: false };
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variable} must be an integer between 1 and 65535; received "${raw}".`);
  }
  return { port, explicit: true };
}

// Probe the address the child itself will bind: Wrangler takes 127.0.0.1 while
// Vite runs with --host, so a wildcard bind can collide with a listener the
// loopback probe would have missed.
function portIsFree(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ host, port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

// An explicit port is honoured or refused; a default one falls forward to the
// next free port so a stray process cannot block development.
async function resolvePort(label, variable, fallback, host) {
  const { port, explicit } = requestedPort(variable, fallback);
  if (await portIsFree(port, host)) return port;
  if (explicit) {
    throw new Error(`${variable}=${port} is already in use. Free that port or choose another one.`);
  }
  for (let candidate = port + 1; candidate <= port + PORT_SCAN_LIMIT; candidate += 1) {
    if (!(await portIsFree(candidate, host))) continue;
    console.log(`Port ${port} is in use; starting the ${label} on ${candidate} instead.`);
    return candidate;
  }
  throw new Error(`Ports ${port}-${port + PORT_SCAN_LIMIT} are all in use. Set ${variable} to a free port.`);
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      if (process.platform === "win32") {
        // Signaling the npm shim leaves wrangler/vite grandchildren running;
        // taskkill /T tears down the whole process tree.
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).once("error", () => {});
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
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

async function waitForMapApi(api, port) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error("The map API exited before becoming ready.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The map API did not become healthy on http://127.0.0.1:${port} within 45 seconds. Set VITE_MAP_API_PORT to use a free port.`);
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

let apiPort;
let webPort;
try {
  apiPort = await resolvePort("map API", "VITE_MAP_API_PORT", DEFAULT_API_PORT, "127.0.0.1");
  webPort = await resolvePort("generator", "TOPOSTACK_WEB_PORT", DEFAULT_WEB_PORT, "0.0.0.0");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
// VITE_MAP_API_PORT carries the Vite prefix so one knob reaches Wrangler, this
// launcher, and the browser bundle alike. An explicit VITE_MAP_API_URL still
// wins, so pointing the local app at a deployed Worker keeps working.
process.env.VITE_MAP_API_PORT = String(apiPort);
process.env.TOPOSTACK_WEB_PORT = String(webPort);

const api = start("dev:api", "map API");
try {
  await waitForMapApi(api, apiPort);
  console.log(`Map API ready on http://localhost:${apiPort}; starting the generator at http://localhost:${webPort}.`);
  start("dev:web", "generator");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
