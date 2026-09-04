const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../engine.js");

const fees = {
  commissionRate: 0.0001,
  minimumCommission: 5,
  transferRate: 0.00001,
  stampDutyRate: 0.0005,
};
const security = { id: "s1", code: "600000", name: "测试股票", initialQuantity: 1000, initialCost: 10 };

function trade(id, datetime, side, quantity, price) {
  return { id, securityId: "s1", datetime, side, quantity, price, sequence: Number(id.slice(1)) };
}

function cash(id, datetime, type, amount) {
  return { id, securityId: "s1", datetime, type, amount, sequence: Number(id.slice(1)) };
}

test("费用按规则计算并精确到分", () => {
  const buy = engine.calculateFees({ side: "buy", quantity: 100, price: 10 }, fees);
  assert.deepEqual(buy, { gross: 1000, commission: 5, transferFee: 0.01, stampDuty: 0, total: 5.01, cashFlow: -1005.01 });
  const sell = engine.calculateFees({ side: "sell", quantity: 100, price: 10 }, fees);
  assert.deepEqual(sell, { gross: 1000, commission: 5, transferFee: 0.01, stampDuty: 0.5, total: 5.51, cashFlow: 994.49 });
});

test("先买后卖形成 FIFO 闭环并计入全部费用", () => {
  const result = engine.analyzeSecurity(security, [
    trade("t1", "2026-09-01T10:00", "buy", 100, 9.8),
    trade("t2", "2026-09-01T14:00", "sell", 100, 10.0),
  ], fees);
  assert.equal(result.loops.length, 1);
  assert.equal(result.loops[0].direction, "buy-sell");
  assert.equal(result.loops[0].openedAt, "2026-09-01T10:00");
  assert.equal(result.loops[0].closedAt, "2026-09-01T14:00");
  assert.equal(result.loops[0].profit, 9.48);
  assert.equal(result.currentHolding, 1000);
  assert.equal(result.dilutedCost, 9.99052);
});

test("先卖后买也形成闭环并降低摊薄成本", () => {
  const result = engine.analyzeSecurity(security, [
    trade("t1", "2026-09-01T10:00", "sell", 200, 10.2),
    trade("t2", "2026-09-01T14:00", "buy", 200, 9.9),
  ], fees);
  assert.equal(result.loops.length, 1);
  assert.equal(result.loops[0].direction, "sell-buy");
  assert.equal(result.loops[0].profit, 48.94);
  assert.equal(result.currentHolding, 1000);
  assert.equal(result.dilutedCost, 9.95106);
});

test("一笔新交易按数量依次匹配最早的反向队列", () => {
  const result = engine.analyzeSecurity(security, [
    trade("t1", "2026-09-01T10:00", "sell", 100, 10.5),
    trade("t2", "2026-09-01T11:00", "sell", 200, 10.4),
    trade("t3", "2026-09-01T14:00", "buy", 200, 10.0),
  ], fees);
  assert.equal(result.loops.length, 2);
  assert.equal(result.loops[0].quantity, 100);
  assert.equal(result.loops[0].openTransactionId, "t1");
  assert.equal(result.loops[1].quantity, 100);
  assert.equal(result.loops[1].openTransactionId, "t2");
  assert.deepEqual(result.unmatched, { buy: 0, sell: 100 });
});

test("拒绝非整手交易和导致负持仓的卖出", () => {
  assert.match(engine.validateTrade(security, [], trade("t1", "2026-09-01T10:00", "buy", 150, 10)), /100 股/);
  assert.match(engine.validateTrade(security, [], trade("t1", "2026-09-01T10:00", "sell", 1100, 10)), /负数/);
});

test("仓位占比以全部已添加股票的估算市值为分母", () => {
  const secondSecurity = { id: "s2", code: "000001", name: "第二只", initialQuantity: 500, initialCost: 20 };
  const initial = engine.calculatePortfolioAllocation([security, secondSecurity], [], fees, "s1");
  assert.deepEqual(initial, { securityValue: 10000, totalValue: 20000, weight: 50 });

  const afterTrade = engine.calculatePortfolioAllocation(
    [security, secondSecurity],
    [trade("t1", "2026-09-01T10:00", "buy", 100, 12)],
    fees,
    "s1"
  );
  assert.equal(afterTrade.securityValue, 13200);
  assert.equal(afterTrade.totalValue, 23200);
  assert.equal(afterTrade.weight, 56.896552);
});

test("股息记录可切换是否回摊成本，且不改变持仓和交易费用", () => {
  const records = [
    cash("t1", "2026-01-15T16:00", "dividend", 607.8),
    cash("t2", "2026-02-09T00:00", "dividend_tax", 20.26),
  ];
  const excluded = engine.analyzeSecurity(security, records, fees, { includeDividendsInCost: false });
  assert.equal(excluded.dilutedCost, 10);
  assert.equal(excluded.netDividend, 587.54);
  assert.equal(excluded.currentHolding, 1000);
  assert.equal(excluded.cumulativeFees, 0);

  const included = engine.analyzeSecurity(security, records, fees, { includeDividendsInCost: true });
  assert.equal(included.dilutedCost, 9.41246);
  assert.equal(included.costBalance, 9412.46);
  assert.equal(engine.validateTrade(security, records, trade("t3", "2026-02-10T10:00", "sell", 100, 10)), "");
});

test("招商银行样例计入净股息后复算为券商成本 33.7617", () => {
  const cmb = { id: "s1", code: "600036", name: "招商银行", initialQuantity: 600, initialCost: 41.20875 };
  const records = [
    cash("t1", "2026-01-15T16:00", "dividend", 607.8),
    trade("t2", "2026-01-16T09:37", "buy", 100, 39.26),
    trade("t3", "2026-01-16T13:55", "buy", 100, 38.8),
    trade("t4", "2026-01-21T14:03", "buy", 100, 38.53),
    trade("t5", "2026-02-06T09:31", "sell", 200, 39.91),
    cash("t6", "2026-02-09T00:00", "dividend_tax", 20.26),
    trade("t7", "2026-02-12T09:45", "buy", 200, 39.1),
    trade("t8", "2026-03-26T13:41", "sell", 500, 39.63),
    cash("t9", "2026-03-27T00:00", "dividend_tax", 40.52),
    trade("t10", "2026-03-27T11:13", "buy", 200, 39.27),
    cash("t11", "2026-07-09T16:00", "dividend", 601.8),
    trade("t12", "2026-08-21T13:03", "sell", 200, 39.05),
    cash("t13", "2026-08-24T00:00", "dividend_tax", 10.03),
    cash("t14", "2026-08-24T00:00", "dividend_tax", 10.03),
    trade("t15", "2026-08-25T10:58", "sell", 200, 39.83),
    cash("t16", "2026-08-26T00:00", "dividend_tax", 20.06),
    trade("t17", "2026-09-01T13:57", "sell", 100, 40.85),
    cash("t18", "2026-09-02T00:00", "dividend_tax", 10.03),
  ];
  const result = engine.analyzeSecurity(cmb, records, fees, { includeDividendsInCost: true });
  assert.equal(result.currentHolding, 100);
  assert.equal(result.cumulativeFees, 74.59);
  assert.equal(result.cumulativeDividend, 1209.6);
  assert.equal(result.cumulativeDividendTax, 110.93);
  assert.equal(result.netDividend, 1098.67);
  assert.equal(result.costBalance, 3376.17);
  assert.equal(result.dilutedCost, 33.7617);
});

test("仓位估值忽略最新的股息记录，继续采用最近成交价", () => {
  const records = [
    trade("t1", "2026-09-01T10:00", "buy", 100, 12),
    cash("t2", "2026-09-02T00:00", "dividend", 50),
  ];
  const allocation = engine.calculatePortfolioAllocation([security], records, fees, "s1", { includeDividendsInCost: true });
  assert.equal(allocation.securityValue, 13200);
  assert.equal(allocation.totalValue, 13200);
});
