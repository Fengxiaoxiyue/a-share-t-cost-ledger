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
    dividendModeButton: $("#dividendModeButton"), tradeForm: $("#tradeForm"), tradeDatetime: $("#tradeDatetime"), tradeQuantity: $("#tradeQuantity"), tradePrice: $("#tradePrice"), cashAmount: $("#cashAmount"), cashAmountLabel: $("#cashAmountLabel"), tradeNote: $("#tradeNote"),
    editingTradeId: $("#editingTradeId"), tradeFormTitle: $("#tradeFormTitle"), cancelEditButton: $("#cancelEditButton"), tradePreview: $("#tradePreview"), tradeError: $("#tradeError"),
    transactionsBody: $("#transactionsBody"), transactionsEmpty: $("#transactionsEmpty"), loopsBody: $("#loopsBody"), loopsEmpty: $("#loopsEmpty"), sideFilter: $("#sideFilter"),
    securityDialog: $("#securityDialog"), securityForm: $("#securityForm"), securityId: $("#securityId"), securityDialogTitle: $("#securityDialogTitle"),
    securityCode: $("#securityCode"), securityName: $("#securityName"), initialQuantity: $("#initialQuantity"), initialCost: $("#initialCost"), securityError: $("#securityError"), deleteSecurityButton: $("#deleteSecurityButton"),
    feeDialog: $("#feeDialog"), feeForm: $("#feeForm"), backupDialog: $("#backupDialog"), importFile: $("#importFile"), toast: $("#toast"),
  };
  let state = loadState();
  let toastTimer;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.securities) || !Array.isArray(parsed.transactions)) return structuredClone(EMPTY_STATE);
      return { ...structuredClone(EMPTY_STATE), ...parsed, fees: { ...DEFAULT_FEES, ...(parsed.fees || {}) } };
    } catch (_) {
      return structuredClone(EMPTY_STATE);
    }
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
    renderSummary(security, analysis);
    renderLoops(security, analysis);
    renderTransactions(analysis);
    renderCharts(security, analysis);
    updateTradePreview();
  }

  function renderSummary(security, analysis) {
    el.dilutedCost.textContent = analysis.dilutedCost === null ? "已清仓" : `¥ ${money(analysis.dilutedCost, 4)}`;
    const reduction = analysis.costReduction;
    el.costChange.textContent = reduction === null ? "当前无持仓，暂不计算单位成本" : `${reduction >= 0 ? "较初始降低" : "较初始升高"} ¥ ${money(Math.abs(reduction), 4)} / 股`;
    setValueClass(el.costChange, reduction, true);
    el.dividendModeButton.textContent = state.includeDividendsInCost ? "股息模式：计入成本" : "股息模式：不计入成本";
    el.dividendModeButton.classList.toggle("active", state.includeDividendsInCost);
    el.dividendModeButton.setAttribute("aria-pressed", String(Boolean(state.includeDividendsInCost)));
    el.dilutedCostHelp.title = state.includeDividendsInCost
      ? "初始持仓总成本 + 累计买入支出 − 累计卖出净收入 − 分红入账 + 红利税，再除以当前持仓。"
      : "初始持仓总成本 + 累计买入支出 − 累计卖出净收入，再除以当前持仓；已记录股息不参与成本。";
    el.currentHolding.textContent = `${number(analysis.currentHolding)} 股`;
    el.holdingDifference.textContent = `初始 ${number(security.initialQuantity)} 股 · 当前偏差 ${signNumber(analysis.holdingDifference, " 股")}`;
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
        <td class="number ${loop.costReductionPerInitialShare >= 0 ? "positive" : "negative"}">${loop.costReductionPerInitialShare >= 0 ? "−" : "+"}¥ ${money(Math.abs(loop.costReductionPerInitialShare), 4)}/股</td>
      </tr>`).join("");
  }

  function renderTransactions(analysis) {
    const filter = el.sideFilter.value;
    const rows = [...analysis.rows].reverse().filter((row) => filter === "all" || (row.entryType === "trade" ? row.side : row.entryType) === filter);
    el.transactionsEmpty.hidden = rows.length > 0;
    el.transactionsBody.innerHTML = rows.map((row) => {
      const type = row.entryType === "trade" ? row.side : row.entryType;
      const typeLabel = { buy: "买入", sell: "卖出", dividend: "分红入账", dividend_tax: "红利税" }[type];
      const amountText = row.entryType === "trade" ? money(row.fees.gross) : `${type === "dividend" ? "+" : "−"}${money(row.amount)}`;
      return `
      <tr>
        <td>${formatDate(row.datetime)}</td><td><span class="side-tag ${type}">${typeLabel}</span></td>
        <td class="number">${row.entryType === "trade" ? number(row.quantity) : "—"}</td><td class="number">${row.entryType === "trade" ? `¥ ${money(row.price, 4)}` : "—"}</td><td class="number ${type === "dividend" ? "positive" : type === "dividend_tax" ? "negative" : ""}">¥ ${amountText}</td>
        <td class="number" ${row.entryType === "trade" ? `title="佣金 ${money(row.fees.commission)}；过户费 ${money(row.fees.transferFee)}；印花税 ${money(row.fees.stampDuty)}"` : ""}>${row.entryType === "trade" ? `¥ ${money(row.fees.total)}` : "—"}</td>
        <td class="number">${number(row.holdingAfter)}</td><td class="number ${row.holdingDifference > 0 ? "negative" : row.holdingDifference < 0 ? "positive" : ""}">${signNumber(row.holdingDifference)}</td>
        <td class="number">${row.dilutedCostAfter === null ? "—" : `¥ ${money(row.dilutedCostAfter, 4)}`}</td><td>${escapeHtml(row.note || "—")}</td>
        <td><button class="table-action" data-edit="${row.id}">编辑</button><button class="table-action delete" data-delete="${row.id}">删除</button></td>
      </tr>`;
    }).join("");
  }

  function renderCharts(security, analysis) {
    const costData = [{ label: "初始", cost: Number(security.initialCost), price: null }].concat(
      analysis.rows.map((row) => ({ label: formatDate(row.datetime), cost: row.dilutedCostAfter, price: row.entryType === "trade" ? Number(row.price) : null }))
    );
    drawLineChart($("#costChart"), costData, [
      { key: "cost", label: "摊薄成本", color: "#1671c9", format: (v) => `¥${money(v, 4)}` },
      { key: "price", label: "成交价", color: "#c67b12", format: (v) => `¥${money(v, 4)}` },
    ]);
    const positionData = [{ label: "初始", position: 0, profit: 0 }].concat(
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
      let path = "", drawing = false;
      data.forEach((item, index) => {
        const value = item[entry.key];
        if (value === null || !Number.isFinite(Number(value))) { drawing = false; return; }
        path += `${drawing ? "L" : "M"}${frame.x(index, data.length)},${frame.y(Number(value))} `; drawing = true;
      });
      frame.svg.appendChild(svgElement("path", { d: path, fill: "none", stroke: entry.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      data.forEach((item, index) => {
        if (item[entry.key] === null) return;
        frame.svg.appendChild(svgElement("circle", { cx: frame.x(index, data.length), cy: frame.y(Number(item[entry.key])), r: 3, fill: "white", stroke: entry.color, "stroke-width": 2 }));
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
    addTooltip(container, frame, data, (index) => `<strong>${data[index].label}</strong><br>较初始仓位：${signNumber(data[index].position, " 股")}<br>累计闭环收益：¥${money(data[index].profit)}`);
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
    const security = { id: id || uid("sec"), code, name, initialQuantity, initialCost };
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

  function editTrade(id) {
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
    const trade = state.transactions.find((item) => item.id === id); if (!trade) return;
    const entryType = TradeEngine.transactionType(trade) === "trade" ? trade.side : trade.type;
    const label = { buy: "买入", sell: "卖出", dividend: "分红入账", dividend_tax: "红利税" }[entryType];
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
        saveState("备份已恢复"); el.backupDialog.close(); resetTradeForm(); render();
      } catch (_) { showToast("无法识别该备份文件"); }
    };
    reader.readAsText(file, "utf-8"); el.importFile.value = "";
  }

  function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
  function exportCsv() {
    const security = currentSecurity(); if (!security) return;
    const analysis = TradeEngine.analyzeSecurity(security, state.transactions, state.fees, analysisOptions());
    const header = ["记录时间","类型","数量(股)","成交价格","发生金额","佣金","过户费","印花税","总费用","记录后持仓","较初始仓位","摊薄成本","备注"];
    const lines = [header, ...analysis.rows.map((row) => {
      const type = row.entryType === "trade" ? row.side : row.entryType;
      const label = { buy: "买入", sell: "卖出", dividend: "分红入账", dividend_tax: "股息红利税" }[type];
      const amount = row.entryType === "trade" ? row.fees.gross : (type === "dividend" ? row.amount : -row.amount);
      return [row.datetime,label,row.entryType === "trade" ? row.quantity : "",row.entryType === "trade" ? Number(row.price).toFixed(4) : "",amount,row.fees.commission,row.fees.transferFee,row.fees.stampDuty,row.fees.total,row.holdingAfter,row.holdingDifference,row.dilutedCostAfter === null ? "" : Number(row.dilutedCostAfter).toFixed(4),row.note || ""];
    })];
    download(`${security.code}_${security.name}_交易流水.csv`, "\ufeff" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
    showToast("当前股票流水已导出");
  }

  $("#addSecurityButton").addEventListener("click", () => openSecurityDialog());
  $("#emptyAddButton").addEventListener("click", () => openSecurityDialog());
  $("#editSecurityButton").addEventListener("click", () => openSecurityDialog(currentSecurity()));
  el.securityForm.addEventListener("submit", saveSecurity); el.deleteSecurityButton.addEventListener("click", deleteSecurity);
  el.securitySelect.addEventListener("change", () => { state.selectedSecurityId = el.securitySelect.value; saveState(); resetTradeForm(); render(); });
  el.tradeForm.addEventListener("submit", saveTrade); el.cancelEditButton.addEventListener("click", resetTradeForm);
  [el.tradeQuantity, el.tradePrice, el.cashAmount].forEach((input) => input.addEventListener("input", updateTradePreview));
  $$("input[name='entryType']").forEach((input) => input.addEventListener("input", updateEntryFormMode));
  el.transactionsBody.addEventListener("click", (event) => { const editId = event.target.dataset.edit, deleteId = event.target.dataset.delete; if (editId) editTrade(editId); if (deleteId) deleteTrade(deleteId); });
  el.sideFilter.addEventListener("change", render);
  el.dividendModeButton.addEventListener("click", toggleDividendMode);
  $("#feeButton").addEventListener("click", openFeeDialog); el.feeForm.addEventListener("submit", saveFees);
  $("#backupButton").addEventListener("click", () => el.backupDialog.showModal()); $("#closeBackupButton").addEventListener("click", () => el.backupDialog.close());
  $("#exportJsonButton").addEventListener("click", exportBackup); $("#importJsonButton").addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", () => importBackup(el.importFile.files[0])); $("#exportCsvButton").addEventListener("click", exportCsv);
  $$('[data-close]').forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  window.addEventListener("resize", () => { if (currentSecurity()) renderCharts(currentSecurity(), TradeEngine.analyzeSecurity(currentSecurity(), state.transactions, state.fees, analysisOptions())); });

  el.tradeDatetime.value = nowForInput();
  updateEntryFormMode();
  render();
})();
