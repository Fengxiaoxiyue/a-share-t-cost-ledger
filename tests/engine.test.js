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
