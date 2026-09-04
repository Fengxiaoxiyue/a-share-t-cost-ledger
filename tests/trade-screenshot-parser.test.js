const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../trade-screenshot-parser.js");

function block(text, x, y, score = 0.99) { return { text, x, y, score }; }

function tableFixture(secondAmount = "7820.00") {
  return [
    block("证券/代码", 150, 100), block("日期/时间", 450, 100), block("价格/数量", 750, 100), block("成交金额", 1050, 100),
    block("招商银行", 150, 180), block("600036", 150, 220), block("2026-09-01", 450, 180), block("13:57:11", 450, 220),
    block("40.8500", 750, 180), block("-100", 750, 220), block("4085.00", 1050, 180), block("证券卖出", 1050, 220),
    block("招商银行", 150, 380), block("600036", 150, 420), block("2026-02-12", 450, 380), block("09:45:49", 450, 420),
    block("39.1000", 750, 380), block("200", 750, 420), block(secondAmount, 1050, 380), block("证券买入", 1050, 420),
    block("招商银行", 150, 580), block("600036", 150, 620), block("2026-02-09", 450, 580), block("00:00:00", 450, 620),
    block("0.0000", 750, 580), block("0", 750, 620), block("20.26", 1050, 580), block("股息红利税补扣", 1050, 620),
  ];
}

test("按 box 坐标恢复表格并解析买卖与股息记录", () => {
  const result = parser.parseOcrBlocks(tableFixture(), { sourceImageId: "image_1" });
  assert.equal(result.layout, "table");
  assert.equal(result.records.length, 3);
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.records[0].datetime, "2026-09-01T13:57:11");
  assert.equal(result.records[0].symbol, "600036");
  assert.equal(result.records[0].stockName, "招商银行");
  assert.equal(result.records[0].entryType, "sell");
  assert.equal(result.records[0].price, 40.85);
  assert.equal(result.records[0].quantity, 100);
  assert.equal(result.records[0].amount, 4085);
  assert.equal(result.records[1].entryType, "buy");
  assert.equal(result.records[1].amount, 7820);
  assert.equal(result.records[2].entryType, "dividend_tax");
  assert.equal(result.records[2].amount, 20.26);
});

test("价格乘数量与金额不一致时给出警告", () => {
  const result = parser.parseOcrBlocks(tableFixture("782.00"));
  assert.match(result.records[1].warnings.join(" "), /成交金额可能识别错误/);
});

test("指纹用于识别完全相同的重复交易", () => {
  const a = { securityId: "s1", datetime: "2026-09-01T13:57:11", side: "sell", price: 40.85, quantity: 100 };
  const b = { ...a };
  const c = { ...a, quantity: 200 };
  assert.equal(parser.fingerprint(a), parser.fingerprint(b));
  assert.notEqual(parser.fingerprint(a), parser.fingerprint(c));
  const dividend = { securityId: "s1", datetime: "2026-09-02T00:00:00", type: "dividend", amount: 601.8 };
  assert.equal(parser.fingerprint(dividend), parser.fingerprint({ ...dividend }));
  assert.notEqual(parser.fingerprint(dividend), parser.fingerprint({ ...dividend, amount: 602 }));
});

test("纵向详情页按标签和值解析", () => {
  const result = parser.parseOcrBlocks([
    block("证券代码", 100, 100), block("600519", 300, 100),
    block("成交日期", 100, 160), block("2026-09-04", 300, 160),
    block("成交时间", 100, 220), block("10:30:05", 300, 220),
    block("成交价格", 100, 280), block("1580.00", 300, 280),
    block("成交数量", 100, 340), block("100", 300, 340),
    block("成交金额", 100, 400), block("158000", 300, 400),
    block("买卖方向", 100, 460), block("买入", 300, 460),
  ]);
  assert.equal(result.layout, "detail");
  assert.equal(result.records[0].datetime, "2026-09-04T10:30:05");
  assert.equal(result.records[0].symbol, "600519");
  assert.equal(result.records[0].entryType, "buy");
  assert.equal(result.records[0].price, 1580);
  assert.equal(result.records[0].quantity, 100);
});

test("纵向详情页支持分红入账", () => {
  const result = parser.parseOcrBlocks([
    block("证券代码", 100, 100), block("600036", 300, 100),
    block("成交日期", 100, 160), block("2026-07-09", 300, 160),
    block("成交金额", 100, 220), block("601.80", 300, 220),
    block("业务类型", 100, 280), block("股息入账", 300, 280),
  ]);
  assert.equal(result.records[0].entryType, "dividend");
  assert.equal(result.records[0].amount, 601.8);
});
