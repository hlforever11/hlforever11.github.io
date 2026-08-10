(() => {
  "use strict";

  const value = document.querySelector("#busuanzi_page_pv");
  if (!value) return;

  const publish = () => {
    const raw = String(value.textContent || "").replace(/[,，\s]/g, "");
    if (!/^\d+$/.test(raw)) return false;
    window.parent.postMessage(
      { type: "youtube-downloader-page-count", raw: Number(raw) },
      window.location.origin,
    );
    return true;
  };

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type === "youtube-downloader-count-request") publish();
  });

  if (publish()) return;
  const observer = new MutationObserver(() => {
    if (publish()) observer.disconnect();
  });
  observer.observe(value, { childList: true, subtree: true, characterData: true });
  window.setTimeout(() => observer.disconnect(), 12_000);
})();
