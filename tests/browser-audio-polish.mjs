// Browser-runtime acceptance for audio polish Apply path (#257).
// Run: node tests/browser-audio-polish.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8772;
const chromeCandidates = [
  process.env.CHROME_BIN,
  join(homedir(), ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome"),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function mime(path) {
  const ext = extname(path);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  return "application/octet-stream";
}

function scriptTagsFromIndex() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const scripts = [];
  const pattern = /<script src="([^"]+)"><\/script>/g;
  let match = pattern.exec(html);
  while (match) {
    scripts.push(`<script src="/${match[1]}"></script>`);
    match = pattern.exec(html);
  }
  return scripts.join("\n");
}

function findChrome() {
  for (const candidate of chromeCandidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      return candidate;
    }
  }
  return "";
}

function probeScript() {
  return `
    (function () {
      const checks = [];
      function log(ok, message) {
        checks.push({ ok: Boolean(ok), message });
      }
      function waitFor(predicate, label) {
        const started = Date.now();
        return new Promise((resolve, reject) => {
          function tick() {
            try {
              if (predicate()) {
                resolve();
                return;
              }
            } catch (err) {
              reject(err);
              return;
            }
            if (Date.now() - started > 12000) {
              reject(new Error("Timed out waiting for " + label));
              return;
            }
            setTimeout(tick, 25);
          }
          tick();
        });
      }
      function clickButton(text) {
        const button = Array.from(document.querySelectorAll("button"))
          .find((node) => (node.textContent || "").indexOf(text) >= 0);
        if (!button) {
          throw new Error("Button missing: " + text);
        }
        button.click();
      }
      function resetDatabases() {
        const names = ["pdc-source-media", "pdc-polished-audio"];
        return Promise.all(names.map((name) => new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = resolve;
          request.onerror = resolve;
          request.onblocked = resolve;
        })));
      }

      (async function run() {
        try {
          localStorage.clear();
          await resetDatabases();
          await waitFor(() => document.querySelector("#home-audio-polish-demo"), "home audio polish demo");
          log(Boolean(document.querySelector(".home-active-step-banner")), "Home shows active-step audio polish banner");
          clickButton("Open audio polish demo");
          await waitFor(() => document.querySelector(".audio-step"), "audio polish step");
          const beforeApply = document.querySelector(".audio-step").innerText;
          log(beforeApply.indexOf("Sam Rivera") >= 0, "Audio polish renders demo speakers");
          log(/source media saved/.test(beforeApply), "Demo speakers show saved source media");
          clickButton("Apply audio");
          await waitFor(() => {
            const step = document.querySelector(".audio-step");
            return step && /Polish applied/.test(step.innerText) && step.querySelectorAll(".audio-track-evidence").length >= 3;
          }, "polished track evidence");
          const afterApply = document.querySelector(".audio-step").innerText;
          log(/Polish applied — 3 polished tracks/.test(afterApply), "Apply reports three polished tracks");
          log(/polished track saved/.test(afterApply), "Speaker badges show polished track saved");
          log(document.querySelectorAll(".audio-track-metrics").length === 3, "Each track shows before/after metrics");
          log(document.querySelectorAll(".audio-track-download").length === 3, "Each track exposes a polished WAV download");
        } catch (err) {
          checks.push({ ok: false, message: err && err.stack ? err.stack : String(err) });
        }
        const result = {
          ok: checks.every((check) => check.ok),
          checks,
        };
        const pre = document.createElement("pre");
        pre.id = "probe-result";
        pre.textContent = "PDC_PROBE_RESULT:" + JSON.stringify(result) + ":PDC_PROBE_RESULT_END";
        document.body.appendChild(pre);
      }());
    }());
  `;
}

function probeHtml() {
  return `<!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"><title>Audio polish probe</title></head>
      <body>
        <div id="page-intro"></div>
        <div id="app"></div>
        ${scriptTagsFromIndex()}
        <script>${probeScript()}</script>
      </body>
    </html>`;
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = req.url === "/" ? "/probe.html" : req.url.split("?")[0];
      if (rel === "/probe.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(probeHtml());
        return;
      }
      const file = join(root, rel.replace(/^\//, ""));
      if (!file.startsWith(root)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      try {
        res.writeHead(200, { "Content-Type": mime(file) });
        res.end(readFileSync(file));
      } catch (err) {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(port, () => resolve(server));
  });
}

const chrome = findChrome();
if (!chrome) {
  console.error("browser audio polish: no Chrome binary found.");
  process.exit(1);
}

const server = await startServer();
const result = spawnSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--virtual-time-budget=15000",
  "--dump-dom",
  `http://127.0.0.1:${port}/probe.html`,
], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 8,
});
server.close();

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const matches = Array.from(result.stdout.matchAll(/PDC_PROBE_RESULT:(.*?):PDC_PROBE_RESULT_END/gs));
const match = matches[matches.length - 1];
if (!match) {
  console.error("browser audio polish: probe result missing.");
  console.error(result.stdout.slice(-2000));
  process.exit(1);
}

const parsed = JSON.parse(match[1]);
parsed.checks.forEach((check) => {
  console.log(`${check.ok ? "  ok" : " FAIL"} ${check.message}`);
});
if (!parsed.ok) {
  process.exit(1);
}
console.log("\nbrowser audio polish: browser-runtime acceptance passed.");
