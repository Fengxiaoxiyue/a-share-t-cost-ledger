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

  function analyzeSecurity(security, transactions, feeSettings, options = {}) {
    const relevant = sortTransactions(
      transactions.filter((item) => item.securityId === security.id)
    );
    const initialQuantity = Number(security.initialQuantity) || 0;
    const initialCost = Number(security.initialCost) || 0;
    let holding = initialQuantity;
    let costBalance = initialQuantity * initialCost;
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
          holdingDifference: holding - initialQuantity,
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
          costReductionPerInitialShare: initialQuantity > 0 ? roundNumber(profit / initialQuantity) : 0,
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
        holdingDifference: holding - initialQuantity,
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
      holdingDifference: holding - initialQuantity,
      costBalance: roundNumber(costBalance),
      dilutedCost: holding > 0 ? roundNumber(costBalance / holding) : null,
      costReduction: holding > 0 ? roundNumber(initialCost - costBalance / holding) : null,
      cumulativeClosedProfit: roundNumber(cumulativeClosedProfit),
      cumulativeFees,
      cumulativeDividend,
      cumulativeDividendTax,
      netDividend: roundMoney(cumulativeDividend - cumulativeDividendTax),
      includeDividendsInCost,
      unmatched,
    };
  }

  function validateCashEntry(candidate) {
    if (!candidate.datetime) return "请选择记录时间";
    const amount = Number(candidate.amount);
    if (!Number.isFinite(amount) || amount <= 0) return "金额必须大于 0";
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
    let holding = Number(security.initialQuantity) || 0;
    for (const item of sortTransactions(next)) {
      if (transactionType(item) !== "trade") continue;
      holding += item.side === "buy" ? Number(item.quantity) : -Number(item.quantity);
      if (holding < 0) return "该交易会使历史持仓变为负数，请检查时间或数量";
    }
    return "";
  }

  function calculatePortfolioAllocation(securities, transactions, feeSettings, selectedSecurityId, options = {}) {
    const positions = securities.map((security) => {
      const analysis = analyzeSecurity(security, transactions, feeSettings, options);
      const latestRow = [...analysis.rows].reverse().find((row) => row.entryType === "trade");
      const valuationPrice = latestRow ? Number(latestRow.price) : Number(security.initialCost);
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
    calculateFees,
    roundMoney,
    sortTransactions,
    transactionType,
    validateCashEntry,
    validateTrade,
  };
});
