// Browser-runtime acceptance for durable imported source media (#254).
// Run: node tests/browser-source-media-ingest.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8771;
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
            if (Date.now() - started > 8000) {
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
      function fill(selector, value) {
        const input = document.querySelector(selector);
        if (!input) {
          throw new Error("Input missing: " + selector);
        }
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      function setMediaFile(selector, fileName, content) {
        const input = document.querySelector(selector);
        if (!input) {
          throw new Error("File input missing: " + selector);
        }
        const file = new File([content], fileName, { type: "audio/wav" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      function resetSourceMediaDb() {
        return new Promise((resolve) => {
          const request = indexedDB.deleteDatabase("pdc-source-media");
          request.onsuccess = resolve;
          request.onerror = resolve;
          request.onblocked = resolve;
        });
      }
      function readStoredMedia() {
        return new Promise((resolve, reject) => {
          const sessions = JSON.parse(localStorage.getItem("pdc-episode-sessions") || "{}");
          const session = Object.values(sessions)[0] || {};
          const speakers = ((session.setupDraft && session.setupDraft.speakers) || []).map((speaker) => ({
            fileName: speaker.fileName,
            sourceMedia: speaker.sourceMedia,
          }));
          const request = indexedDB.open("pdc-source-media", 1);
          request.onerror = () => reject(request.error || new Error("Unable to open source media database."));
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("source-media", "readonly");
            const getAll = tx.objectStore("source-media").getAll();
            getAll.onerror = () => {
              db.close();
              reject(getAll.error || new Error("Unable to read source media records."));
            };
            getAll.onsuccess = () => {
              const records = getAll.result.map((record) => ({
                assetId: record.assetId,
                fileName: record.fileName,
                fileSize: record.fileSize,
                mimeType: record.mimeType,
                hasBlob: record.blob instanceof Blob,
              }));
              db.close();
              resolve({ speakers, records });
            };
          };
        });
      }

      (async function run() {
        try {
          localStorage.clear();
          await resetSourceMediaDb();
          clickButton("Start blank episode");
          await waitFor(() => document.querySelector("form.setup-import"), "setup form");
          document.querySelector("#mode-upload").click();
          await waitFor(() => document.querySelector("#f-sp-0-source"), "upload file inputs");
          fill("#f-episodeName", "Durable media ingest");
          fill("#f-sp-0-name", "Avery Stone");
          fill("#f-sp-1-name", "Jordan Lee");
          fill("#f-sp-2-name", "Priya Shah");
          setMediaFile("#f-sp-0-source", "avery-host.wav", "host-real-media");
          setMediaFile("#f-sp-1-source", "jordan-guest.wav", "guest-one-real-media");
          setMediaFile("#f-sp-2-source", "priya-guest.wav", "guest-two-real-media");
          await waitFor(() => {
            return Array.from(document.querySelectorAll(".chosen-file"))
              .filter((node) => /source media saved/.test(node.textContent || "")).length === 3;
          }, "source media saves");
          document.querySelector("#setup-complete-continue").click();
          await waitFor(() => document.querySelector(".guided-workspace"), "workspace");

          const stored = await readStoredMedia();
          log(stored.speakers.length === 3, "Session snapshot keeps all uploaded speaker sources");
          log(stored.speakers.every((speaker) => speaker.sourceMedia && speaker.sourceMedia.assetId), "Session snapshot keeps source media asset ids");
          log(stored.records.length === 3, "IndexedDB stores one media blob per uploaded speaker");
          log(stored.records.every((record) => record.hasBlob && record.fileSize > 0), "IndexedDB records contain non-empty media blobs");

          clickButton("Polish audio");
          await waitFor(() => document.querySelector(".audio-step"), "audio polish");
          const audioText = document.querySelector(".audio-step").innerText;
          log(/source media saved/.test(audioText), "Rendered audio polish tracks acknowledge saved source media");
          log(audioText.indexOf("Avery Stone") >= 0 && audioText.indexOf("Jordan Lee") >= 0 && audioText.indexOf("Priya Shah") >= 0, "Audio polish renders uploaded speakers");
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
      <head><meta charset="utf-8"><title>Source media ingest probe</title></head>
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
  console.error("browser source media ingest: no Chrome binary found.");
  process.exit(1);
}

const server = await startServer();
const result = spawnSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--virtual-time-budget=10000",
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
  console.error("browser source media ingest: probe result missing.");
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
console.log("\nbrowser source media ingest: browser-runtime acceptance passed.");
