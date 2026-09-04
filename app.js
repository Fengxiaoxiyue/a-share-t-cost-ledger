(function () {
  "use strict";

  const STORAGE_KEY = "a-share-t-cost-ledger-v1";
  const DEFAULT_FEES = {
    commissionRate: 0.0001,
    minimumCommission: 5,
    transferRate: 0.00001,
    stampDutyRate: 0.0005,
  };
  const EMPTY_STATE = { version: 1, selectedSecurityId: null, securities: [], transactions: [], fees: DEFAULT_FEES, includeDividendsInCost: false };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const el = {
    securitySelect: $("#securitySelect"), marketBadge: $("#marketBadge"), workspace: $("#workspace"), emptyState: $("#emptyState"),
    dilutedCost: $("#dilutedCost"), dilutedCostHelp: $("#dilutedCostHelp"), costChange: $("#costChange"), currentHolding: $("#currentHolding"), holdingDifference: $("#holdingDifference"),
    portfolioWeight: $("#portfolioWeight"), portfolioWeightDetail: $("#portfolioWeightDetail"),
    closedProfit: $("#closedProfit"), loopCount: $("#loopCount"), totalFees: $("#totalFees"), feeHint: $("#feeHint"), netDividend: $("#netDividend"), dividendHint: $("#dividendHint"), queueStatus: $("#queueStatus"),
    baselineStatus: $("#baselineStatus"), baselineSummary: $("#baselineSummary"), baselineDetail: $("#baselineDetail"), restoreBaselineButton: $("#restoreBaselineButton"),
    dividendModeButton: $("#dividendModeButton"), tradeForm: $("#tradeForm"), tradeDatetime: $("#tradeDatetime"), tradeQuantity: $("#tradeQuantity"), tradePrice: $("#tradePrice"), cashAmount: $("#cashAmount"), cashAmountLabel: $("#cashAmountLabel"), tradeNote: $("#tradeNote"),
    editingTradeId: $("#editingTradeId"), tradeFormTitle: $("#tradeFormTitle"), cancelEditButton: $("#cancelEditButton"), tradePreview: $("#tradePreview"), tradeError: $("#tradeError"),
    transactionsBody: $("#transactionsBody"), transactionsEmpty: $("#transactionsEmpty"), loopsBody: $("#loopsBody"), loopsEmpty: $("#loopsEmpty"), sideFilter: $("#sideFilter"),
    securityDialog: $("#securityDialog"), securityForm: $("#securityForm"), securityId: $("#securityId"), securityDialogTitle: $("#securityDialogTitle"),
    securityCode: $("#securityCode"), securityName: $("#securityName"), initialQuantity: $("#initialQuantity"), initialCost: $("#initialCost"), securityError: $("#securityError"), deleteSecurityButton: $("#deleteSecurityButton"),
    feeDialog: $("#feeDialog"), feeForm: $("#feeForm"), backupDialog: $("#backupDialog"), importFile: $("#importFile"), toast: $("#toast"),
    ocrDialog: $("#ocrDialog"), ocrStatus: $("#ocrStatus"), ocrBaseUrl: $("#ocrBaseUrl"), ocrRetryButton: $("#ocrRetryButton"),
    ocrFileInput: $("#ocrFileInput"), ocrDropZone: $("#ocrDropZone"), ocrPreview: $("#ocrPreview"), ocrPreviewImage: $("#ocrPreviewImage"), ocrProgress: $("#ocrProgress"),
    ocrResultHeading: $("#ocrResultHeading"), ocrResultSummary: $("#ocrResultSummary"), ocrReviewWrap: $("#ocrReviewWrap"), ocrReviewBody: $("#ocrReviewBody"),
    ocrClearButton: $("#ocrClearButton"), ocrConfirmButton: $("#ocrConfirmButton"), ocrConfirmHint: $("#ocrConfirmHint"), ocrError: $("#ocrError"),
  };
  let state = loadState();
  const repairedOnLoad = repairInvalidBaselines(state);
  let toastTimer;
  let ocrRows = [];
  let ocrConnected = false;
  let ocrBusy = false;
  let ocrPreviewUrl = "";
  let ocrSkippedCount = 0;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.securities) || !Array.isArray(parsed.transactions)) return structuredClone(EMPTY_STATE);
      return { ...structuredClone(EMPTY_STATE), ...parsed, fees: { ...DEFAULT_FEES, ...(parsed.fees || {}) } };
    } catch (_) {
      return structuredClone(EMPTY_STATE);
    }
  }

  function repairInvalidBaselines(targetState) {
    let repaired = 0;
    targetState.securities = targetState.securities.map((security) => {
      if (!security.baseline) return security;
      const exists = targetState.transactions.some((item) => item.securityId === security.id && item.id === security.baseline.transactionId);
      const validNumbers = security.baseline.quantity !== null && security.baseline.quantity !== "" && Number.isFinite(Number(security.baseline.quantity)) && Number(security.baseline.quantity) >= 0 && Number(security.baseline.quantity) % 100 === 0 && security.baseline.cost !== null && security.baseline.cost !== "" && Number.isFinite(Number(security.baseline.cost));
      if (exists && validNumbers) return security;
      repaired += 1;
      return { ...security, baseline: null };
    });
    return repaired;
  }

  function saveState(message) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      showToast("浏览器未允许本地保存，请及时导出备份");
      return;
    }
    if (message) showToast(message);
    const saveStatus = $("#saveStatus");
    if (saveStatus) {
      saveStatus.textContent = "已保存 · " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      setTimeout(() => { saveStatus.textContent = "数据自动保存在本机"; }, 1800);
    }
  }

  function currentSecurity() {
    return state.securities.find((item) => item.id === state.selectedSecurityId) || null;
  }

  function analysisOptions() {
    return { includeDividendsInCost: Boolean(state.includeDividendsInCost) };
  }

  function selectedEntryType() {
    return $("input[name='entryType']:checked")?.value || "buy";
  }

  function isCashEntry(type = selectedEntryType()) {
    return type === "dividend" || type === "dividend_tax";
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowForInput() {
    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  }

  function money(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function number(value) {
    return Number(value).toLocaleString("zh-CN");
  }

  function signNumber(value, suffix = "") {
    const numeric = Number(value);
    return `${numeric > 0 ? "+" : ""}${number(numeric)}${suffix}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    return value.replace("T", " ").slice(0, 16);
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }

  function marketName(code) {
    if (/^(60|68)/.test(code)) return "沪市";
    if (/^(00|30)/.test(code)) return "深市";
    return "A 股";
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
  }

  function setValueClass(element, value, positiveIsGood = true) {
    element.classList.remove("positive", "negative");
    if (Number(value) === 0) return;
    element.classList.add((Number(value) > 0) === positiveIsGood ? "positive" : "negative");
  }

  function render() {
    if (state.securities.length && !currentSecurity()) state.selectedSecurityId = state.securities[0].id;
    const security = currentSecurity();
    el.securitySelect.innerHTML = state.securities.map((item) => `<option value="${item.id}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join("");
    el.securitySelect.value = state.selectedSecurityId || "";
    el.securitySelect.disabled = !security;
    el.emptyState.hidden = Boolean(security);
    el.workspace.hidden = !security;
    $("#editSecurityButton").disabled = !security;
    el.dividendModeButton.disabled = !security;
    el.marketBadge.textContent = security ? marketName(security.code) : "—";
    if (!security) return;

    const analysis = TradeEngine.analyzeSecurity(security, state.transactions, state.fees, analysisOptions());
    renderBaseline(analysis);
    renderSummary(security, analysis);
    renderLoops(security, analysis);
    renderTransactions(analysis);
    renderCharts(security, analysis);
    updateTradePreview();
  }

  function renderBaseline(analysis) {
    const baseline = analysis.baseline;
    el.restoreBaselineButton.hidden = !baseline.isCustom;
    if (baseline.isCustom) {
      el.baselineSummary.textContent = `${formatDate(baseline.datetime)} 后的状态`;
      el.baselineDetail.textContent = `${number(baseline.quantity)} 股 · 成本 ${baseline.quantity > 0 ? `¥${money(baseline.cost, 4)} / 股` : "已清仓，成本归零"}`;
    } else {
      el.baselineSummary.textContent = "原始初始状态";
      el.baselineDetail.textContent = `${number(baseline.quantity)} 股 · 成本 ¥${money(baseline.cost, 4)} / 股`;
    }
  }

  function renderSummary(security, analysis) {
    el.dilutedCost.textContent = analysis.dilutedCost === null ? "已清仓" : `¥ ${money(analysis.dilutedCost, 4)}`;
    const reduction = analysis.costReduction;
    el.costChange.textContent = reduction === null ? "当前无持仓，暂不计算单位成本" : `${reduction >= 0 ? "较基准降低" : "较基准升高"} ¥ ${money(Math.abs(reduction), 4)} / 股`;
    setValueClass(el.costChange, reduction, true);
    el.dividendModeButton.textContent = state.includeDividendsInCost ? "股息模式：计入成本" : "股息模式：不计入成本";
    el.dividendModeButton.classList.toggle("active", state.includeDividendsInCost);
    el.dividendModeButton.setAttribute("aria-pressed", String(Boolean(state.includeDividendsInCost)));
    el.dilutedCostHelp.title = state.includeDividendsInCost
      ? "基准持仓总成本 + 基准后买入支出 − 基准后卖出净收入 − 基准后分红 + 基准后红利税，再除以当前持仓。"
      : "基准持仓总成本 + 基准后买入支出 − 基准后卖出净收入，再除以当前持仓；股息不参与成本。";
    el.currentHolding.textContent = `${number(analysis.currentHolding)} 股`;
    el.holdingDifference.textContent = `基准 ${number(analysis.baseline.quantity)} 股 · 当前偏差 ${signNumber(analysis.holdingDifference, " 股")}`;
    setValueClass(el.holdingDifference, analysis.holdingDifference, false);
    const allocation = TradeEngine.calculatePortfolioAllocation(state.securities, state.transactions, state.fees, security.id, analysisOptions());
    el.portfolioWeight.textContent = allocation.totalValue > 0 ? `${money(allocation.weight, 2)}%` : "—";
    el.portfolioWeightDetail.textContent = allocation.totalValue > 0
      ? `本股 ¥${money(allocation.securityValue)} / 全部 ¥${money(allocation.totalValue)}`
      : "全部股票的估算持仓市值为 0";
    el.closedProfit.textContent = `¥ ${money(analysis.cumulativeClosedProfit)}`;
    setValueClass(el.closedProfit, analysis.cumulativeClosedProfit, true);
    el.loopCount.textContent = `${analysis.loops.length} 个 FIFO 配对 · 未配买 ${number(analysis.unmatched.buy)} / 卖 ${number(analysis.unmatched.sell)} 股`;
    el.totalFees.textContent = `¥ ${money(analysis.cumulativeFees)}`;
    el.feeHint.textContent = `佣金万${state.fees.commissionRate * 10000} · 最低 ¥${money(state.fees.minimumCommission)} · 印花税万${state.fees.stampDutyRate * 10000}`;
    el.netDividend.textContent = `¥ ${money(analysis.netDividend)}`;
    setValueClass(el.netDividend, analysis.netDividend, true);
    el.dividendHint.textContent = `分红 ¥${money(analysis.cumulativeDividend)} · 红利税 ¥${money(analysis.cumulativeDividendTax)} · ${state.includeDividendsInCost ? "已计入成本" : "未计入成本"}`;
  }

  function renderLoops(security, analysis) {
    el.loopsEmpty.hidden = analysis.loops.length > 0;
    el.queueStatus.textContent = analysis.unmatched.buy || analysis.unmatched.sell
      ? `等待配对：买 ${number(analysis.unmatched.buy)} 股 / 卖 ${number(analysis.unmatched.sell)} 股`
      : "当前交易已全部配对";
    el.loopsBody.innerHTML = [...analysis.loops].reverse().map((loop) => `
      <tr>
        <td>${formatDate(loop.openedAt)}</td><td>${formatDate(loop.closedAt)}</td>
        <td><span class="side-tag ${loop.direction === "buy-sell" ? "buy" : "sell"}">${loop.direction === "buy-sell" ? "先买后卖" : "先卖后买"}</span></td>
        <td class="number">${number(loop.quantity)}</td><td class="number">¥ ${money(loop.buyUnitCost, 4)}</td><td class="number">¥ ${money(loop.sellUnitProceeds, 4)}</td>
        <td class="number ${loop.profit >= 0 ? "positive" : "negative"}">${loop.profit >= 0 ? "+" : "−"}¥ ${money(Math.abs(loop.profit))}</td>
        <td class="number ${loop.costReductionPerBaselineShare >= 0 ? "positive" : "negative"}">${loop.costReductionPerBaselineShare >= 0 ? "−" : "+"}¥ ${money(Math.abs(loop.costReductionPerBaselineShare), 4)}/股</td>
      </tr>`).join("");
  }

  function renderTransactions(analysis) {
    const filter = el.sideFilter.value;
    const rows = [...analysis.historyRows].reverse().filter((row) => filter === "all" || (row.entryType === "trade" ? row.side : row.entryType) === filter);
    el.transactionsEmpty.hidden = rows.length > 0;
    el.transactionsBody.innerHTML = rows.map((row) => {
      const type = row.entryType === "trade" ? row.side : row.entryType;
      const typeLabel = { buy: "买入", sell: "卖出", dividend: "分红入账", dividend_tax: "红利税" }[type];
      const segmentLabel = { before: "基准前", baseline: "当前基准", after: "基准后" }[row.baselineSegment];
      const amountText = row.entryType === "trade" ? money(row.fees.gross) : `${type === "dividend" ? "+" : "−"}${money(row.amount)}`;
      const isAnchor = row.baselineSegment === "baseline";
      const differenceText = row.baselineSegment === "before" ? "—" : signNumber(row.holdingDifference);
      return `
      <tr class="${row.baselineSegment === "before" ? "baseline-history" : isAnchor ? "current-baseline" : ""}">
        <td>${formatDate(row.datetime)}</td><td><span class="segment-tag ${row.baselineSegment}">${segmentLabel}</span></td><td><span class="side-tag ${type}">${typeLabel}</span></td>
        <td class="number">${row.entryType === "trade" ? number(row.quantity) : "—"}</td><td class="number">${row.entryType === "trade" ? `¥ ${money(row.price, 4)}` : "—"}</td><td class="number ${type === "dividend" ? "positive" : type === "dividend_tax" ? "negative" : ""}">¥ ${amountText}</td>
        <td class="number" ${row.entryType === "trade" ? `title="佣金 ${money(row.fees.commission)}；过户费 ${money(row.fees.transferFee)}；印花税 ${money(row.fees.stampDuty)}"` : ""}>${row.entryType === "trade" ? `¥ ${money(row.fees.total)}` : "—"}</td>
        <td class="number">${number(row.holdingAfter)}</td><td class="number ${row.baselineSegment !== "before" && row.holdingDifference > 0 ? "negative" : row.baselineSegment !== "before" && row.holdingDifference < 0 ? "positive" : ""}">${differenceText}</td>
        <td class="number">${row.dilutedCostAfter === null ? "—" : `¥ ${money(row.dilutedCostAfter, 4)}`}</td><td>${escapeHtml(row.note || "—")}</td>
        <td><button class="table-action" data-baseline="${row.id}" ${isAnchor ? "disabled title=\"请先移动或恢复基准\"" : ""}>${isAnchor ? "当前基准" : "设为基准"}</button><button class="table-action" data-edit="${row.id}" ${isAnchor ? "disabled title=\"请先移动或恢复基准\"" : ""}>编辑</button><button class="table-action delete" data-delete="${row.id}" ${isAnchor ? "disabled title=\"请先移动或恢复基准\"" : ""}>删除</button></td>
      </tr>`;
    }).join("");
  }

  function renderCharts(security, analysis) {
    const costData = [{ label: "基准", cost: Number(analysis.baseline.cost), price: null, side: null }].concat(
      analysis.rows.map((row) => ({ label: formatDate(row.datetime), cost: row.dilutedCostAfter, price: row.entryType === "trade" ? Number(row.price) : null, side: row.entryType === "trade" ? row.side : null }))
    );
    drawLineChart($("#costChart"), costData, [
      { key: "cost", label: "摊薄成本", color: "#1671c9", format: (v) => `¥${money(v, 4)}` },
      {
        key: "price",
        label: "成交价",
        color: "#c67b12",
        pointColor: (item) => item.side === "buy" ? "#d84a4a" : item.side === "sell" ? "#16887b" : "#c67b12",
        pointRadius: 3.6,
        format: (v) => `¥${money(v, 4)}`,
      },
    ]);
    const positionData = [{ label: "基准", position: 0, profit: 0 }].concat(
      analysis.rows.map((row) => ({ label: formatDate(row.datetime), position: row.holdingDifference, profit: row.cumulativeClosedProfit }))
    );
    drawDualChart($("#positionChart"), positionData);
  }

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function chartFrame(container, values, baselineZero = false, digits = 2) {
    container.innerHTML = "";
    if (values.length <= 1) {
      container.innerHTML = '<div class="chart-empty">录入交易后生成趋势图</div>';
      return null;
    }
    const width = 680, height = 270, pad = { top: 16, right: 22, bottom: 32, left: 52 };
    let min = Math.min(...values), max = Math.max(...values);
    if (baselineZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    if (Math.abs(max - min) < 1e-8) { min -= 1; max += 1; }
    const extra = (max - min) * .12; min -= extra; max += extra;
    const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" });
    const x = (index, count) => pad.left + index * ((width - pad.left - pad.right) / Math.max(count - 1, 1));
    const y = (value) => pad.top + (max - value) * ((height - pad.top - pad.bottom) / (max - min));
    for (let i = 0; i < 4; i++) {
      const value = max - (max - min) * i / 3;
      const cy = y(value);
      svg.appendChild(svgElement("line", { x1: pad.left, y1: cy, x2: width - pad.right, y2: cy, stroke: "#e4ebf1", "stroke-width": 1 }));
      const label = svgElement("text", { x: pad.left - 8, y: cy + 4, "text-anchor": "end", fill: "#7a899a", "font-size": 10 });
      label.textContent = Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(digits);
      svg.appendChild(label);
    }
    const baseline = y(0);
    if (baselineZero && baseline >= pad.top && baseline <= height - pad.bottom) svg.appendChild(svgElement("line", { x1: pad.left, y1: baseline, x2: width - pad.right, y2: baseline, stroke: "#9aabba", "stroke-width": 1.2 }));
    container.appendChild(svg);
    return { svg, width, height, pad, x, y };
  }

  function addTooltip(container, frame, data, htmlForIndex) {
    const { svg, width, pad, x } = frame;
    const overlay = svgElement("rect", { x: pad.left, y: pad.top, width: width - pad.left - pad.right, height: frame.height - pad.top - pad.bottom, fill: "transparent" });
    const guide = svgElement("line", { y1: pad.top, y2: frame.height - pad.bottom, stroke: "#93a6b8", "stroke-dasharray": "3 3", visibility: "hidden" });
    svg.appendChild(guide); svg.appendChild(overlay);
    let tooltip;
    overlay.addEventListener("mousemove", (event) => {
      const rect = svg.getBoundingClientRect();
      const viewX = (event.clientX - rect.left) * width / rect.width;
      const index = Math.max(0, Math.min(data.length - 1, Math.round((viewX - pad.left) / ((width - pad.left - pad.right) / Math.max(data.length - 1, 1)))));
      guide.setAttribute("x1", x(index, data.length)); guide.setAttribute("x2", x(index, data.length)); guide.setAttribute("visibility", "visible");
      if (!tooltip) { tooltip = document.createElement("div"); tooltip.className = "chart-tooltip"; container.appendChild(tooltip); }
      tooltip.innerHTML = htmlForIndex(index);
      const horizontalRatio = x(index, data.length) / width;
      tooltip.classList.toggle("align-right", horizontalRatio > .78);
      tooltip.classList.toggle("align-left", horizontalRatio < .22);
      tooltip.style.left = `${horizontalRatio * 100}%`; tooltip.style.top = "48%";
    });
    overlay.addEventListener("mouseleave", () => { guide.setAttribute("visibility", "hidden"); tooltip?.remove(); tooltip = null; });
  }

  function drawLineChart(container, data, series) {
    const values = data.flatMap((item) => series.map((entry) => item[entry.key])).filter((value) => value !== null && Number.isFinite(Number(value))).map(Number);
    const frame = chartFrame(container, values, false, 4);
    if (!frame) return;
    series.forEach((entry) => {
      let path = "", hasPoint = false;
      data.forEach((item, index) => {
        const value = item[entry.key];
        if (value === null || !Number.isFinite(Number(value))) return;
        path += `${hasPoint ? "L" : "M"}${frame.x(index, data.length)},${frame.y(Number(value))} `;
        hasPoint = true;
      });
      frame.svg.appendChild(svgElement("path", { d: path, fill: "none", stroke: entry.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      data.forEach((item, index) => {
        if (item[entry.key] === null || !Number.isFinite(Number(item[entry.key]))) return;
        const pointColor = entry.pointColor ? entry.pointColor(item) : entry.color;
        frame.svg.appendChild(svgElement("circle", { cx: frame.x(index, data.length), cy: frame.y(Number(item[entry.key])), r: entry.pointRadius || 3, fill: "white", stroke: pointColor, "stroke-width": 2.4 }));
      });
    });
    addTooltip(container, frame, data, (index) => `<strong>${data[index].label}</strong><br>${series.filter((s) => data[index][s.key] !== null).map((s) => `${s.label}：${s.format(data[index][s.key])}`).join("<br>")}`);
  }

  function drawDualChart(container, data) {
    const positionValues = data.map((item) => Number(item.position));
    const profitValues = data.map((item) => Number(item.profit));
    const maxPosition = Math.max(...positionValues.map(Math.abs), 100);
    const normalized = data.map((item) => ({ ...item, profitNormalized: maxPosition * (Math.max(...profitValues.map(Math.abs), 1) ? item.profit / Math.max(...profitValues.map(Math.abs), 1) : 0) }));
    const frame = chartFrame(container, normalized.flatMap((item) => [item.position, item.profitNormalized]), true);
    if (!frame) return;
    const barWidth = Math.max(5, Math.min(22, (frame.width - frame.pad.left - frame.pad.right) / data.length * .46));
    normalized.forEach((item, index) => {
      const zeroY = frame.y(0), valueY = frame.y(item.position);
      frame.svg.appendChild(svgElement("rect", { x: frame.x(index, data.length) - barWidth / 2, y: Math.min(zeroY, valueY), width: barWidth, height: Math.max(Math.abs(valueY - zeroY), .8), rx: 2, fill: item.position > 0 ? "#df6767" : item.position < 0 ? "#35a092" : "#c8d4df", opacity: .8 }));
    });
    const path = normalized.map((item, index) => `${index ? "L" : "M"}${frame.x(index, data.length)},${frame.y(item.profitNormalized)}`).join(" ");
    frame.svg.appendChild(svgElement("path", { d: path, fill: "none", stroke: "#1671c9", "stroke-width": 2.5, "stroke-linejoin": "round" }));
    normalized.forEach((item, index) => frame.svg.appendChild(svgElement("circle", { cx: frame.x(index, data.length), cy: frame.y(item.profitNormalized), r: 3, fill: "white", stroke: "#1671c9", "stroke-width": 2 })));
    addTooltip(container, frame, data, (index) => `<strong>${data[index].label}</strong><br>较基准仓位：${signNumber(data[index].position, " 股")}<br>累计闭环收益：¥${money(data[index].profit)}`);
  }

  function openSecurityDialog(security) {
    el.securityForm.reset(); el.securityError.textContent = "";
    el.securityId.value = security?.id || "";
    el.securityDialogTitle.textContent = security ? "编辑股票" : "添加股票";
    el.securityCode.value = security?.code || ""; el.securityName.value = security?.name || "";
    el.initialQuantity.value = security?.initialQuantity ?? ""; el.initialCost.value = security?.initialCost ?? "";
    el.deleteSecurityButton.hidden = !security;
    el.securityDialog.showModal();
  }

  function saveSecurity(event) {
    event.preventDefault();
    const id = el.securityId.value;
    const code = el.securityCode.value.trim();
    const name = el.securityName.value.trim();
    const initialQuantity = Number(el.initialQuantity.value);
    const initialCost = Number(el.initialCost.value);
    if (!/^\d{6}$/.test(code)) { el.securityError.textContent = "股票代码应为 6 位数字"; return; }
    if (!name) { el.securityError.textContent = "请输入股票简称"; return; }
    if (!Number.isFinite(initialQuantity) || initialQuantity < 0 || initialQuantity % 100 !== 0) { el.securityError.textContent = "初始持仓应为 100 股的整数倍（也可为 0）"; return; }
    if (!Number.isFinite(initialCost) || initialCost < 0) { el.securityError.textContent = "初始持仓成本不能为负数"; return; }
    if (state.securities.some((item) => item.code === code && item.id !== id)) { el.securityError.textContent = "该股票代码已存在"; return; }
    const existingSecurity = state.securities.find((item) => item.id === id);
    const security = { ...existingSecurity, id: id || uid("sec"), code, name, initialQuantity, initialCost };
    if (id) {
      const historicalError = TradeEngine.validateTrade(
        security,
        state.transactions.filter((item) => item.securityId === id && item.id !== "__validation__"),
        { id: "__validation__", securityId: id, datetime: "9999-12-31T23:59", side: "buy", quantity: 100, price: 1, sequence: Number.MAX_SAFE_INTEGER },
        "__validation__"
      );
      if (historicalError.includes("历史持仓变为负数")) { el.securityError.textContent = "新的初始仓位会使某段历史持仓为负数，请先调整交易流水"; return; }
    }
    if (id) state.securities = state.securities.map((item) => item.id === id ? security : item);
    else { state.securities.push(security); state.selectedSecurityId = security.id; }
    saveState(id ? "股票设置已更新" : "股票已添加");
    el.securityDialog.close(); render();
  }

  function deleteSecurity() {
    const security = currentSecurity();
    if (!security || !confirm(`确定删除 ${security.code} ${security.name} 及其全部交易吗？此操作不可撤销。`)) return;
    state.securities = state.securities.filter((item) => item.id !== security.id);
    state.transactions = state.transactions.filter((item) => item.securityId !== security.id);
    state.selectedSecurityId = state.securities[0]?.id || null;
    saveState("股票及相关流水已删除"); el.securityDialog.close(); render();
  }

  function updateTradePreview() {
    const security = currentSecurity();
    const entryType = selectedEntryType();
    if (isCashEntry(entryType)) {
      const amount = Number(el.cashAmount.value);
      if (!security || !amount) { el.tradePreview.textContent = "输入金额后显示成本影响"; return; }
      const effect = entryType === "dividend" ? -amount : amount;
      const analysis = TradeEngine.analyzeSecurity(security, state.transactions.filter((item) => item.id !== el.editingTradeId.value), state.fees, analysisOptions());
      const afterCost = analysis.currentHolding > 0 ? (analysis.costBalance + (state.includeDividendsInCost ? effect : 0)) / analysis.currentHolding : null;
      el.tradePreview.innerHTML = `${entryType === "dividend" ? "分红入账" : "红利税补扣"} <strong>¥${money(amount)}</strong> · ${state.includeDividendsInCost ? `计入后摊薄成本 <strong>${afterCost === null ? "已清仓" : `¥${money(afterCost, 4)}`}</strong>` : "当前模式下仅记录，不改变摊薄成本"}`;
      return;
    }
    const quantity = Number(el.tradeQuantity.value), price = Number(el.tradePrice.value);
    if (!security || !quantity || !price) { el.tradePreview.textContent = "输入价格后显示预估费用"; return; }
    const side = entryType;
    const fees = TradeEngine.calculateFees({ quantity, price, side }, state.fees);
    const analysis = TradeEngine.analyzeSecurity(security, state.transactions.filter((item) => item.id !== el.editingTradeId.value), state.fees, analysisOptions());
    const after = analysis.currentHolding + (side === "buy" ? quantity : -quantity);
    el.tradePreview.innerHTML = `成交额 <strong>¥${money(fees.gross)}</strong> · 费用 <strong>¥${money(fees.total)}</strong>（佣金 ${money(fees.commission)} / 过户 ${money(fees.transferFee)} / 印花税 ${money(fees.stampDuty)}） · 预计持仓 <strong>${number(after)} 股</strong>`;
  }

  function saveTrade(event) {
    event.preventDefault();
    const security = currentSecurity(); if (!security) return;
    const editingId = el.editingTradeId.value;
    const existing = state.transactions.find((item) => item.id === editingId);
    const entryType = selectedEntryType();
    const common = { id: editingId || uid("tx"), securityId: security.id, datetime: el.tradeDatetime.value, note: el.tradeNote.value.trim(), sequence: existing?.sequence || Date.now() };
    const trade = isCashEntry(entryType)
      ? { ...common, type: entryType, amount: Number(el.cashAmount.value) }
      : { ...common, type: "trade", side: entryType, quantity: Number(el.tradeQuantity.value), price: Number(el.tradePrice.value) };
    const error = isCashEntry(entryType)
      ? TradeEngine.validateCashEntry(trade)
      : TradeEngine.validateTrade(security, state.transactions, trade, editingId);
    if (error) { el.tradeError.textContent = error; return; }
    if (editingId) state.transactions = state.transactions.map((item) => item.id === editingId ? trade : item);
    else state.transactions.push(trade);
    saveState(editingId ? "记录已更新并重新计算" : isCashEntry(entryType) ? "股息记录已保存" : "交易已保存并自动配对");
    resetTradeForm(); render();
  }

  function setBaseline(id) {
    const security = currentSecurity();
    if (!security || security.baseline?.transactionId === id) return;
    const snapshot = TradeEngine.createBaselineSnapshot(security, state.transactions, state.fees, id, analysisOptions());
    if (!snapshot) { showToast("无法读取这条记录完成后的状态"); return; }
    const costText = snapshot.quantity > 0 ? `¥${money(snapshot.cost, 4)} / 股` : "已清仓，成本归零";
    const dividendText = state.includeDividendsInCost ? "计入成本" : "不计入成本";
    if (!confirm(`将 ${formatDate(snapshot.datetime)} 完成后的状态设为当前基准？\n\n基准持仓：${number(snapshot.quantity)} 股\n基准成本：${costText}\n股息模式：${dividendText}\n\n该记录及此前流水保留为历史；FIFO、收益、费用、股息和仓位偏差从下一条记录重新累计。`)) return;
    state.securities = state.securities.map((item) => item.id === security.id ? { ...item, baseline: snapshot } : item);
    if (el.editingTradeId.value === id) resetTradeForm();
    saveState("当前基准已移动，基准后数据已重新计算");
    render();
  }

  function restoreOriginalBaseline() {
    const security = currentSecurity();
    if (!security?.baseline) return;
    state.securities = state.securities.map((item) => item.id === security.id ? { ...item, baseline: null } : item);
    saveState("已恢复原始初始状态为基准");
    render();
  }

  function editTrade(id) {
    if (currentSecurity()?.baseline?.transactionId === id) { showToast("请先移动基准或恢复原始基准，再编辑这条记录"); return; }
    const trade = state.transactions.find((item) => item.id === id); if (!trade) return;
    const entryType = TradeEngine.transactionType(trade) === "trade" ? trade.side : trade.type;
    el.editingTradeId.value = trade.id; el.tradeDatetime.value = trade.datetime; el.tradeQuantity.value = trade.quantity ?? 100;
    el.tradePrice.value = trade.price ?? ""; el.cashAmount.value = trade.amount ?? ""; el.tradeNote.value = trade.note || "";
    $(`input[name="entryType"][value="${entryType}"]`).checked = true;
    updateEntryFormMode();
    el.tradeFormTitle.textContent = "编辑记录"; el.cancelEditButton.hidden = false; el.tradeError.textContent = "";
    updateTradePreview(); el.tradeForm.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function deleteTrade(id) {
    if (currentSecurity()?.baseline?.transactionId === id) { showToast("请先移动基准或恢复原始基准，再删除这条记录"); return; }
    const trade = state.transactions.find((item) => item.id === id); if (!trade) return;
    const entryType = TradeEngine.transactionType(trade) === "trade" ? trade.side : trade.type;
    const label = { buy: "买入", sell: "卖出", dividend: "分红入账", dividend_tax: "红利税" }[entryType];
    if (entryType === "buy" || entryType === "sell") {
      const remaining = state.transactions.filter((item) => item.id !== id);
      const historyError = TradeEngine.validateTransactionHistory(currentSecurity(), remaining);
      if (historyError) { showToast(`无法删除：${historyError}`); return; }
    }

    if (!confirm(`确定删除 ${formatDate(trade.datetime)} 的这笔${label}记录吗？`)) return;
    state.transactions = state.transactions.filter((item) => item.id !== id);
    if (el.editingTradeId.value === id) resetTradeForm();
    saveState("记录已删除，相关数据已重新计算"); render();
  }

  function updateEntryFormMode() {
    const entryType = selectedEntryType();
    const cash = isCashEntry(entryType);
    $$(".trade-only").forEach((item) => { item.hidden = cash; });
    $$(".cash-only").forEach((item) => { item.hidden = !cash; });
    el.tradeQuantity.required = !cash;
    el.tradePrice.required = !cash;
    el.cashAmount.required = cash;
    el.cashAmountLabel.textContent = entryType === "dividend_tax" ? "补扣税额（元）" : "入账金额（元）";
    updateTradePreview();
  }

  function resetTradeForm() {
    el.tradeForm.reset(); el.editingTradeId.value = ""; el.tradeDatetime.value = nowForInput(); el.tradeQuantity.value = 100;
    el.tradeFormTitle.textContent = "录入一笔记录"; el.cancelEditButton.hidden = true; el.tradeError.textContent = ""; updateEntryFormMode();
  }

  function toggleDividendMode() {
    state.includeDividendsInCost = !state.includeDividendsInCost;
    saveState(state.includeDividendsInCost ? "已开启：净股息计入摊薄成本" : "已关闭：股息仅记录、不计入成本");
    render();
  }

  function openFeeDialog() {
    $("#commissionWan").value = state.fees.commissionRate * 10000;
    $("#minimumCommission").value = state.fees.minimumCommission;
    $("#transferWan").value = state.fees.transferRate * 10000;
    $("#stampWan").value = state.fees.stampDutyRate * 10000;
    el.feeDialog.showModal();
  }

  function saveFees(event) {
    event.preventDefault();
    state.fees = {
      commissionRate: Number($("#commissionWan").value) / 10000,
      minimumCommission: Number($("#minimumCommission").value),
      transferRate: Number($("#transferWan").value) / 10000,
      stampDutyRate: Number($("#stampWan").value) / 10000,
    };
    saveState("费率已更新，所有数据已重算"); el.feeDialog.close(); render();
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`A股做T成本簿_备份_${stamp}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    showToast("完整备份已导出");
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.version !== 1 || !Array.isArray(parsed.securities) || !Array.isArray(parsed.transactions)) throw new Error("format");
        if (!confirm("恢复备份将覆盖当前浏览器中的全部数据，是否继续？")) return;
        state = { ...structuredClone(EMPTY_STATE), ...parsed, fees: { ...DEFAULT_FEES, ...(parsed.fees || {}) } };
        const repaired = repairInvalidBaselines(state);
        saveState(repaired ? "备份已恢复；无效基准已恢复为原始起点" : "备份已恢复"); el.backupDialog.close(); resetTradeForm(); render();
      } catch (_) { showToast("无法识别该备份文件"); }
    };
    reader.readAsText(file, "utf-8"); el.importFile.value = "";
  }

  function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
  function exportCsv() {
    const security = currentSecurity(); if (!security) return;
    const analysis = TradeEngine.analyzeSecurity(security, state.transactions, state.fees, analysisOptions());
    const header = ["记录时间","基准区段","类型","数量(股)","成交价格","发生金额","佣金","过户费","印花税","总费用","记录后持仓","较基准仓位","摊薄成本","备注"];
    const lines = [header, ...analysis.historyRows.map((row) => {
      const type = row.entryType === "trade" ? row.side : row.entryType;
      const label = { buy: "买入", sell: "卖出", dividend: "分红入账", dividend_tax: "股息红利税" }[type];
      const amount = row.entryType === "trade" ? row.fees.gross : (type === "dividend" ? row.amount : -row.amount);
      const segment = { before: "基准前", baseline: "当前基准", after: "基准后" }[row.baselineSegment];
      return [row.datetime,segment,label,row.entryType === "trade" ? row.quantity : "",row.entryType === "trade" ? Number(row.price).toFixed(4) : "",amount,row.fees.commission,row.fees.transferFee,row.fees.stampDuty,row.fees.total,row.holdingAfter,row.baselineSegment === "before" ? "" : row.holdingDifference,row.dilutedCostAfter === null ? "" : Number(row.dilutedCostAfter).toFixed(4),row.note || ""];
    })];
    download(`${security.code}_${security.name}_交易流水.csv`, "\ufeff" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
    showToast("当前股票流水已导出");
  }

  function setOcrStatus(status, message) {
    ocrConnected = status === "connected";
    el.ocrStatus.className = `ocr-status ${status}`;
    el.ocrStatus.textContent = message;
    el.ocrDropZone.disabled = ocrBusy || !ocrConnected;
  }

  async function checkOcrConnection() {
    setOcrStatus("checking", "Umi-OCR ● 检测中");
    el.ocrBaseUrl.textContent = UmiOcr.configuredBaseUrl().replace(/^http:\/\//, "");
    const result = await UmiOcr.checkConnection();
    if (result.connected) {
      setOcrStatus("connected", "Umi-OCR ● 已连接");
      el.ocrProgress.textContent = ocrRows.length ? "识别已完成，请逐笔校对。" : "可拖入券商成交截图开始识别。";
      el.ocrError.textContent = "";
    } else {
      setOcrStatus("offline", "Umi-OCR ● 未运行");
      el.ocrProgress.textContent = "未检测到本机 Umi-OCR。请启动 Umi-OCR 后重试。默认服务地址：127.0.0.1:1224";
    }
    return result.connected;
  }

  function releaseOcrPreview() {
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    ocrPreviewUrl = "";
  }

  function clearOcrReview() {
    releaseOcrPreview();
    ocrRows = [];
    ocrSkippedCount = 0;
    el.ocrFileInput.value = "";
    el.ocrPreviewImage.hidden = true;
    el.ocrPreviewImage.removeAttribute("src");
    el.ocrPreview.querySelector("span").hidden = false;
    el.ocrResultHeading.hidden = true;
    el.ocrReviewWrap.hidden = true;
    el.ocrReviewBody.innerHTML = "";
    el.ocrError.textContent = "";
    el.ocrConfirmButton.disabled = true;
    el.ocrConfirmHint.textContent = "OCR 结果必须逐笔校对";
    el.ocrProgress.textContent = ocrConnected ? "可拖入券商成交截图开始识别。" : "连接 Umi-OCR 后即可开始。";
  }

  function findSecurityForOcr(trade) {
    if (trade.symbol) return state.securities.find((item) => item.code === trade.symbol)?.id || "";
    if (trade.stockName) return state.securities.find((item) => item.name === trade.stockName)?.id || "";
    return "";
  }

  function securityOptions(selectedId) {
    return `<option value="">请选择</option>` + state.securities.map((security) => `<option value="${security.id}" ${security.id === selectedId ? "selected" : ""}>${escapeHtml(security.code)} · ${escapeHtml(security.name)}</option>`).join("");
  }

  function candidateFromOcr(row, index) {
    const common = {
      id: `ocr_validation_${row.id}`,
      securityId: row.securityId,
      datetime: row.datetime,
      sequence: Date.now() + index,
      source: "ocr",
      note: "OCR 截图导入",
    };
    if (isCashEntry(row.entryType)) return { ...common, type: row.entryType, amount: Number(row.amount) };
    return { ...common, type: "trade", side: row.entryType, quantity: Number(row.quantity), price: Number(row.price) };
  }

  function validateOcrRows() {
    const pending = [];
    const existingFingerprints = new Set(state.transactions.map(TradeScreenshotParser.fingerprint));
    const pendingFingerprints = new Set();
    const chronologicalRows = ocrRows.map((row, index) => ({ row, index })).sort((a, b) => String(a.row.datetime || "").localeCompare(String(b.row.datetime || "")) || a.index - b.index);
    chronologicalRows.forEach(({ row, index }) => {
      const errors = [], warnings = [...(row.parserWarnings || [])];
      const security = state.securities.find((item) => item.id === row.securityId);
      const cash = isCashEntry(row.entryType);
      if (!security) errors.push("请选择已添加的股票");
      if (!row.datetime) errors.push("缺少记录时间");
      if (!row.entryType) errors.push("缺少记录类型");
      if (cash && !(Number(row.amount) > 0)) errors.push("金额必须大于 0");
      if (!cash && !(Number(row.price) > 0)) errors.push("价格必须大于 0");
      if (!cash && !(Number(row.quantity) > 0)) errors.push("数量必须大于 0");
      if (security && row.symbol && security.code !== row.symbol) warnings.push(`截图代码 ${row.symbol} 与所选股票不一致`);
      if (security && row.stockName && security.name !== row.stockName) warnings.push(`截图名称 ${row.stockName} 与所选股票不一致`);
      if (!cash && Number(row.price) > 0 && Number(row.quantity) > 0 && Number(row.amount) > 0) {
        const expected = Number(row.price) * Number(row.quantity);
        if (Math.abs(expected - Number(row.amount)) > Math.max(0.05, Number(row.amount) * 0.005)) warnings.push(`金额不一致，应为 ${expected.toFixed(2)}`);
      }
      const candidate = candidateFromOcr(row, index);
      if (!errors.length) {
        const engineError = cash
          ? TradeEngine.validateCashEntry(candidate)
          : TradeEngine.validateTrade(security, state.transactions.concat(pending), candidate);
        if (engineError) errors.push(engineError);
      }
      const fingerprint = TradeScreenshotParser.fingerprint(candidate);
      row.duplicate = existingFingerprints.has(fingerprint) || pendingFingerprints.has(fingerprint);
      if (row.duplicate) warnings.push("疑似重复记录；如仍勾选导入即表示确认保留");
      row.errors = [...new Set(errors)];
      row.warnings = [...new Set(warnings)];
      if (row.selected && !row.errors.length) {
        pending.push(candidate);
        pendingFingerprints.add(fingerprint);
      }
    });
  }

  function renderOcrRows() {
    validateOcrRows();
    el.ocrReviewBody.innerHTML = ocrRows.map((row, index) => {
      const cash = isCashEntry(row.entryType);
      const status = row.errors.length ? row.errors.join("；") : row.warnings.length ? row.warnings.join("；") : "校验通过";
      const statusClass = row.errors.length ? "error" : row.warnings.length ? "warning" : "ok";
      const rowClass = `${row.errors.length ? "has-error" : row.warnings.length ? "has-warning" : ""} ${Number(row.confidence) < .85 ? "low-confidence" : ""}`;
      const confidence = Number.isFinite(Number(row.confidence)) ? `OCR 置信度 ${(Number(row.confidence) * 100).toFixed(1)}%` : "";
      return `<tr data-index="${index}" class="${rowClass}">
        <td><input type="checkbox" data-field="selected" ${row.selected ? "checked" : ""} aria-label="导入第 ${index + 1} 笔" /></td>
        <td><select class="ocr-security" data-field="securityId">${securityOptions(row.securityId)}</select></td>
        <td><input class="ocr-datetime" type="datetime-local" step="1" data-field="datetime" value="${escapeHtml(row.datetime || "")}" /></td>
        <td><select data-field="entryType"><option value="">请选择</option><option value="buy" ${row.entryType === "buy" ? "selected" : ""}>买入</option><option value="sell" ${row.entryType === "sell" ? "selected" : ""}>卖出</option><option value="dividend" ${row.entryType === "dividend" ? "selected" : ""}>分红</option><option value="dividend_tax" ${row.entryType === "dividend_tax" ? "selected" : ""}>红利税</option></select></td>
        <td><input type="number" min="0.0001" step="0.0001" data-field="price" value="${row.price ?? ""}" ${cash ? "disabled" : ""} /></td>
        <td><input type="number" min="100" step="100" data-field="quantity" value="${row.quantity ?? ""}" ${cash ? "disabled" : ""} /></td>
        <td><input type="number" min="0" step="0.01" data-field="amount" value="${row.amount ?? ""}" /></td>
        <td class="ocr-row-status ${statusClass}">${escapeHtml(status)}<span class="ocr-confidence">${confidence}</span></td>
      </tr>`;
    }).join("");
    const selected = ocrRows.filter((row) => row.selected);
    const validSelected = selected.filter((row) => !row.errors.length);
    el.ocrConfirmButton.disabled = ocrBusy || !selected.length || validSelected.length !== selected.length;
    el.ocrConfirmHint.textContent = selected.length ? `已选择 ${selected.length} 笔，其中 ${validSelected.length} 笔可导入` : "请至少选择一条记录";
    el.ocrResultHeading.hidden = !ocrRows.length;
    el.ocrReviewWrap.hidden = !ocrRows.length;
    const tradeCount = ocrRows.filter((row) => !isCashEntry(row.entryType)).length;
    const cashCount = ocrRows.length - tradeCount;
    el.ocrResultSummary.textContent = `识别 ${ocrRows.length} 条记录（买卖 ${tradeCount}，股息相关 ${cashCount}）${ocrSkippedCount ? `，跳过 ${ocrSkippedCount} 条无法确认的记录` : ""}`;
  }

  function syncOcrRowsFromDom() {
    [...el.ocrReviewBody.querySelectorAll("tr[data-index]")].forEach((tr) => {
      const row = ocrRows[Number(tr.dataset.index)];
      if (!row) return;
      tr.querySelectorAll("[data-field]").forEach((input) => {
        const field = input.dataset.field;
        row[field] = field === "selected" ? input.checked : ["price", "quantity", "amount"].includes(field) ? (input.value === "" ? undefined : Number(input.value)) : input.value;
      });
    });
  }

  async function processOcrFiles(fileList) {
    if (ocrBusy) return;
    const files = [...fileList].filter((file) => file.type.startsWith("image/"));
    if (!files.length) { el.ocrError.textContent = "请选择 PNG、JPG、WebP 或 BMP 图片"; return; }
    if (!await checkOcrConnection()) return;
    ocrBusy = true;
    el.ocrDropZone.disabled = true;
    el.ocrConfirmButton.disabled = true;
    el.ocrError.textContent = "";
    releaseOcrPreview();
    ocrPreviewUrl = URL.createObjectURL(files[0]);
    el.ocrPreviewImage.src = ocrPreviewUrl;
    el.ocrPreviewImage.hidden = false;
    el.ocrPreview.querySelector("span").hidden = true;
    ocrRows = [];
    ocrSkippedCount = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        el.ocrProgress.textContent = `正在识别第 ${index + 1} / ${files.length} 张：${file.name}`;
        const result = await UmiOcr.recognizeImage(file);
        const parsed = TradeScreenshotParser.parseOcrBlocks(result.blocks, { sourceImageId: `image_${index + 1}` });
        ocrSkippedCount += parsed.skippedRows.length;
        parsed.records.forEach((record) => {
          const securityId = findSecurityForOcr(record);
          const candidate = { ...record, securityId };
          const duplicate = securityId && state.transactions.some((item) => TradeScreenshotParser.fingerprint(item) === TradeScreenshotParser.fingerprint(candidate));
          ocrRows.push({ id: uid("ocr"), ...record, securityId, selected: !duplicate, parserWarnings: record.warnings || [] });
        });
      }
      el.ocrProgress.textContent = ocrRows.length ? "识别完成。请核对每个字段，确认后再导入。" : "未识别到可导入记录。";
      if (!ocrRows.length) el.ocrError.textContent = "截图中没有解析出完整交易或股息记录；请确认截图包含日期、类型和金额等字段。";
      renderOcrRows();
    } catch (error) {
      el.ocrError.textContent = error.message || "OCR 识别失败";
      el.ocrProgress.textContent = "识别未完成，没有写入任何交易数据。";
    } finally {
      ocrBusy = false;
      el.ocrDropZone.disabled = !ocrConnected;
      if (ocrRows.length) renderOcrRows();
    }
  }

  function confirmOcrImport() {
    syncOcrRowsFromDom();
    validateOcrRows();
    const selected = ocrRows.filter((row) => row.selected);
    if (!selected.length) { el.ocrError.textContent = "请至少选择一条记录"; return; }
    if (selected.some((row) => row.errors.length)) { el.ocrError.textContent = "仍有未通过校验的记录，请修正后再导入"; renderOcrRows(); return; }
    const imported = selected.map(candidateFromOcr);
    state.transactions.push(...imported);
    saveState(`已从截图导入 ${imported.length} 条记录并重新计算`);
    clearOcrReview();
    el.ocrDialog.close();
    render();
  }

  async function openOcrDialog() {
    el.ocrDialog.showModal();
    await checkOcrConnection();
  }

  $("#addSecurityButton").addEventListener("click", () => openSecurityDialog());
  $("#emptyAddButton").addEventListener("click", () => openSecurityDialog());
  $("#editSecurityButton").addEventListener("click", () => openSecurityDialog(currentSecurity()));
  el.securityForm.addEventListener("submit", saveSecurity); el.deleteSecurityButton.addEventListener("click", deleteSecurity);
  el.securitySelect.addEventListener("change", () => { state.selectedSecurityId = el.securitySelect.value; saveState(); resetTradeForm(); render(); });
  el.tradeForm.addEventListener("submit", saveTrade); el.cancelEditButton.addEventListener("click", resetTradeForm);
  [el.tradeQuantity, el.tradePrice, el.cashAmount].forEach((input) => input.addEventListener("input", updateTradePreview));
  $$("input[name='entryType']").forEach((input) => input.addEventListener("input", updateEntryFormMode));
  el.transactionsBody.addEventListener("click", (event) => { const baselineId = event.target.dataset.baseline, editId = event.target.dataset.edit, deleteId = event.target.dataset.delete; if (baselineId) setBaseline(baselineId); if (editId) editTrade(editId); if (deleteId) deleteTrade(deleteId); });
  el.restoreBaselineButton.addEventListener("click", restoreOriginalBaseline);
  el.sideFilter.addEventListener("change", render);
  el.dividendModeButton.addEventListener("click", toggleDividendMode);
  $("#feeButton").addEventListener("click", openFeeDialog); el.feeForm.addEventListener("submit", saveFees);
  $("#backupButton").addEventListener("click", () => el.backupDialog.showModal()); $("#closeBackupButton").addEventListener("click", () => el.backupDialog.close());
  $("#exportJsonButton").addEventListener("click", exportBackup); $("#importJsonButton").addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", () => importBackup(el.importFile.files[0])); $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#ocrImportButton").addEventListener("click", openOcrDialog);
  el.ocrRetryButton.addEventListener("click", checkOcrConnection);
  el.ocrDropZone.addEventListener("click", () => el.ocrFileInput.click());
  el.ocrFileInput.addEventListener("change", () => processOcrFiles(el.ocrFileInput.files));
  el.ocrClearButton.addEventListener("click", clearOcrReview);
  el.ocrConfirmButton.addEventListener("click", confirmOcrImport);
  el.ocrReviewBody.addEventListener("change", () => { syncOcrRowsFromDom(); renderOcrRows(); });
  ["dragenter", "dragover"].forEach((name) => el.ocrDropZone.addEventListener(name, (event) => { event.preventDefault(); el.ocrDropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => el.ocrDropZone.addEventListener(name, (event) => { event.preventDefault(); el.ocrDropZone.classList.remove("dragging"); }));
  el.ocrDropZone.addEventListener("drop", (event) => processOcrFiles(event.dataTransfer.files));
  el.ocrDialog.addEventListener("close", () => { if (!ocrBusy) clearOcrReview(); });
  $$('[data-close]').forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  window.addEventListener("resize", () => { if (currentSecurity()) renderCharts(currentSecurity(), TradeEngine.analyzeSecurity(currentSecurity(), state.transactions, state.fees, analysisOptions())); });

  el.tradeDatetime.value = nowForInput();
  updateEntryFormMode();
  render();
  if (repairedOnLoad) saveState("无效基准已恢复为原始初始状态");
})();
