const test = require("node:test");
const assert = require("node:assert/strict");
const umiOcr = require("../umi-ocr.js");

test("Umi-OCR 地址只允许本机 HTTP 服务", () => {
  assert.equal(umiOcr.normalizeBaseUrl("http://127.0.0.1:1224/"), "http://127.0.0.1:1224");
  assert.equal(umiOcr.normalizeBaseUrl("http://localhost:1333"), "http://localhost:1333");
  assert.throws(() => umiOcr.normalizeBaseUrl("https://example.com/ocr"), /只允许/);
  assert.throws(() => umiOcr.normalizeBaseUrl("http://192.168.1.8:1224"), /只允许/);
});

test("详细 OCR 响应保留文字、置信度和坐标", () => {
  const blocks = umiOcr.normalizeResult({ code: 100, data: [{ text: "成交价格", score: 0.98, box: [[10, 20], [110, 20], [110, 50], [10, 50]] }] });
  assert.equal(blocks[0].text, "成交价格");
  assert.equal(blocks[0].score, 0.98);
  assert.deepEqual({ x: blocks[0].x, y: blocks[0].y }, { x: 60, y: 35 });
  assert.deepEqual(blocks[0].box, [[10, 20], [110, 20], [110, 50], [10, 50]]);
});

test("Umi-OCR 失败和无文字响应不会被当作成功", () => {
  assert.throws(() => umiOcr.normalizeResult({ code: 101, data: "" }), /没有检测到文字/);
  assert.throws(() => umiOcr.normalizeResult({ code: 500, data: "engine failed" }), /engine failed/);
});

test("Umi-OCR 未运行时返回可展示的离线状态", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new TypeError("connection refused"); };
  try {
    const result = await umiOcr.checkConnection("http://127.0.0.1:1224");
    assert.equal(result.connected, false);
    assert.match(result.error, /无法连接本机 Umi-OCR/);
  } finally {
    global.fetch = originalFetch;
  }
});
