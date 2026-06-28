// Running-product acceptance for audio polish Apply flow (#197).
// Run: node tests/browser-audio-polish-apply.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8771;

function mime(path) {
  const ext = extname(path);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}

const UPLOAD_FIXTURES = [
  join(root, "fixtures/imported-tracks/host-synced.wav"),
  join(root, "fixtures/imported-tracks/guest-1-synced.wav"),
  join(root, "fixtures/imported-tracks/guest-2-synced.wav"),
];

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const file = join(root, rel.replace(/^\//, ""));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": mime(file) });
      res.end(readFileSync(file));
    });
    server.listen(port, () => resolve(server));
  });
}

async function completeSetup(page) {
  await page.getByRole("button", { name: "Start blank episode" }).click();
  await page.waitForSelector("form.setup-import");
  await page.locator("#f-episodeName").fill("Founders Unfiltered #7");
  await page.locator("#f-sp-0-name").fill("Sam Rivera");
  await page.locator("#f-sp-1-name").fill("Dana Kim");
  await page.locator("#f-sp-2-name").fill("Alex Chen");
  await page.locator(".setup-preset-card").first().click();
  await page.locator(".guided-workspace").waitFor({ state: "visible", timeout: 60000 });
}

async function resumeWorkspaceAfterReload(page) {
  await page.locator(".show-library-list, .home-start-hero").first().waitFor();
  const openBtn = page.getByRole("button", { name: "Open" }).first();
  if (await openBtn.isVisible()) {
    await openBtn.click();
  }
  const resumePrimary = page.getByRole("button", { name: /Resume draft episode/ });
  if (await resumePrimary.isVisible()) {
    await resumePrimary.click();
  } else {
    await page.getByRole("button", { name: "Resume →" }).first().click();
  }
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
}

async function openAudioPolish(page) {
  await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: /Polish audio|Change audio/ }).first().click();
  await page.locator(".audio-step").waitFor();
}

function readPersistedPolish(page) {
  return page.evaluate(() => {
    const sessions = JSON.parse(localStorage.getItem("pdc-episode-sessions") || "{}");
    const key = Object.keys(sessions)[0];
    return key ? sessions[key].appliedAudioPolish : null;
  });
}

async function main() {
  const server = await startServer();
  let browser;
  let failed = false;
  const log = (ok, msg) => {
    console.log(`${ok ? "  ok" : " FAIL"} ${msg}`);
    if (!ok) failed = true;
  };

  try {
    let chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch (err) {
      if (err && err.code === "ERR_MODULE_NOT_FOUND") {
        console.error(
          "Playwright is required for this browser acceptance test.\n"
          + "Install it with:\n"
          + "  npm install\n"
          + "  npx playwright install chromium\n"
          + "Then rerun:\n"
          + "  npm run test:browser-audio-polish",
        );
        process.exit(1);
      }
      throw err;
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    await completeSetup(page);
    await openAudioPolish(page);

    const beforeApply = await page.locator(".audio-step").innerText();
    log(/Pending/.test(beforeApply), "Speaker tracks show Pending before Apply");
    log(!/Polished/.test(beforeApply), "No track is marked Polished before Apply");

    await page.locator(".audio-preset-card").first().click();
    await page.getByRole("button", { name: "Apply audio & continue →" }).click();
    await page.locator(".guided-workspace").waitFor({ state: "visible" });

    const workspaceText = await page.locator(".guided-workspace").innerText();
    log(/Audio polish applied/.test(workspaceText), "Workspace shows a one-time Apply completion banner");
    log(/tracks polished and saved/.test(workspaceText), "Completion banner reports polished track count");

    const persisted = await readPersistedPolish(page);
    log(Boolean(persisted && persisted.allTracksProcessed), "Applied polish persisted with all tracks processed");
    log((persisted && persisted.processedTrackCount) === 3, "Persisted polish saved all three speaker tracks");

    await page.reload({ waitUntil: "networkidle" });
    const afterReload = await readPersistedPolish(page);
    log(Boolean(afterReload && afterReload.allTracksProcessed), "Reload keeps applied polish settings and outputs");

    await resumeWorkspaceAfterReload(page);
    await openAudioPolish(page);
    const afterReloadAudio = await page.locator(".audio-step").innerText();
    log(/Polished/.test(afterReloadAudio), "Reopened audio step shows Polished tracks after reload");
    log(await page.locator(".audio-track-player").count() >= 1, "Polished tracks expose playable audio players");

    await page.screenshot({ path: join(root, "tests", "audio-polish-applied.png"), fullPage: false });
    log(true, "Screenshot saved to tests/audio-polish-applied.png");

    await page.reload({ waitUntil: "networkidle" });
    await resumeWorkspaceAfterReload(page);
    await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: "Export episode" }).first().click();
    await page.locator(".publish-review-step").waitFor();
    const approveBtn = page.getByRole("button", { name: "Approve for export →" });
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      await page.getByRole("button", { name: "Approved for export" }).waitFor();
    }
    await page.getByRole("button", { name: "← Back to workspace" }).click();
    await page.locator(".guided-workspace").waitFor();
    await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: "Export episode" }).first().click();
    await page.locator(".export-step").waitFor();
    const exportText = await page.locator(".export-step").innerText();
    log(/Polished audio tracks used for export/.test(exportText), "Export screen lists polished tracks used downstream");
    log(await page.locator(".export-polished-audio .audio-track-player").count() >= 1, "Export shows playable polished audio assets");
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\nBrowser audio polish apply: all checks passed.");
}

main();
