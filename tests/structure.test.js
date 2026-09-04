const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const umiOcr = fs.readFileSync(path.join(root, "umi-ocr.js"), "utf8");
const parser = fs.readFileSync(path.join(root, "trade-screenshot-parser.js"), "utf8");

test("页面脚本引用的静态 ID 均存在", () => {
  const selectorIds = [...app.matchAll(/\$\(["']#([A-Za-z][\w-]*)["']\)/g)].map((match) => match[1]);
  const missing = [...new Set(selectorIds)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});

test("核心资源使用本地相对路径，不依赖外部 CDN", () => {
  assert.match(html, /src="engine\.js"/);
  assert.match(html, /src="umi-ocr\.js"/);
  assert.match(html, /src="trade-screenshot-parser\.js"/);
  assert.match(html, /src="app\.js"/);
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /href="ocr-styles\.css"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("OCR 图片仅发送到 localhost，且导入前存在人工确认步骤", () => {
  assert.match(umiOcr, /\["127\.0\.0\.1", "localhost"\]/);
  assert.match(umiOcr, /"data\.format": "dict"/);
  assert.match(parser, /parseTable/);
  assert.match(parser, /fingerprint/);
  assert.match(html, /id="ocrConfirmButton"/);
  assert.match(app, /confirmOcrImport/);
  assert.doesNotMatch(app, /console\.log/);
});
