(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.UmiOcr = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_BASE_URL = "http://127.0.0.1:1224";

  function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
    let url;
    try {
      url = new URL(String(value || DEFAULT_BASE_URL));
    } catch (_) {
      throw new Error("Umi-OCR 服务地址格式不正确");
    }
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw new Error("为保护交易隐私，OCR 服务只允许使用 127.0.0.1 或 localhost");
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }

  function configuredBaseUrl() {
    if (typeof window === "undefined") return DEFAULT_BASE_URL;
    const queryValue = new URLSearchParams(window.location.search).get("umiOcrBaseUrl");
    const configured = queryValue || window.APP_CONFIG?.UMI_OCR_BASE_URL || DEFAULT_BASE_URL;
    return normalizeBaseUrl(configured);
  }

  function withTimeout(timeoutMs, task) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return Promise.resolve(task(controller.signal)).finally(() => clearTimeout(timer));
  }

  async function requestJson(path, init = {}, baseUrl = configuredBaseUrl(), timeoutMs = 5000) {
    const safeBaseUrl = normalizeBaseUrl(baseUrl);
    try {
      return await withTimeout(timeoutMs, async (signal) => {
        const response = await fetch(`${safeBaseUrl}${path}`, { ...init, signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("连接 Umi-OCR 超时");
      throw new Error(`无法连接本机 Umi-OCR：${error?.message || "未知错误"}`);
    }
  }

  async function getOptions(baseUrl) {
    return requestJson("/api/ocr/get_options", { method: "GET" }, baseUrl);
  }

  async function checkConnection(baseUrl) {
    try {
      const options = await getOptions(baseUrl);
      return { connected: Boolean(options && options["data.format"]), options };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }

  function fileToBase64(file) {
    if (typeof file === "string") return Promise.resolve(file.replace(/^data:[^,]+,/, ""));
    if (!(file instanceof Blob)) return Promise.reject(new Error("请选择有效的图片文件"));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ""));
      reader.onerror = () => reject(new Error("无法读取图片"));
      reader.readAsDataURL(file);
    });
  }

  function centerOfBox(box) {
    const points = Array.isArray(box) ? box.filter((point) => Array.isArray(point) && point.length >= 2) : [];
    if (!points.length) return { x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0 };
    const xs = points.map((point) => Number(point[0]));
    const ys = points.map((point) => Number(point[1]));
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    return { x: (left + right) / 2, y: (top + bottom) / 2, left, right, top, bottom };
  }

  function normalizeResult(result) {
    if (!result || result.code !== 100 || !Array.isArray(result.data)) {
      const detail = result?.code === 101 ? "图片中没有检测到文字" : (result?.data || "OCR 识别失败");
      throw new Error(String(detail));
    }
    return result.data.map((block, index) => ({
      id: `ocr_${index}`,
      text: String(block.text || "").trim(),
      score: Number.isFinite(Number(block.score)) ? Number(block.score) : 0,
      box: block.box,
      ...centerOfBox(block.box),
    })).filter((block) => block.text);
  }

  async function recognizeImage(file, options = {}) {
    const base64 = await fileToBase64(file);
    const result = await requestJson("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base64,
        options: { "data.format": "dict", "tbpu.parser": "none", ...(options.ocr || {}) },
      }),
    }, options.baseUrl, options.timeoutMs || 120000);
    return { code: result.code, blocks: normalizeResult(result) };
  }

  return { DEFAULT_BASE_URL, checkConnection, configuredBaseUrl, getOptions, normalizeBaseUrl, normalizeResult, recognizeImage };
});
