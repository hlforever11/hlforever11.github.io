(() => {
  "use strict";

  const BACKEND_API_URL = "https://hlforever11-youtube-downloader-api.onrender.com";
  const RESOLVE_TIMEOUT = 150_000;
  const COUNTER_RESET_OFFSET = 1;

  const elements = {
    form: document.querySelector("#download-form"),
    input: document.querySelector("#video-url"),
    urlField: document.querySelector("#url-field"),
    rights: document.querySelector("#rights-confirm"),
    parseButton: document.querySelector("#parse-button"),
    buttonLabel: document.querySelector(".button-label"),
    clearButton: document.querySelector("#clear-button"),
    pasteButton: document.querySelector("#paste-button"),
    message: document.querySelector("#message"),
    resultCard: document.querySelector("#result-card"),
    newLinkButton: document.querySelector("#new-link-button"),
    thumbnail: document.querySelector("#video-thumbnail"),
    duration: document.querySelector("#video-duration"),
    title: document.querySelector("#video-title"),
    uploader: document.querySelector("#video-uploader"),
    tabs: [...document.querySelectorAll(".format-tab")],
    formatList: document.querySelector("#format-list"),
    formatNotice: document.querySelector("#format-notice"),
    toast: document.querySelector("#toast"),
    visitCounter: document.querySelector("#site-counter"),
    visitFrame: document.querySelector("#visit-counter-frame"),
    visitValue: document.querySelector("#page-visit-count"),
  };

  const state = {
    data: null,
    kind: "video",
    toastTimer: null,
  };

  function setupVisitCounter() {
    if (!elements.visitCounter || !elements.visitFrame || !elements.visitValue) return;

    const reveal = (raw) => {
      if (!Number.isInteger(raw) || raw < 0) return false;
      const count = Math.max(0, raw - COUNTER_RESET_OFFSET);
      elements.visitValue.textContent = count.toLocaleString("zh-CN");
      elements.visitCounter.classList.add("is-ready");
      elements.visitCounter.setAttribute("aria-label", `本页面累计访问 ${count} 次`);
      return true;
    };

    const receiveCount = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== elements.visitFrame.contentWindow) return;
      if (event.data?.type !== "youtube-downloader-page-count") return;
      if (!reveal(Number(event.data.raw))) return;
      window.removeEventListener("message", receiveCount);
    };

    window.addEventListener("message", receiveCount);
    const requestCount = () => {
      elements.visitFrame.contentWindow?.postMessage(
        { type: "youtube-downloader-count-request" },
        window.location.origin,
      );
    };
    elements.visitFrame.addEventListener("load", requestCount, { once: true });
    requestCount();
    window.setTimeout(() => window.removeEventListener("message", receiveCount), 15_000);
  }

  function extractVideoId(value) {
    const input = value.trim();
    if (/^[\w-]{11}$/.test(input)) return input;

    try {
      const url = new URL(input);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtu.be") {
        const id = url.pathname.split("/")[1] || "";
        return /^[\w-]{11}$/.test(id) ? id : null;
      }
      if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const id =
        url.searchParams.get("v") ||
        (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "");
      return /^[\w-]{11}$/.test(id || "") ? id : null;
    } catch {
      return null;
    }
  }

  async function responseError(response) {
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") return body.detail;
    } catch {
      // Use a status-based message when the server did not return JSON.
    }
    if (response.status === 429) return "服务器正在处理其他文件或请求过于频繁，请稍后重试。";
    if (response.status === 502 || response.status === 503) {
      return "下载服务器暂时无法连接 YouTube，请稍后重试。";
    }
    return `服务器返回错误（HTTP ${response.status}）。`;
  }

  function makeDownloadUrl(videoId, preset) {
    const url = new URL(`${BACKEND_API_URL}/api/download`);
    url.searchParams.set("video_id", videoId);
    url.searchParams.set("preset", preset);
    return url.toString();
  }

  function normalizeFormats(payload) {
    const formats = Array.isArray(payload.formats) ? payload.formats : [];
    const mapFormat = (format) => ({
      detail: String(format.detail || ""),
      extension: String(format.extension || (format.kind === "audio" ? "mp3" : "mp4")),
      height: Number(format.height || 0),
      kind: format.kind === "audio" ? "audio" : "video",
      preset: String(format.preset || ""),
      quality: String(format.label || (format.kind === "audio" ? "MP3" : "视频")),
      url: makeDownloadUrl(payload.videoId, format.preset),
      videoOnly: false,
    });

    return {
      audioStreams: formats.filter((format) => format.kind === "audio").map(mapFormat),
      duration: Number(payload.duration || 0),
      thumbnailUrl: String(payload.thumbnailUrl || ""),
      title: String(payload.title || "未命名视频"),
      uploader: String(payload.uploader || "频道信息未知"),
      videoId: String(payload.videoId || ""),
      videoStreams: formats
        .filter((format) => format.kind === "video")
        .map(mapFormat)
        .sort((a, b) => b.height - a.height),
    };
  }

  async function resolveVideo(videoId) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), RESOLVE_TIMEOUT);

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/resolve`, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));

      const payload = await response.json();
      if (!payload?.videoId || !payload?.title || !Array.isArray(payload.formats)) {
        throw new Error("下载服务器返回的数据不完整，请稍后重试。");
      }
      const normalized = normalizeFormats(payload);
      if (!normalized.videoStreams.length && !normalized.audioStreams.length) {
        throw new Error("该视频没有可用的下载格式。");
      }
      return normalized;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("下载服务器唤醒或解析超时，请稍后重试。");
      }
      if (error instanceof TypeError) {
        throw new Error("无法连接下载服务器。若服务刚部署，请等待约一分钟后重试。");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function setLoading(loading) {
    elements.parseButton.disabled = loading;
    elements.parseButton.classList.toggle("is-loading", loading);
    elements.buttonLabel.textContent = loading ? "正在解析，请稍候…" : "解析视频";
  }

  function showMessage(text, kind = "error") {
    elements.message.textContent = text;
    elements.message.classList.toggle("is-info", kind === "info");
    elements.message.hidden = false;
  }

  function hideMessage() {
    elements.message.hidden = true;
    elements.message.textContent = "";
  }

  function syncClearButton() {
    elements.clearButton.hidden = !elements.input.value;
  }

  function showToast(text) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = text;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 6500);
  }

  function markInvalid() {
    elements.urlField.classList.remove("is-invalid");
    void elements.urlField.offsetWidth;
    elements.urlField.classList.add("is-invalid");
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = Math.floor(seconds % 60);
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function createFormatRow(stream) {
    const row = document.createElement("article");
    row.className = "format-row";

    const quality = document.createElement("div");
    quality.className = "format-quality";
    quality.textContent = stream.quality;

    const detail = document.createElement("div");
    detail.className = "format-detail";
    detail.textContent = stream.detail || stream.extension.toUpperCase();

    const button = document.createElement("button");
    button.className = "download-button";
    button.type = "button";
    button.textContent = "下载";
    button.addEventListener("click", () => downloadStream(stream));

    row.append(quality, detail, button);
    return row;
  }

  function renderFormats() {
    elements.formatList.replaceChildren();
    elements.formatNotice.hidden = true;

    const streams =
      state.kind === "audio"
        ? state.data?.audioStreams || []
        : state.data?.videoStreams || [];

    if (!streams.length) {
      const empty = document.createElement("p");
      empty.className = "empty-formats";
      empty.textContent = `该视频没有可用的${state.kind === "audio" ? "音频" : "视频"}格式。`;
      elements.formatList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    streams.forEach((stream) => fragment.append(createFormatRow(stream)));
    elements.formatList.append(fragment);
  }

  function renderResult(data) {
    state.data = data;
    state.kind = "video";
    elements.thumbnail.src =
      data.thumbnailUrl || `https://i.ytimg.com/vi/${data.videoId}/hqdefault.jpg`;
    elements.thumbnail.alt = `${data.title} 的视频封面`;
    elements.title.textContent = data.title;
    elements.uploader.textContent = data.uploader;
    elements.duration.textContent = formatDuration(data.duration);
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.kind === "video";
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderFormats();
    elements.resultCard.hidden = false;
    window.setTimeout(() => {
      elements.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function downloadStream(stream) {
    const pending = window.open("about:blank", "_blank");
    if (pending) {
      try {
        pending.opener = null;
        pending.document.title = "正在生成下载文件";
        pending.document.body.style.cssText =
          "margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f4ef;color:#161513;font:15px system-ui,sans-serif";
        pending.document.body.textContent = "服务器正在生成文件，请保持此页面打开。完成后浏览器会自动开始下载。";
        pending.location.replace(stream.url);
      } catch {
        pending.location.href = stream.url;
      }
    } else {
      window.location.href = stream.url;
    }
    showToast("服务器正在生成文件。视频越长，等待时间越久；请勿重复点击。");
  }

  async function parseVideo() {
    const value = elements.input.value.trim();
    const videoId = extractVideoId(value);
    hideMessage();
    elements.urlField.classList.remove("is-invalid");

    if (!videoId) {
      markInvalid();
      showMessage("链接格式不正确。请粘贴完整的 YouTube 视频、Shorts 或 youtu.be 链接。");
      elements.input.focus();
      return;
    }

    if (!elements.rights.checked) {
      showMessage("请先确认你拥有该内容的下载与使用权限。");
      elements.rights.focus();
      return;
    }

    setLoading(true);
    elements.resultCard.hidden = true;
    showMessage("正在连接下载服务器；免费服务首次唤醒可能需要 30–60 秒。", "info");

    try {
      const data = await resolveVideo(videoId);
      hideMessage();
      renderResult(data);
    } catch (error) {
      showMessage(error.message || "解析失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    parseVideo();
  });

  elements.input.addEventListener("input", () => {
    elements.urlField.classList.remove("is-invalid");
    syncClearButton();
    if (!elements.message.classList.contains("is-info")) hideMessage();
  });

  elements.clearButton.addEventListener("click", () => {
    elements.input.value = "";
    elements.resultCard.hidden = true;
    state.data = null;
    hideMessage();
    syncClearButton();
    elements.input.focus();
  });

  elements.pasteButton.addEventListener("click", async () => {
    try {
      elements.input.value = await navigator.clipboard.readText();
      syncClearButton();
      elements.input.focus();
      hideMessage();
    } catch {
      elements.input.focus();
      showToast("浏览器没有授予剪贴板权限，请手动粘贴链接。");
    }
  });

  elements.newLinkButton.addEventListener("click", () => {
    elements.resultCard.hidden = true;
    elements.input.select();
    elements.input.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.kind = tab.dataset.kind;
      elements.tabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-selected", String(active));
      });
      renderFormats();
    });
  });

  syncClearButton();
  setupVisitCounter();
  fetch(`${BACKEND_API_URL}/health`, { mode: "cors", cache: "no-store" }).catch(() => {});
})();
