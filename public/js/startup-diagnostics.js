(function (root) {
  "use strict";
  const build = "26.0.0.1";
  root.BEAR_BUILD_VERSION = build;
  const errors = [];
  function render() {
    if (!errors.length || !document.body) return;
    let box = document.getElementById("app-startup-error");
    if (!box) {
      box = document.createElement("section"); box.id = "app-startup-error"; box.setAttribute("role", "alert");
      Object.assign(box.style, { position: "fixed", left: "12px", right: "12px", top: "calc(12px + env(safe-area-inset-top, 0px))",
        zIndex: "2147483647", padding: "12px", border: "1px solid #df8a73", borderRadius: "8px", background: "#fff5ef", color: "#6f2416", font: "13px/1.5 system-ui, sans-serif", maxHeight: "55vh", overflow: "auto" });
      const title = document.createElement("strong"); title.textContent = "앱 실행 오류 · " + build;
      const detail = document.createElement("pre"); detail.dataset.errorDetail = "";
      Object.assign(detail.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit", margin: "8px 0" });
      const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "오류 내용 복사";
      Object.assign(copy.style, { minHeight: "44px", marginRight: "8px" });
      copy.addEventListener("click", async () => {
        try { await root.navigator.clipboard.writeText("BearMap " + build + "\n" + errors.join("\n\n")); copy.textContent = "복사됨"; }
        catch (_) { copy.textContent = "아래 오류 문구를 확인해주세요"; }
      });
      const close = document.createElement("button"); close.type = "button"; close.textContent = "닫기"; close.style.minHeight = "44px";
      close.addEventListener("click", () => box.remove());
      box.append(title, detail, copy, close); document.body.appendChild(box);
    }
    box.querySelector("[data-error-detail]").textContent = errors.join("\n\n");
  }
  function record(message, source, line, column) {
    if (!message) return;
    // Only script identity is retained: omit URL query strings and device/location data.
    let file = "";
    if (source) { try { file = new URL(source, root.location.href).pathname; } catch (_) { file = String(source).split("?")[0]; } }
    const entry = String(message).slice(0, 500) + (file ? "\n" + file + (line ? ":" + line + (column ? ":" + column : "") : "") : "");
    if (!errors.includes(entry) && errors.length < 4) errors.push(entry);
    render();
  }
  root.addEventListener("error", event => record(event.message, event.filename, event.lineno, event.colno));
  root.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    const stack = String(reason?.stack || "");
    const match = stack.match(/((?:https?|capacitor):\/\/[^\s)]+):(\d+):(\d+)/);
    record(reason?.message || String(reason || "비동기 실행 실패"), match?.[1], match?.[2], match?.[3]);
  });
  document.addEventListener("DOMContentLoaded", render);
})(window);
