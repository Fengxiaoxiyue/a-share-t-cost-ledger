(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TradeScreenshotParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FIELD_ALIASES = {
    security: ["证券/代码", "证券代码", "股票代码", "证券名称", "股票名称"],
    datetime: ["日期/时间", "成交时间", "交易时间", "成交日期", "交易日期"],
    priceQuantity: ["价格/数量", "成交价/成交量", "成交价格/成交数量"],
    price: ["成交价格", "成交价", "价格"],
    quantity: ["成交数量", "成交量", "数量"],
    amount: ["成交金额", "成交额", "金额"],
    side: ["买卖方向", "操作", "委托方向", "业务名称", "业务类型"],
  };
  const CASH_LABEL = /股息|红利税|分红|利息归本/;
  const DATE_RE = /\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/;
  const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/;

  function textOf(block) { return String(block?.text || "").trim(); }
  function center(block) {
    if (Number.isFinite(block?.x) && Number.isFinite(block?.y)) return block;
    const points = Array.isArray(block?.box) ? block.box : [];
    const xs = points.map((point) => Number(point[0])), ys = points.map((point) => Number(point[1]));
    return { ...block, x: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0 };
  }
  function cleanNumber(value) {
    const normalized = String(value ?? "").replace(/[,，￥¥\s]/g, "").replace(/[Oo]/g, "0");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : undefined;
  }
  function normalizeDate(value) {
    const match = String(value || "").match(DATE_RE);
    if (!match) return undefined;
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  function normalizeTime(value) {
    const match = String(value || "").match(TIME_RE);
    if (!match) return undefined;
    return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
  }
  function parseSide(text, quantity) {
    if (/卖出|证券卖|委托卖|\bS\b/i.test(text)) return "sell";
    if (/买入|证券买|委托买|\bB\b/i.test(text)) return "buy";
    if (Number(quantity) < 0) return "sell";
    return undefined;
  }
  function meanScore(blocks) {
    const scores = blocks.map((block) => Number(block.score)).filter(Number.isFinite);
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined;
  }
  function matchHeader(block, aliases) {
    const text = textOf(block).replace(/\s/g, "");
    return aliases.some((alias) => text.includes(alias.replace(/\s/g, "")));
  }
  function nearestByX(blocks, x, predicate = () => true) {
    return blocks.filter(predicate).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  }
  function rowBands(anchors) {
    return anchors.map((anchor, index) => ({
      anchor,
      top: index ? (anchors[index - 1].y + anchor.y) / 2 : anchor.y - Math.max(100, anchors[1] ? (anchors[1].y - anchor.y) / 2 : 100),
      bottom: index < anchors.length - 1 ? (anchor.y + anchors[index + 1].y) / 2 : anchor.y + Math.max(100, anchors[index - 1] ? (anchor.y - anchors[index - 1].y) / 2 : 100),
    }));
  }
  function numberBlocks(blocks) { return blocks.filter((block) => /^[-+]?\s*[\dOo,，]+(?:\.\d+)?$/.test(textOf(block))); }

  function parseTable(blocks, sourceImageId) {
    const normalized = blocks.map(center).filter((block) => textOf(block));
    const headers = {
      security: normalized.find((block) => matchHeader(block, FIELD_ALIASES.security)),
      datetime: normalized.find((block) => matchHeader(block, FIELD_ALIASES.datetime)),
      priceQuantity: normalized.find((block) => matchHeader(block, FIELD_ALIASES.priceQuantity)),
      amount: normalized.find((block) => matchHeader(block, FIELD_ALIASES.amount)),
    };
    if (!headers.datetime || !headers.priceQuantity) return null;
    const headerY = Math.max(...Object.values(headers).filter(Boolean).map((block) => block.y));
    const dateAnchors = normalized.filter((block) => block.y > headerY && normalizeDate(textOf(block))).sort((a, b) => a.y - b.y);
    if (!dateAnchors.length) return null;
    const globalSymbol = normalized.find((block) => /^\s*[0368]\d{5}\s*$/.test(textOf(block)))?.text?.match(/\d{6}/)?.[0]
      || normalized.find((block) => /[0368]\d{5}/.test(textOf(block)))?.text?.match(/[0368]\d{5}/)?.[0];
    const records = [], skippedRows = [];

    rowBands(dateAnchors).forEach(({ anchor, top, bottom }, rowIndex) => {
      const row = normalized.filter((block) => block.y >= top && block.y < bottom && block.y > headerY);
      const rowText = row.map(textOf).join(" ");
      const date = normalizeDate(textOf(anchor));
      const timeBlock = row.find((block) => normalizeTime(textOf(block)));
      const time = normalizeTime(textOf(timeBlock)) || "00:00:00";
      const symbolBlock = row.find((block) => /^\s*[0368]\d{5}\s*$/.test(textOf(block)));
      const symbol = symbolBlock?.text?.match(/[0368]\d{5}/)?.[0] || globalSymbol;
      const securityColumn = headers.security?.x ?? Math.min(...normalized.map((block) => block.x));
      const securityBlocks = row.filter((block) => Math.abs(block.x - securityColumn) < Math.max(180, Math.abs((headers.datetime?.x || 0) - securityColumn) / 2));
      const stockName = securityBlocks.map(textOf).find((text) => /[\u3400-\u9fff]{2,}/.test(text) && !FIELD_ALIASES.security.some((alias) => text.includes(alias)));
      const numeric = numberBlocks(row);
      const pqX = headers.priceQuantity.x;
      const pqBlocks = numeric.filter((block) => Math.abs(block.x - pqX) < Math.max(190, headers.amount ? Math.abs(headers.amount.x - pqX) / 2 : 220));
      const decimalBlocks = pqBlocks.filter((block) => /\./.test(textOf(block))).sort((a, b) => a.y - b.y);
      const integerBlocks = pqBlocks.filter((block) => !/\./.test(textOf(block))).sort((a, b) => a.y - b.y);
      const priceBlock = decimalBlocks[0] || nearestByX(pqBlocks, pqX);
      const quantityBlock = integerBlocks[0] || pqBlocks.find((block) => block !== priceBlock);
      const signedQuantity = cleanNumber(textOf(quantityBlock));
      const amountBlock = headers.amount ? nearestByX(numeric.filter((block) => block !== priceBlock && block !== quantityBlock), headers.amount.x) : undefined;
      const cashType = /红利税/.test(rowText) ? "dividend_tax" : /股息|分红|利息归本/.test(rowText) ? "dividend" : undefined;
      const side = parseSide(rowText, signedQuantity);
      const amount = cleanNumber(textOf(amountBlock));
      if (cashType) {
        const warnings = [];
        if (!date) warnings.push("缺少记录日期");
        if (!symbol && !stockName) warnings.push("缺少股票代码或名称");
        if (!(amount > 0)) warnings.push("股息或红利税金额缺失或无效");
        const used = [anchor, timeBlock, symbolBlock, amountBlock, row.find((block) => CASH_LABEL.test(textOf(block)))].filter(Boolean);
        const confidence = meanScore(used);
        if (confidence !== undefined && confidence < 0.85) warnings.push("OCR 置信度较低，请逐项核对");
        records.push({
          tradeDate: date, tradeTime: time, datetime: date ? `${date}T${time}` : undefined,
          symbol, stockName, entryType: cashType, amount,
          source: "ocr", confidence, warnings, rawText: rowText, sourceImageId,
        });
        return;
      }
      if (!side && !priceBlock && !quantityBlock) { skippedRows.push({ rowIndex, reason: "未识别为买卖交易", rawText: rowText }); return; }
      const warnings = [];
      if (!date) warnings.push("缺少交易日期");
      if (!symbol && !stockName) warnings.push("缺少股票代码或名称");
      if (!side) warnings.push("无法确定买卖方向");
      const price = cleanNumber(textOf(priceBlock)), quantity = Math.abs(Number(signedQuantity));
      if (!(price > 0)) warnings.push("成交价格缺失或无效");
      if (!(quantity > 0)) warnings.push("成交数量缺失或无效");
      if (price > 0 && quantity > 0 && amount > 0) {
        const expected = price * quantity;
        if (Math.abs(expected - amount) > Math.max(0.05, amount * 0.005)) warnings.push(`成交金额可能识别错误：价格×数量应为 ${expected.toFixed(2)}`);
      }
      const used = [anchor, timeBlock, symbolBlock, priceBlock, quantityBlock, amountBlock].filter(Boolean);
      const confidence = meanScore(used);
      if (confidence !== undefined && confidence < 0.85) warnings.push("OCR 置信度较低，请逐项核对");
      records.push({
        tradeDate: date, tradeTime: time, datetime: date ? `${date}T${time}` : undefined,
        symbol, stockName, entryType: side, side, price, quantity: quantity || undefined, amount,
        source: "ocr", confidence, warnings, rawText: rowText, sourceImageId,
      });
    });
    return { layout: "table", records, skippedRows, warnings: skippedRows.length ? [`已跳过 ${skippedRows.length} 条无法确认的记录`] : [] };
  }

  function parseDetails(blocks, sourceImageId) {
    const normalized = blocks.map(center).sort((a, b) => a.y - b.y || a.x - b.x);
    const values = {};
    Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
      if (field === "security" || field === "priceQuantity") return;
      const label = normalized.find((block) => matchHeader(block, aliases));
      if (!label) return;
      const candidates = normalized.filter((block) => block !== label && block.y >= label.y - 8);
      values[field] = candidates.sort((a, b) => {
        const sameLineA = Math.abs(a.y - label.y) < 50 ? 0 : 1;
        const sameLineB = Math.abs(b.y - label.y) < 50 ? 0 : 1;
        return sameLineA - sameLineB || Math.hypot(a.x - label.x, a.y - label.y) - Math.hypot(b.x - label.x, b.y - label.y);
      })[0];
    });
    const allText = normalized.map(textOf).join(" ");
    const symbol = allText.match(/\b[0368]\d{5}\b/)?.[0];
    const date = normalizeDate(allText);
    const time = normalizeTime(allText) || "00:00:00";
    const price = cleanNumber(textOf(values.price));
    const quantityRaw = cleanNumber(textOf(values.quantity));
    const amount = cleanNumber(textOf(values.amount));
    const side = parseSide(textOf(values.side) || allText, quantityRaw);
    const cashType = /红利税/.test(allText) ? "dividend_tax" : /股息|分红|利息归本/.test(allText) ? "dividend" : undefined;
    if (!date && !price && !quantityRaw && !side && !cashType) return { layout: "unknown", records: [], skippedRows: [], warnings: ["未识别到受支持的成交表格或详情字段"] };
    const warnings = [];
    if (!date) warnings.push("缺少交易日期");
    if (!symbol) warnings.push("缺少股票代码");
    if (cashType) {
      if (!(amount > 0)) warnings.push("股息或红利税金额缺失或无效");
      return { layout: "detail", skippedRows: [], warnings: [], records: [{
        tradeDate: date, tradeTime: time, datetime: date ? `${date}T${time}` : undefined,
        symbol, entryType: cashType, amount,
        source: "ocr", confidence: meanScore(Object.values(values).filter(Boolean)), warnings, rawText: allText, sourceImageId,
      }] };
    }
    if (!side) warnings.push("无法确定买卖方向");
    if (!(price > 0)) warnings.push("成交价格缺失或无效");
    if (!(Math.abs(quantityRaw) > 0)) warnings.push("成交数量缺失或无效");
    if (price > 0 && Math.abs(quantityRaw) > 0 && amount > 0 && Math.abs(price * Math.abs(quantityRaw) - amount) > Math.max(0.05, amount * 0.005)) warnings.push("成交金额与价格×数量不一致");
    return { layout: "detail", skippedRows: [], warnings: [], records: [{
      tradeDate: date, tradeTime: time, datetime: date ? `${date}T${time}` : undefined,
      symbol, entryType: side, side, price, quantity: Math.abs(quantityRaw) || undefined, amount,
      source: "ocr", confidence: meanScore(Object.values(values).filter(Boolean)), warnings, rawText: allText, sourceImageId,
    }] };
  }

  function parseOcrBlocks(blocks, options = {}) {
    const table = parseTable(blocks || [], options.sourceImageId);
    return table || parseDetails(blocks || [], options.sourceImageId);
  }

  function fingerprint(trade) {
    if (trade.type === "dividend" || trade.type === "dividend_tax" || trade.entryType === "dividend" || trade.entryType === "dividend_tax") {
      return [trade.securityId || trade.symbol || "", String(trade.datetime || "").slice(0, 19), trade.type || trade.entryType, Number(trade.amount).toFixed(2)].join("|");
    }
    return [trade.securityId || trade.symbol || "", String(trade.datetime || "").slice(0, 19), trade.side || "", Number(trade.price).toFixed(4), Number(trade.quantity)].join("|");
  }

  return { FIELD_ALIASES, fingerprint, parseOcrBlocks };
});
