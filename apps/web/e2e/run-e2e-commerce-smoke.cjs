const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const apiDir = path.join(root, "apps/api");
const webDir = path.join(root, "apps/web");
const port = Number(process.env.API_PORT || 4000);
const apiBase = "http://127.0.0.1:" + port;
let apiProcess;
let startedHere = false;

async function waitForApi() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (apiProcess && apiProcess.exitCode !== null) throw new Error("API server exited before becoming ready.");
    try {
      const response = await fetch(apiBase + "/api/auth/me");
      if (response.status === 401 || response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("API server did not become ready on " + apiBase);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: command === "cmd.exe" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  const webResponse = await fetch(process.env.WEB_ORIGIN || "http://localhost:3000/login").catch(() => null);
  if (!webResponse || webResponse.status !== 200) throw new Error("Existing Next.js web server is not available at WEB_ORIGIN.");

  try {
    try {
      const response = await fetch(apiBase + "/api/auth/me");
      if (response.status !== 401 && !response.ok) throw new Error("Unexpected API health response: " + response.status);
      console.log("Using already-running API server.");
    } catch (error) {
      if (String(error.message).includes("Unexpected API health response")) throw error;
      apiProcess = spawn(process.execPath, ["--env-file=.env", "dist/main.js"], {
        cwd: apiDir, stdio: "ignore", windowsHide: true
      });
      startedHere = true;
      await waitForApi();
      console.log("Started temporary API server for the smoke test.");
    }

    const rbacCode = run(process.execPath, ["--env-file=.env", "scripts/verify-e2e-inventory-rbac-http.cjs"], apiDir);
    if (rbacCode !== 0) throw new Error("Inventory RBAC HTTP smoke test failed with exit code " + rbacCode);

    const playwrightCli = require.resolve("@playwright/test/cli", { paths: [webDir] });
    const browserCode = run(process.execPath, [playwrightCli, "test", "--grep", "@e2e-commerce"], webDir);
    if (browserCode !== 0) throw new Error("Browser E2E smoke test failed with exit code " + browserCode);

    console.log("PASS E2E Commerce Application Smoke Test.");
  } finally {
    if (startedHere && apiProcess && apiProcess.exitCode === null) {
      apiProcess.kill();
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 3000);
        apiProcess.once("exit", () => { clearTimeout(timeout); resolve(); });
      });
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
