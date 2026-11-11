const { spawn, spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..");
const apiDir = path.join(root, "apps", "api");
const webDir = path.join(root, "apps", "web");
const env = { ...process.env };
const children = [];

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}
function startNode(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "ignore", windowsHide: true });
  children.push(child);
  return child;
}
function startPnpm(args, cwd, stdio = "ignore") {
  const child = spawn("corepack", ["pnpm", ...args], {
    cwd, env, stdio, windowsHide: true, shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}
async function waitFor(url, label, child) {
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(url); if (response.ok || label === "Web") return; } catch {}
    if (child && child.exitCode !== null) throw new Error(label + " process exited before becoming ready");
    await delay(500);
  }
  throw new Error(label + " did not become ready within 30 seconds");
}
async function main() {
  const api = startNode(["dist/main.js"], apiDir);
  await waitFor("http://127.0.0.1:" + (env.API_PORT || "4000") + "/api/health", "API", api);
  const web = startPnpm(["dev"], webDir, "inherit");
  await waitFor(env.WEB_ORIGIN || "http://localhost:3000", "Web", web);
  const test = startPnpm(["exec", "playwright", "test", "e2e/opening-stock-ui.spec.ts", "--project=chromium"], webDir, "inherit");
  const code = await new Promise(resolve => test.on("exit", value => resolve(value ?? 1)));
  if (code !== 0) process.exitCode = code;
  stop(web);
  stop(api);
}
main().catch(error => {
  console.error("OPENING_STOCK_UI_E2E=FAIL", error.message);
  for (const child of children) stop(child);
  process.exitCode = 1;
});
