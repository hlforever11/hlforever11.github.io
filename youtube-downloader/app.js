(() => {
  "use strict";

  const MAX_MEMORY_DOWNLOAD = 250 * 1024 * 1024;
  const PIPED_INSTANCES = [
    "https://api.piped.private.coffee",
    "https://pipedapi.adminforge.de",
    "https://api.piped.yt",
    "https://piped-api.privacy.com.de",
    "https://pipedapi.drgns.space",
    "https://pipedapi.owo.si",
    "https://pipedapi.ducks.party",
    "https://piped-api.codespace.cz",
    "https://pipedapi.kavin.rocks",
  ];
  const INVIDIOUS_INSTANCES = [
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://yt.chocolatemoo53.com",
    "https://invidious.tiekoetter.com",
    "https://invidious.f5.si",
  ];

  const elements = {
    form: document.querySelector("#download-form"),
    input: document.querySelector("#video-url"),
    urlField: document.querySelector("#url-field"),
    rights: document.querySelector("#rights-confirm"),
    parseButton: document.querySelector("#parse-button"),
    buttonLabel: document.querySelector(".button-label"),
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
  };

  const state = {
    data: null,
    kind: "video",
    toastTimer: null,
  };

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
    const timeout = window.setTimeout(() => controller.abort(), 7000);

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
      return data;
    } catch (error) {
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function absoluteUrl(value, base) {
    try {
      return new URL(value, base).href;
    } catch {
      return "";
    }
  }

  function invidiousHeight(stream) {
    const resolution = String(stream.resolution || "").match(/x(\d+)/i)?.[1];
    const quality = String(stream.qualityLabel || stream.quality || "").match(/(\d+)p/i)?.[1];
    return Number(resolution || quality || 0);
  }

  function normalizeInvidiousStream(stream, instance, videoOnly) {
    const mimeType = String(stream.type || "").split(";")[0] || "application/octet-stream";
    return {
      bitrate: Number(stream.bitrate || 0),
      codec: stream.encoding || "",
      format: stream.container || "",
      fps: Number(stream.fps || 0),
      height: invidiousHeight(stream),
      mimeType,
      quality: stream.qualityLabel || stream.quality || stream.audioQuality || "未知",
      url: absoluteUrl(stream.url, instance),
      videoOnly,
      width: Number(String(stream.resolution || "").split("x")[0] || 0),
    };
  }

  async function queryInvidious(instance, videoId) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(`${instance}/api/v1/videos/${videoId}?local=true`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data?.title) throw new Error("响应数据不完整");
      if (data.liveNow) throw new Error("暂不支持正在直播的视频，请在直播结束后再试。");

      const combined = (data.formatStreams || []).map((stream) =>
        normalizeInvidiousStream(stream, instance, false),
      );
      const adaptive = data.adaptiveFormats || [];
      const adaptiveVideo = adaptive
        .filter((stream) => String(stream.type || "").startsWith("video/"))
        .map((stream) => normalizeInvidiousStream(stream, instance, true));
      const audioStreams = adaptive
        .filter((stream) => String(stream.type || "").startsWith("audio/"))
        .map((stream) => normalizeInvidiousStream(stream, instance, false));
      const videoStreams = uniqueStreams([...combined, ...adaptiveVideo]).sort(
        (a, b) => b.height - a.height || b.fps - a.fps,
      );
      const cleanAudio = uniqueStreams(audioStreams).sort((a, b) => b.bitrate - a.bitrate);

      if (!videoStreams.length && !cleanAudio.length) throw new Error("没有可用格式");
      const thumbnails = Array.isArray(data.videoThumbnails) ? data.videoThumbnails : [];
      const thumbnail = [...thumbnails].sort(
        (a, b) => Number(b.width || 0) - Number(a.width || 0),
      )[0];

      return {
        audioStreams: cleanAudio,
        duration: Number(data.lengthSeconds || 0),
        thumbnailUrl: absoluteUrl(thumbnail?.url || "", instance),
        title: data.title,
        uploader: data.author || "",
        videoId,
        videoStreams,
      };
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

  async function resolveVideo(videoId) {
    for (let index = 0; index < INVIDIOUS_INSTANCES.length; index += 3) {
      const batch = INVIDIOUS_INSTANCES.slice(index, index + 3);
      try {
        return await Promise.any(
          batch.map((instance) => queryInvidious(instance, videoId)),
        );
      } catch {
        // Continue with the next group, then fall back to Piped.
      }
    }

    let bestData = null;

    for (let index = 0; index < PIPED_INSTANCES.length; index += 3) {
      const batch = PIPED_INSTANCES.slice(index, index + 3);
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
      if (bestHeight >= 720 && bestAudios.length) break;
    }

    if (bestData) {
      const videoStreams = uniqueStreams(bestData.videoStreams || []).sort(
        (a, b) => b.height - a.height || b.fps - a.fps,
      );
      const audioStreams = uniqueStreams(bestData.audioStreams || []).sort(
        (a, b) => b.bitrate - a.bitrate,
      );
      if (videoStreams.length || audioStreams.length) {
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
    throw new Error("暂时无法解析该视频。可能是视频受限、已删除，或解析服务正忙，请稍后重试。");
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

  function directOpen(url) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  async function saveWithPicker(response, filename, mimeType, button) {
    const picker = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "媒体文件",
          accept: { [mimeType || "application/octet-stream"]: [`.${filename.split(".").pop()}`] },
        },
      ],
    });
    const writable = await picker.createWritable();
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

    button.disabled = true;
    button.textContent = "连接中";

    try {
      const response = await fetch(stream.url);
      if (!response.ok || !response.body) throw new Error("STREAM_UNAVAILABLE");
      const contentLength = Number(response.headers.get("content-length") || 0);
      const mimeType = stream.mimeType || response.headers.get("content-type") || "application/octet-stream";

      if ("showSaveFilePicker" in window && window.isSecureContext) {
        await saveWithPicker(response, filename, mimeType, button);
      } else if (!contentLength || contentLength <= MAX_MEMORY_DOWNLOAD) {
        await saveWithBlob(response, filename, mimeType, button);
      } else {
        throw new Error("FILE_TOO_LARGE_FOR_MEMORY");
      }
      showToast("文件已保存。若没有看到文件，请检查浏览器的下载列表。");
    } catch (error) {
      if (error?.name === "AbortError") {
        showToast("已取消保存。文件没有写入设备。");
      } else {
        directOpen(stream.url);
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
    showMessage("正在读取视频信息，通常需要几秒钟。", "info");

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
    if (!elements.message.classList.contains("is-info")) hideMessage();
  });

  elements.pasteButton.addEventListener("click", async () => {
    try {
      elements.input.value = await navigator.clipboard.readText();
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
})();
