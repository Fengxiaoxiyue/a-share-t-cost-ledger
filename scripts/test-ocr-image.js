const fs = require("node:fs");
const umiOcr = require("../umi-ocr.js");
const parser = require("../trade-screenshot-parser.js");

async function main() {
  const imagePath = process.argv[2];
  const baseUrl = umiOcr.normalizeBaseUrl(process.argv[3] || umiOcr.DEFAULT_BASE_URL);
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error("请提供存在的本地图片路径");
  const connection = await umiOcr.checkConnection(baseUrl);
  if (!connection.connected) throw new Error(connection.error || "Umi-OCR 未连接");
  const bytes = fs.readFileSync(imagePath);
  const response = await fetch(`${baseUrl}/api/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64: bytes.toString("base64"), options: { "data.format": "dict", "tbpu.parser": "none" } }),
  });
  if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
  const raw = await response.json();
  const blocks = umiOcr.normalizeResult(raw);
  const result = parser.parseOcrBlocks(blocks, { sourceImageId: "local-test" });
  const summary = result.records.map((record) => ({ datetime: record.datetime, symbol: record.symbol, entryType: record.entryType, price: record.price, quantity: record.quantity, amount: record.amount, warnings: record.warnings }));
  const tradeCount = summary.filter((record) => record.entryType === "buy" || record.entryType === "sell").length;
  const cashCount = summary.length - tradeCount;
  process.stdout.write(JSON.stringify({ code: raw.code, blocks: blocks.length, layout: result.layout, records: summary.length, trades: tradeCount, dividendRecords: cashCount, skippedRows: result.skippedRows.length, summary }, null, 2));
  if (!summary.length) process.exitCode = 2;
}

main().catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });
