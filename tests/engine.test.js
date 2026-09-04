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

test("移动基准后只统计锚点之后的流水并重置全部累计项", () => {
  const records = [
    trade("t1", "2026-09-01T10:00", "buy", 100, 9.8),
    trade("t2", "2026-09-01T14:00", "sell", 100, 10),
    cash("t3", "2026-09-02T16:00", "dividend", 50),
    trade("t4", "2026-09-03T10:00", "buy", 100, 9.5),
  ];
  const snapshot = engine.createBaselineSnapshot(security, records, fees, "t3", { includeDividendsInCost: true });
  const result = engine.analyzeSecurity({ ...security, baseline: snapshot }, records, fees, { includeDividendsInCost: true });

  assert.equal(result.baseline.transactionId, "t3");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "t4");
  assert.equal(result.cumulativeClosedProfit, 0);
  assert.equal(result.cumulativeFees, 5.01);
  assert.equal(result.cumulativeDividend, 0);
  assert.equal(result.netDividend, 0);
  assert.deepEqual(result.unmatched, { buy: 100, sell: 0 });
  assert.deepEqual(result.historyRows.map((row) => row.baselineSegment), ["before", "before", "baseline", "after"]);
});

test("基准快照固定，可向前向后移动并恢复原始起点", () => {
  const records = [
    trade("t1", "2026-09-01T10:00", "buy", 100, 9.8),
    trade("t2", "2026-09-01T14:00", "sell", 100, 10),
    trade("t3", "2026-09-02T10:00", "buy", 100, 9.6),
  ];
  const snapshot = engine.createBaselineSnapshot(security, records, fees, "t2");
  const changed = [{ ...records[0], price: 8.8 }, records[1], records[2]];
  const fixed = engine.analyzeSecurity({ ...security, baseline: snapshot }, changed, fees);
  assert.equal(fixed.baseline.cost, snapshot.cost);

  const movedBack = engine.createBaselineSnapshot({ ...security, baseline: snapshot }, changed, fees, "t1");
  const originalChanged = engine.analyzeSecurity(security, changed, fees);
  assert.equal(movedBack.cost, originalChanged.historyRows[0].dilutedCostAfter);

  const restored = engine.analyzeSecurity({ ...security, baseline: null }, changed, fees);
  assert.equal(restored.baseline.isCustom, false);
  assert.equal(restored.rows.length, 3);
});

test("所有记录类型都可生成基准快照，清仓基准以零成本重新开始", () => {
  const records = [
    cash("t1", "2026-09-01T09:00", "dividend", 20),
    cash("t2", "2026-09-01T09:30", "dividend_tax", 2),
    trade("t3", "2026-09-01T10:00", "sell", 1000, 12),
    trade("t4", "2026-09-02T10:00", "buy", 100, 9),
  ];
  for (const item of records) {
    assert.ok(engine.createBaselineSnapshot(security, records, fees, item.id, { includeDividendsInCost: true }));
  }
  const snapshot = engine.createBaselineSnapshot(security, records, fees, "t3", { includeDividendsInCost: true });
  assert.equal(snapshot.quantity, 0);
  assert.equal(snapshot.cost, 0);
  const result = engine.analyzeSecurity({ ...security, baseline: snapshot }, records, fees, { includeDividendsInCost: true });
  assert.equal(result.currentHolding, 100);
  assert.equal(result.dilutedCost, 9.0501);
  assert.equal(result.cumulativeDividend, 0);
});

test("FIFO 不跨越基准边界，且基准后持仓单独校验", () => {
  const records = [
    trade("t1", "2026-09-01T10:00", "sell", 100, 10.2),
    trade("t2", "2026-09-01T14:00", "buy", 100, 9.9),
  ];
  const snapshot = engine.createBaselineSnapshot(security, records, fees, "t1");
  const result = engine.analyzeSecurity({ ...security, baseline: snapshot }, records, fees);
  assert.equal(result.loops.length, 0);
  assert.deepEqual(result.unmatched, { buy: 100, sell: 0 });

  const constrained = { ...security, baseline: { transactionId: "t2", datetime: records[1].datetime, quantity: 500, cost: 10 } };
  const history = [trade("t1", "2026-09-01T10:00", "buy", 1000, 9), cash("t2", "2026-09-01T11:00", "dividend", 10)];
  assert.match(engine.validateTrade(constrained, history, trade("t3", "2026-09-01T12:00", "sell", 1000, 10)), /基准后/);
});

test("基准后没有新成交时，组合估值采用固定基准成本", () => {
  const records = [trade("t1", "2026-09-01T10:00", "buy", 100, 12)];
  const snapshot = engine.createBaselineSnapshot(security, records, fees, "t1");
  const basedSecurity = { ...security, baseline: snapshot };
  const allocation = engine.calculatePortfolioAllocation([basedSecurity], records, fees, "s1");
  assert.equal(allocation.securityValue, engine.roundMoney(snapshot.quantity * snapshot.cost));
  assert.equal(allocation.weight, 100);
});

test("无效基准安全回退，统一历史校验可用于删除前检查", () => {
  const records = [trade("t1", "2026-09-01T10:00", "sell", 1000, 10)];
  const invalid = engine.analyzeSecurity({ ...security, baseline: { transactionId: "missing", quantity: 1000, cost: 10 } }, records, fees);
  assert.equal(invalid.baseline.isCustom, false);
  assert.equal(invalid.baseline.invalid, true);
  assert.equal(invalid.rows.length, 1);

  const unsafeAfterDelete = [trade("t2", "2026-09-01T11:00", "sell", 1100, 10)];
  assert.match(engine.validateTransactionHistory(security, unsafeAfterDelete), /历史持仓/);
});
