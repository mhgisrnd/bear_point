(function (root) {
  "use strict";
  const capacitor = root.Capacitor;
  if (!capacitor || typeof capacitor.registerPlugin === "function") return;
  const native = typeof capacitor.isNativePlatform === "function" ? capacitor.isNativePlatform()
    : typeof capacitor.getPlatform === "function" && capacitor.getPlatform() !== "web";
  if (!native) return;
  // Plain HTML uses Java's injected plugin objects. Supply the native lookup expected by legacy callers.
  capacitor.registerPlugin = function (name) {
    const plugins = capacitor.Plugins;
    if (plugins && Object.prototype.hasOwnProperty.call(plugins, name) && plugins[name]) return plugins[name];
    throw new Error("이 APK에서 " + String(name) + " 플러그인을 찾을 수 없습니다.");
  };
})(window);
