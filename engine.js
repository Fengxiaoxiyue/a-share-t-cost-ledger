(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TradeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EPSILON = 1e-9;

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function roundNumber(value, digits = 6) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function calculateFees(transaction, feeSettings) {
    const quantity = Number(transaction.quantity);
    const price = Number(transaction.price);
    const gross = roundMoney(quantity * price);
    const commission = roundMoney(
      Math.max(gross * Number(feeSettings.commissionRate), Number(feeSettings.minimumCommission))
    );
    const transferFee = roundMoney(gross * Number(feeSettings.transferRate));
    const stampDuty = transaction.side === "sell"
      ? roundMoney(gross * Number(feeSettings.stampDutyRate))
      : 0;
    const total = roundMoney(commission + transferFee + stampDuty);
    const cashFlow = transaction.side === "buy"
      ? roundMoney(-(gross + total))
      : roundMoney(gross - total);

    return { gross, commission, transferFee, stampDuty, total, cashFlow };
  }

  function sortTransactions(transactions) {
    return [...transactions].sort((a, b) => {
      const timeOrder = String(a.datetime).localeCompare(String(b.datetime));
      if (timeOrder !== 0) return timeOrder;
      return Number(a.sequence || 0) - Number(b.sequence || 0);
    });
  }

  function transactionType(transaction) {
    if (transaction.type === "dividend" || transaction.type === "dividend_tax") return transaction.type;
    return "trade";
  }

  function emptyFees() {
    return { gross: 0, commission: 0, transferFee: 0, stampDuty: 0, total: 0, cashFlow: 0 };
  }

  function analyzePeriod(baseQuantity, baseCost, relevant, feeSettings, options = {}) {
    let holding = Number(baseQuantity) || 0;
    let costBalance = holding * (Number(baseCost) || 0);
    let cumulativeClosedProfit = 0;
    let cumulativeFees = 0;
    let cumulativeDividend = 0;
    let cumulativeDividendTax = 0;
    const includeDividendsInCost = Boolean(options.includeDividendsInCost);
    const openLots = { buy: [], sell: [] };
    const loops = [];
    const rows = [];

    relevant.forEach((transaction) => {
      const entryType = transactionType(transaction);
      if (entryType !== "trade") {
        const amount = roundMoney(Number(transaction.amount));
        if (entryType === "dividend") cumulativeDividend = roundMoney(cumulativeDividend + amount);
        else cumulativeDividendTax = roundMoney(cumulativeDividendTax + amount);

        if (includeDividendsInCost) {
          costBalance += entryType === "dividend_tax" ? amount : -amount;
        }

        rows.push({
          ...transaction,
          entryType,
          amount,
          fees: emptyFees(),
          holdingAfter: holding,
          holdingDifference: holding - baseQuantity,
          costBalanceAfter: roundNumber(costBalance),
          dilutedCostAfter: holding > 0 ? roundNumber(costBalance / holding) : null,
          cumulativeClosedProfit: roundNumber(cumulativeClosedProfit),
          cumulativeDividend,
          cumulativeDividendTax,
          netDividend: roundMoney(cumulativeDividend - cumulativeDividendTax),
        });
        return;
      }

      const quantity = Number(transaction.quantity);
      const price = Number(transaction.price);
      const fees = calculateFees(transaction, feeSettings);
      const unitFee = fees.total / quantity;
      const unitCashValue = transaction.side === "buy"
        ? price + unitFee
        : price - unitFee;

      holding += transaction.side === "buy" ? quantity : -quantity;
      // 买入现金流为负、卖出现金流为正；从成本余额中扣除现金流，
      // 即可同时得到“买入增加成本、卖出净收入摊薄剩余成本”的效果。
      costBalance -= fees.cashFlow;
      cumulativeFees = roundMoney(cumulativeFees + fees.total);

      let remaining = quantity;
      const oppositeSide = transaction.side === "buy" ? "sell" : "buy";
      const oppositeQueue = openLots[oppositeSide];

      while (remaining > EPSILON && oppositeQueue.length) {
        const openLot = oppositeQueue[0];
        const matchedQuantity = Math.min(remaining, openLot.remainingQuantity);
        const buyUnitCost = transaction.side === "buy" ? unitCashValue : openLot.unitCashValue;
        const sellUnitProceeds = transaction.side === "sell" ? unitCashValue : openLot.unitCashValue;
        const profit = (sellUnitProceeds - buyUnitCost) * matchedQuantity;
        cumulativeClosedProfit += profit;
        loops.push({
          id: `${openLot.transaction.id}_${transaction.id}_${loops.length}`,
          openTransactionId: openLot.transaction.id,
          closeTransactionId: transaction.id,
          openedAt: openLot.transaction.datetime,
          closedAt: transaction.datetime,
          direction: openLot.transaction.side === "buy" ? "buy-sell" : "sell-buy",
          quantity: matchedQuantity,
          buyUnitCost,
          sellUnitProceeds,
          profit: roundNumber(profit),
          cumulativeProfit: roundNumber(cumulativeClosedProfit),
          costReductionPerBaselineShare: baseQuantity > 0 ? roundNumber(profit / baseQuantity) : 0,
          costReductionPerInitialShare: baseQuantity > 0 ? roundNumber(profit / baseQuantity) : 0,
        });

        remaining -= matchedQuantity;
        openLot.remainingQuantity -= matchedQuantity;
        if (openLot.remainingQuantity <= EPSILON) oppositeQueue.shift();
      }

      if (remaining > EPSILON) {
        openLots[transaction.side].push({
          transaction,
          remainingQuantity: remaining,
          unitCashValue,
        });
      }

      rows.push({
        ...transaction,
        entryType,
        fees,
        holdingAfter: holding,
        holdingDifference: holding - baseQuantity,
        costBalanceAfter: roundNumber(costBalance),
        dilutedCostAfter: holding > 0 ? roundNumber(costBalance / holding) : null,
        cumulativeClosedProfit: roundNumber(cumulativeClosedProfit),
        cumulativeDividend,
        cumulativeDividendTax,
        netDividend: roundMoney(cumulativeDividend - cumulativeDividendTax),
      });
    });

    const unmatched = {
      buy: openLots.buy.reduce((sum, lot) => sum + lot.remainingQuantity, 0),
      sell: openLots.sell.reduce((sum, lot) => sum + lot.remainingQuantity, 0),
    };

    return {
      rows,
      loops,
      currentHolding: holding,
      holdingDifference: holding - baseQuantity,
      costBalance: roundNumber(costBalance),
      dilutedCost: holding > 0 ? roundNumber(costBalance / holding) : null,
      costReduction: holding > 0 ? roundNumber(baseCost - costBalance / holding) : null,
      cumulativeClosedProfit: roundNumber(cumulativeClosedProfit),
      cumulativeFees,
      cumulativeDividend,
      cumulativeDividendTax,
      netDividend: roundMoney(cumulativeDividend - cumulativeDividendTax),
      includeDividendsInCost,
      unmatched,
    };
  }

  function originalSecurity(security) {
    return { ...security, baseline: null };
  }

  function validBaseline(security, relevant) {
    const baseline = security.baseline;
    if (!baseline || !baseline.transactionId) return null;
    const anchorIndex = relevant.findIndex((item) => item.id === baseline.transactionId);
    const quantity = Number(baseline.quantity);
    const cost = Number(baseline.cost);
    if (anchorIndex < 0 || baseline.quantity === null || baseline.quantity === "" || !Number.isFinite(quantity) || quantity < 0 || quantity % 100 !== 0 || baseline.cost === null || baseline.cost === "" || !Number.isFinite(cost)) return null;
    return { ...baseline, quantity, cost, anchorIndex };
  }

  function analyzeSecurity(security, transactions, feeSettings, options = {}) {
    const relevant = sortTransactions(
      transactions.filter((item) => item.securityId === security.id)
    );
    const initialQuantity = Number(security.initialQuantity) || 0;
    const initialCost = Number(security.initialCost) || 0;
    const baseline = validBaseline(security, relevant);

    if (!baseline) {
      const result = analyzePeriod(initialQuantity, initialCost, relevant, feeSettings, options);
      const historyRows = result.rows.map((row) => ({ ...row, baselineSegment: "after" }));
      return {
        ...result,
        rows: historyRows,
        historyRows,
        baseline: {
          isCustom: false,
          invalid: Boolean(security.baseline),
          quantity: initialQuantity,
          cost: initialCost,
          transactionId: null,
          datetime: null,
        },
      };
    }

    const original = analyzePeriod(initialQuantity, initialCost, relevant, feeSettings, options);
    const activeTransactions = relevant.slice(baseline.anchorIndex + 1);
    const active = analyzePeriod(baseline.quantity, baseline.cost, activeTransactions, feeSettings, options);
    const beforeRows = original.rows.slice(0, baseline.anchorIndex).map((row) => ({ ...row, baselineSegment: "before" }));
    const sourceAnchor = original.rows[baseline.anchorIndex];
    const anchorRow = {
      ...sourceAnchor,
      holdingAfter: baseline.quantity,
      holdingDifference: 0,
      costBalanceAfter: roundNumber(baseline.quantity * baseline.cost),
      dilutedCostAfter: baseline.quantity > 0 ? roundNumber(baseline.cost) : null,
      cumulativeClosedProfit: 0,
      cumulativeDividend: 0,
      cumulativeDividendTax: 0,
      netDividend: 0,
      baselineSegment: "baseline",
    };
    const activeRows = active.rows.map((row) => ({ ...row, baselineSegment: "after" }));

    return {
      ...active,
      rows: activeRows,
      historyRows: [...beforeRows, anchorRow, ...activeRows],
      baseline: {
        isCustom: true,
        invalid: false,
        quantity: baseline.quantity,
        cost: baseline.cost,
        transactionId: baseline.transactionId,
        datetime: baseline.datetime || sourceAnchor.datetime,
        setAt: baseline.setAt || null,
      },
    };
  }

  function createBaselineSnapshot(security, transactions, feeSettings, transactionId, options = {}) {
    const analysis = analyzeSecurity(originalSecurity(security), transactions, feeSettings, options);
    const row = analysis.historyRows.find((item) => item.id === transactionId);
    if (!row) return null;
    return {
      transactionId: row.id,
      datetime: row.datetime,
      quantity: Number(row.holdingAfter) || 0,
      cost: row.holdingAfter > 0 && Number.isFinite(Number(row.dilutedCostAfter)) ? roundNumber(row.dilutedCostAfter) : 0,
      setAt: new Date().toISOString(),
    };
  }
  function validateCashEntry(candidate) {
    if (!candidate.datetime) return "请选择记录时间";
    const amount = Number(candidate.amount);
    if (!Number.isFinite(amount) || amount <= 0) return "金额必须大于 0";
    return "";
  }

  function validateTransactionHistory(security, transactions) {
    const sorted = sortTransactions(transactions.filter((item) => item.securityId === security.id));
    let holding = Number(security.initialQuantity) || 0;
    for (const item of sorted) {
      if (transactionType(item) !== "trade") continue;
      holding += item.side === "buy" ? Number(item.quantity) : -Number(item.quantity);
      if (holding < 0) return "历史持仓会变为负数，请先调整交易流水";
    }
    const baseline = validBaseline(security, sorted);
    if (baseline) {
      holding = baseline.quantity;
      for (const item of sorted.slice(baseline.anchorIndex + 1)) {
        if (transactionType(item) !== "trade") continue;
        holding += item.side === "buy" ? Number(item.quantity) : -Number(item.quantity);
        if (holding < 0) return "基准后的持仓会变为负数，请先调整交易流水";
      }
    }
    return "";
  }

  function validateTrade(security, transactions, candidate, editingId) {
    const quantity = Number(candidate.quantity);
    const price = Number(candidate.price);
    if (!candidate.datetime) return "请选择交易时间";
    if (!Number.isFinite(quantity) || quantity < 100 || quantity % 100 !== 0) {
      return "成交数量必须是 100 股的正整数倍";
    }
    if (!Number.isFinite(price) || price <= 0) return "成交价格必须大于 0";

    const next = transactions
      .filter((item) => item.securityId === security.id && item.id !== editingId)
      .concat(candidate);
    return validateTransactionHistory(security, next).replace("会变为", "变为");
  }

  function calculatePortfolioAllocation(securities, transactions, feeSettings, selectedSecurityId, options = {}) {
    const positions = securities.map((security) => {
      const analysis = analyzeSecurity(security, transactions, feeSettings, options);
      const latestRow = [...analysis.rows].reverse().find((row) => row.entryType === "trade");
      const valuationPrice = latestRow ? Number(latestRow.price) : Number(analysis.baseline.cost);
      const marketValue = Math.max(0, analysis.currentHolding) * Math.max(0, valuationPrice || 0);
      return { securityId: security.id, marketValue };
    });
    const totalValue = positions.reduce((sum, item) => sum + item.marketValue, 0);
    const securityValue = positions.find((item) => item.securityId === selectedSecurityId)?.marketValue || 0;
    return {
      securityValue: roundMoney(securityValue),
      totalValue: roundMoney(totalValue),
      weight: totalValue > 0 ? roundNumber(securityValue / totalValue * 100) : 0,
    };
  }

  return {
    analyzeSecurity,
    calculatePortfolioAllocation,
    createBaselineSnapshot,
    calculateFees,
    roundMoney,
    sortTransactions,
    transactionType,
    validateCashEntry,
    validateTransactionHistory,
    validateTrade,
  };
});
