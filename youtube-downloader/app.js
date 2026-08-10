(() => {
  "use strict";

  const MAX_MEMORY_DOWNLOAD = 250 * 1024 * 1024;
  const INSTANCE_BATCH_SIZE = 5;
  const INSTANCE_LIST_TIMEOUT = 3500;
  const INSTANCE_REQUEST_TIMEOUT = 6500;
  // This page's independent counter was reset after the initial verification visits.
  const VISIT_COUNTER_BASELINE = 5;
  const LAST_WORKING_INSTANCE_KEY = "yt-helper-working-piped-instance";
  const PIPED_INSTANCE_LIST_URL =
    "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md";
  const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.leptons.xyz",
    "https://pipedapi.nosebs.ru",
    "https://pipedapi-libre.kavin.rocks",
    "https://piped-api.privacy.com.de",
    "https://pipedapi.adminforge.de",
    "https://api.piped.yt",
    "https://pipedapi.drgns.space",
    "https://pipedapi.owo.si",
    "https://pipedapi.ducks.party",
    "https://piped-api.codespace.cz",
    "https://pipedapi.reallyaweso.me",
    "https://api.piped.private.coffee",
    "https://pipedapi.darkness.services",
    "https://pipedapi.orangenet.cc",
  ];

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
    visitRaw: document.querySelector("#busuanzi_page_pv"),
    visitValue: document.querySelector("#page-visit-count"),
  };

  const state = {
    data: null,
    kind: "video",
    toastTimer: null,
  };

  function setupVisitCounter() {
    if (!elements.visitCounter || !elements.visitRaw || !elements.visitValue) return;

    const reveal = () => {
      const raw = String(elements.visitRaw.textContent || "").replace(/[,，\s]/g, "");
      if (!/^\d+$/.test(raw)) return false;
      const count = Math.max(0, Number(raw) - VISIT_COUNTER_BASELINE);
      elements.visitValue.textContent = count.toLocaleString("zh-CN");
      elements.visitCounter.classList.add("is-ready");
      elements.visitCounter.setAttribute("aria-label", `本页面累计访问 ${count} 次`);
      return true;
    };

    if (reveal()) return;
    const observer = new MutationObserver(() => {
      if (reveal()) observer.disconnect();
    });
    observer.observe(elements.visitRaw, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.setTimeout(() => observer.disconnect(), 10_000);
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
      const id = url.searchParams.get("v") || (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "");
      return /^[\w-]{11}$/.test(id || "") ? id : null;
    } catch {
      return null;
    }
  }

  async function queryInstance(instance, videoId) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), INSTANCE_REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data?.title || !Array.isArray(data.videoStreams)) {
        throw new Error("响应数据不完整");
      }
      return { ...data, _instance: instance };
    } catch (error) {
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function normalizeStream(stream) {
    return {
      bitrate: Number(stream.bitrate || 0),
      codec: stream.codec || "",
      format: stream.format || "",
      fps: Number(stream.fps || 0),
      height: Number(stream.height || 0),
      mimeType: stream.mimeType || "application/octet-stream",
      quality: stream.quality || "未知",
      url: stream.url || "",
      videoOnly: Boolean(stream.videoOnly),
      width: Number(stream.width || 0),
    };
  }

  function uniqueStreams(streams) {
    const seen = new Set();
    return streams
      .filter((stream) => stream?.url)
      .filter(
        (stream) =>
          !/\bHLS\b/i.test(String(stream.quality || "")) &&
          !/\.m3u8(?:$|\?)/i.test(String(stream.url || "")),
      )
      .filter((stream) => {
        const key = [stream.mimeType, stream.quality, stream.height, stream.fps, stream.videoOnly].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(normalizeStream);
  }

  function sourceScore(data) {
    const videos = Array.isArray(data.videoStreams) ? data.videoStreams : [];
    const audios = Array.isArray(data.audioStreams) ? data.audioStreams : [];
    const maxHeight = videos.reduce((max, stream) => Math.max(max, Number(stream.height || 0)), 0);
    const combined = videos.filter((stream) => !stream.videoOnly).length;
    const standard = videos.filter((stream) => !String(stream.quality || "").toUpperCase().includes("LBRY")).length;
    return maxHeight * 10 + audios.length * 900 + combined * 180 + standard * 60;
  }

  function uniqueInstances(instances) {
    const seen = new Set();
    return instances.filter((instance) => {
      try {
        const url = new URL(instance);
        if (url.protocol !== "https:") return false;
        const normalized = url.origin;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      } catch {
        return false;
      }
    }).map((instance) => new URL(instance).origin);
  }

  async function currentPipedInstances() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), INSTANCE_LIST_TIMEOUT);
    let discovered = [];

    try {
      const response = await fetch(PIPED_INSTANCE_LIST_URL, {
        headers: { Accept: "text/plain" },
        signal: controller.signal,
      });
      if (response.ok) {
        const markdown = await response.text();
        discovered = [...markdown.matchAll(/\|\s*(https:\/\/[^\s|]+)\s*\|/g)].map(
          (match) => match[1],
        );
      }
    } catch {
      // The bundled official list remains available when GitHub Raw is blocked.
    } finally {
      window.clearTimeout(timer);
    }

    const instances = uniqueInstances([...discovered, ...PIPED_INSTANCES]);
    let lastWorking = "";
    try {
      lastWorking = window.sessionStorage.getItem(LAST_WORKING_INSTANCE_KEY) || "";
    } catch {
      // Storage may be unavailable in strict privacy modes.
    }
    if (!lastWorking || !instances.includes(lastWorking)) return instances;
    return [lastWorking, ...instances.filter((instance) => instance !== lastWorking)];
  }

  async function resolveVideo(videoId) {
    const instances = await currentPipedInstances();
    let bestData = null;
    let attempted = 0;

    for (let index = 0; index < instances.length; index += INSTANCE_BATCH_SIZE) {
      const batch = instances.slice(index, index + INSTANCE_BATCH_SIZE);
      attempted += batch.length;
      const settled = await Promise.allSettled(
        batch.map((instance) => queryInstance(instance, videoId)),
      );
      const candidates = settled
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      for (const candidate of candidates) {
        if (candidate.livestream) {
          throw new Error("暂不支持正在直播的视频，请在直播结束后再试。");
        }
        if (!bestData || sourceScore(candidate) > sourceScore(bestData)) bestData = candidate;
      }

      const bestVideos = bestData?.videoStreams || [];
      const bestAudios = bestData?.audioStreams || [];
      const bestHeight = bestVideos.reduce(
        (max, stream) => Math.max(max, Number(stream.height || 0)),
        0,
      );
      const hasStandardCombined = bestVideos.some(
        (stream) =>
          !stream.videoOnly &&
          !String(stream.quality || "").toUpperCase().includes("LBRY"),
      );
      if (bestHeight >= 360 && bestAudios.length && hasStandardCombined) break;
    }

    if (bestData) {
      const videoStreams = uniqueStreams(bestData.videoStreams || []).sort(
        (a, b) => b.height - a.height || b.fps - a.fps,
      );
      const audioStreams = uniqueStreams(bestData.audioStreams || []).sort(
        (a, b) => b.bitrate - a.bitrate,
      );
      if (videoStreams.length || audioStreams.length) {
        if (bestData._instance) {
          try {
            window.sessionStorage.setItem(LAST_WORKING_INSTANCE_KEY, bestData._instance);
          } catch {
            // The resolver still works when storage is unavailable.
          }
        }
        return {
          audioStreams,
          duration: Number(bestData.duration || 0),
          thumbnailUrl: bestData.thumbnailUrl || "",
          title: bestData.title,
          uploader: bestData.uploader || "",
          videoId,
          videoStreams,
        };
      }
    }
    throw new Error(
      `已尝试 ${attempted} 个公开解析节点，均未返回可用媒体。请确认视频为公开的普通视频，然后重试；若仍失败，说明公开节点暂时受限。`,
    );
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

  function showFallbackAction(videoId) {
    const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const row = document.createElement("span");
    row.className = "message-action-row";

    const copy = document.createElement("span");
    copy.className = "message-action-copy";
    copy.textContent = "公开解析节点暂时受限，可把同一链接自动带到备用服务继续。";

    const link = document.createElement("a");
    link.className = "message-action";
    link.href = `https://cobalt.tools/#${encodeURIComponent(youtubeUrl)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "使用备用下载 ↗";
    link.setAttribute("aria-label", "在 Cobalt 官方页面使用备用下载");

    row.append(copy, link);
    elements.message.append(row);
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
    }, 4600);
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

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (!value) return "大小未知";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  }

  function estimatedSize(stream) {
    if (!state.data?.duration || !stream.bitrate) return 0;
    return (Number(stream.bitrate) * Number(state.data.duration)) / 8;
  }

  function streamExtension(stream, kind) {
    const mime = String(stream.mimeType || "").toLowerCase();
    const format = String(stream.format || "").toLowerCase();
    if (mime.includes("webm") || format.includes("webm")) return "webm";
    if (kind === "audio") {
      if (mime.includes("mpeg")) return "mp3";
      if (mime.includes("ogg")) return "ogg";
      return "m4a";
    }
    return "mp4";
  }

  function safeFilename(value) {
    return String(value || "youtube-video")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 110) || "youtube-video";
  }

  function qualityLabel(stream, kind) {
    if (kind === "audio") {
      const kbps = stream.bitrate ? Math.round(Number(stream.bitrate) / 1000) : 0;
      return kbps ? `${kbps} kbps` : stream.quality || "音频";
    }
    if (stream.quality) return stream.quality;
    return stream.height ? `${stream.height}p` : "视频";
  }

  function detailLabel(stream, kind) {
    const bits = [];
    bits.push(streamExtension(stream, kind).toUpperCase());
    if (kind === "video" && stream.fps) bits.push(`${stream.fps} FPS`);
    if (stream.codec) bits.push(String(stream.codec).split(".")[0].toUpperCase());
    bits.push(`约 ${formatBytes(estimatedSize(stream))}`);
    return bits.join(" · ");
  }

  function createFormatRow(stream, kind) {
    const row = document.createElement("article");
    row.className = "format-row";

    const quality = document.createElement("div");
    quality.className = "format-quality";
    quality.append(document.createTextNode(qualityLabel(stream, kind)));

    if (stream.videoOnly) {
      const badge = document.createElement("span");
      badge.className = "format-badge";
      badge.textContent = "仅画面";
      quality.append(badge);
    }

    const detail = document.createElement("div");
    detail.className = "format-detail";
    detail.textContent = detailLabel(stream, kind);

    const button = document.createElement("button");
    button.className = "download-button";
    button.type = "button";
    button.textContent = "下载";
    button.addEventListener("click", () => downloadStream(stream, kind, button));

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

    if (state.kind === "video" && streams.some((stream) => stream.videoOnly)) {
      elements.formatNotice.textContent =
        "标注“仅画面”的高清格式不含声音；普通 MP4 格式已包含声音。";
      elements.formatNotice.hidden = false;
    }

    if (!streams.length) {
      const empty = document.createElement("p");
      empty.className = "empty-formats";
      empty.textContent = `该视频没有可用的${state.kind === "audio" ? "音频" : "视频"}格式。`;
      elements.formatList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    streams.forEach((stream) => fragment.append(createFormatRow(stream, state.kind)));
    elements.formatList.append(fragment);
  }

  function renderResult(data) {
    state.data = data;
    state.kind = "video";
    elements.thumbnail.src = data.thumbnailUrl || `https://i.ytimg.com/vi/${data.videoId}/hqdefault.jpg`;
    elements.thumbnail.alt = `${data.title} 的视频封面`;
    elements.title.textContent = data.title || "未命名视频";
    elements.uploader.textContent = data.uploader || "频道信息未知";
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

  function directOpen(url, sameTab = false) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = sameTab ? "_self" : "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function pickerOptions(filename, mimeType) {
    return {
      suggestedName: filename,
      types: [
        {
          description: "媒体文件",
          accept: {
            [mimeType || "application/octet-stream"]: [`.${filename.split(".").pop()}`],
          },
        },
      ],
    };
  }

  function openPendingDownload(filename) {
    const popup = window.open("", "_blank");
    if (!popup) return null;

    try {
      popup.opener = null;
      popup.document.title = "正在准备下载";
      popup.document.body.style.cssText =
        "margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f4ef;color:#161513;font:15px system-ui,sans-serif";
      const message = popup.document.createElement("p");
      message.style.cssText = "max-width:560px;padding:28px;line-height:1.8;text-align:center";
      message.textContent = `正在准备“${filename}”。若文件随后在本页打开，请使用浏览器的“另存为”。`;
      popup.document.body.append(message);
    } catch {
      // The tab can still be navigated even if its placeholder cannot be styled.
    }
    return popup;
  }

  async function saveWithPicker(response, fileHandle, mimeType, button) {
    const writable = await fileHandle.createWritable();
    const reader = response.body.getReader();
    const total = Number(response.headers.get("content-length") || 0);
    let received = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        await writable.write(value);
        button.textContent = total
          ? `${Math.min(99, Math.round((received / total) * 100))}%`
          : formatBytes(received);
      }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
  }

  async function saveWithBlob(response, filename, mimeType, button) {
    const reader = response.body.getReader();
    const total = Number(response.headers.get("content-length") || 0);
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_MEMORY_DOWNLOAD) {
        await reader.cancel();
        throw new Error("FILE_TOO_LARGE_FOR_MEMORY");
      }
      chunks.push(value);
      button.textContent = total
        ? `${Math.min(99, Math.round((received / total) * 100))}%`
        : formatBytes(received);
    }

    const objectUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function downloadStream(stream, kind, button) {
    const originalLabel = button.textContent;
    const extension = streamExtension(stream, kind);
    const suffix = kind === "audio" ? "audio" : qualityLabel(stream, kind).replace(/\s+/g, "-");
    const filename = `${safeFilename(state.data?.title)}-${suffix}.${extension}`;
    const mimeType = stream.mimeType || "application/octet-stream";
    const canPickFile = "showSaveFilePicker" in window && window.isSecureContext;
    let pickerPromise = null;
    let pendingWindow = null;

    button.disabled = true;
    button.textContent = "连接中";

    if (canPickFile) {
      try {
        pickerPromise = window.showSaveFilePicker(pickerOptions(filename, mimeType));
      } catch {
        pickerPromise = null;
      }
    }

    if (!pickerPromise) {
      pendingWindow = openPendingDownload(filename);
      if (!pendingWindow) {
        directOpen(stream.url, true);
        button.disabled = false;
        button.textContent = originalLabel;
        return;
      }
    }

    try {
      const fileHandle = pickerPromise ? await pickerPromise : null;
      const response = await fetch(stream.url);
      if (!response.ok || !response.body) throw new Error("STREAM_UNAVAILABLE");
      const contentLength = Number(response.headers.get("content-length") || 0);
      const responseType = mimeType || response.headers.get("content-type") || "application/octet-stream";

      if (fileHandle) {
        await saveWithPicker(response, fileHandle, responseType, button);
      } else if (!contentLength || contentLength <= MAX_MEMORY_DOWNLOAD) {
        await saveWithBlob(response, filename, responseType, button);
      } else {
        throw new Error("FILE_TOO_LARGE_FOR_MEMORY");
      }
      if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
      showToast("文件已保存。若没有看到文件，请检查浏览器的下载列表。");
    } catch (error) {
      if (error?.name === "AbortError") {
        if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
        showToast("已取消保存。文件没有写入设备。");
      } else {
        if (pendingWindow && !pendingWindow.closed) {
          pendingWindow.location.replace(stream.url);
        } else {
          directOpen(stream.url, true);
        }
        showToast("浏览器已打开媒体文件。请使用“另存为”完成保存。");
      }
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
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
    showMessage("正在轮询可用解析节点，首次使用可能需要 10–20 秒。", "info");

    try {
      const data = await resolveVideo(videoId);
      hideMessage();
      renderResult(data);
    } catch (error) {
      showMessage(error.message || "解析失败，请稍后再试。");
      showFallbackAction(videoId);
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
})();
