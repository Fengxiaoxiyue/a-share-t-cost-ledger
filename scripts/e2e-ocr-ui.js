const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

class Cdp {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  close() { this.socket.close(); }
}

async function waitFor(check, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("浏览器端到端测试等待超时");
}

async function main() {
  const imagePath = path.resolve(process.argv[2] || "");
  if (!fs.existsSync(imagePath)) throw new Error("请提供存在的交易截图路径");
  const browserPath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) throw new Error("未找到 Chrome 或 Edge");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-ocr-e2e-"));
  const port = 9300 + Math.floor(Math.random() * 400);
  const pageUrl = new URL(`file:///${path.resolve(__dirname, "..", "index.html").replaceAll("\\", "/")}`);
  pageUrl.searchParams.set("umiOcrBaseUrl", "http://127.0.0.1:1224");
  const browser = spawn(browserPath, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files",
    "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1", pageUrl.href,
  ], { stdio: "ignore" });
  let cdp;
  try {
    const target = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      } catch { return null; }
    }, 15000);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      return result.result.value === "complete";
    }, 15000);

    const seed = { version: 1, selectedSecurityId: "s1", securities: [{ id: "s1", code: "600036", name: "招商银行", initialQuantity: 0, initialCost: 0 }], transactions: [], fees: { commissionRate: 0.0001, minimumCommission: 5, transferRate: 0.00001, stampDutyRate: 0.0005 }, includeDividendsInCost: false };
    await cdp.send("Runtime.evaluate", { expression: `localStorage.setItem("a-share-t-cost-ledger-v1", ${JSON.stringify(JSON.stringify(seed))}); location.reload()` });
    await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!document.querySelector('#ocrImportButton')", returnByValue: true });
      return result.result.value;
    }, 15000);
    await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#ocrImportButton').click()" });
    await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#ocrStatus').classList.contains('connected')", returnByValue: true });
      return result.result.value;
    }, 15000);

    const documentNode = await cdp.send("DOM.getDocument");
    const inputNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#ocrFileInput" });
    await cdp.send("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [imagePath] });
    await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#ocrFileInput').dispatchEvent(new Event('change', { bubbles: true }))" });
    const review = await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", { expression: `(() => {
        const rows = [...document.querySelectorAll('#ocrReviewBody tr')];
        if (!rows.length) return null;
        const types = rows.map((row) => row.querySelector('[data-field="entryType"]').value);
        const stored = JSON.parse(localStorage.getItem('a-share-t-cost-ledger-v1')).transactions.length;
        return { rows: rows.length, trades: types.filter((type) => type === 'buy' || type === 'sell').length, dividends: types.filter((type) => type === 'dividend' || type === 'dividend_tax').length, stored, confirmDisabled: document.querySelector('#ocrConfirmButton').disabled };
      })()`, returnByValue: true });
      return result.result.value;
    }, 30000);
    assert.deepEqual(review, { rows: 19, trades: 11, dividends: 8, stored: 0, confirmDisabled: false });

    await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#ocrConfirmButton').click()" });
    const imported = await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", { expression: `(() => {
        const state = JSON.parse(localStorage.getItem('a-share-t-cost-ledger-v1'));
        if (state.transactions.length !== 19) return null;
        return { records: state.transactions.length, trades: state.transactions.filter((item) => item.type === 'trade').length, dividends: state.transactions.filter((item) => item.type === 'dividend' || item.type === 'dividend_tax').length, dialogClosed: !document.querySelector('#ocrDialog').open };
      })()`, returnByValue: true });
      return result.result.value;
    });
    assert.deepEqual(imported, { records: 19, trades: 11, dividends: 8, dialogClosed: true });

    const resourceResult = await cdp.send("Runtime.evaluate", {
      expression: "performance.getEntriesByType('resource').map((entry) => entry.name)",
      returnByValue: true,
    });
    const resources = resourceResult.result.value;
    const externalRequests = resources.filter((name) => {
      const url = new URL(name);
      return ["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname);
    });
    assert.deepEqual(externalRequests, []);
    process.stdout.write(JSON.stringify({
      browser: path.basename(browserPath),
      networkIsolation: "external hosts mapped to 0.0.0.0; localhost excluded",
      externalRequests,
      review,
      imported,
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    browser.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });
