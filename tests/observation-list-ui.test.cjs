const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/js/obs/obsList.js"), "utf8");
const clientSource = fs.readFileSync(path.join(__dirname, "../public/js/client-ol.js"), "utf8");
const rows = [
  { id: "one", _obsKey: "one", place: "local", shareState: "local", bearCode: "A" },
  { id: "two", _obsKey: "two", place: "failed", shareState: "failed", bearCode: "A" },
  { id: "three", _obsKey: "three", place: "shared", shareState: "shared", bearCode: "A" }
];
test("animal detail uses compact full-width rows and retains export/delete permissions", () => {
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const context = vm.createContext({ escapeHtml, normalizePlaceName: value => String(value || "").trim(),
    normalizeOwnerName: value => String(value || "").trim(), decimalToDMS: value => "DMS-" + value,
    legacyTmCoordFromWgs84: () => [260052.486, 193077.416], formatPopupCoordinate: value => String(value),
    formatKstDateTimeLabel: value => String(value) });
  const start = clientSource.indexOf("  function buildBearEstimatePopupHtml(item) {");
  const end = clientSource.indexOf("  const analysisGuideLayer", start);
  vm.runInContext(clientSource.slice(start, end), context);
  const item = { bear_code: "005", owner: '긴 등록자 <script>', place: "긴 지명", admin_region: "전라남도 구례군 토지면",
    lat: 35.2324, lng: 127.6597, created_at: "2026-10-29 10:00:00" };
  const html = context.buildBearEstimatePopupHtml(item);
  assert.match(html, /obs-popup-card--estimate/);
  assert.doesNotMatch(html, /obs-popup-card__grid/);
  assert.match(html, /전라남도 구례군 토지면/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<summary>좌표·등록정보<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
  assert.match(html, /data-bear-action="txt"/); assert.match(html, /data-bear-action="xls"/); assert.match(html, /data-bear-action="delete"/);
  assert.doesNotMatch(context.buildBearEstimatePopupHtml({ ...item, isRealtime: true }), /data-bear-action="delete"/);
  assert.doesNotMatch(context.buildBearEstimatePopupHtml({ ...item, _unsaved: true }), /data-bear-action="xls"|data-bear-action="delete"/);
});
test("observation detail table preserves long text, detector rows and zero heading safely", () => {
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const context = vm.createContext({ escapeHtml, getObservationLabel: item => item.place,
    formatCoordinate: value => String(value), formatDateTimeSeconds: value => String(value),
    isShared: item => item.shareState === "shared" });
  const start = source.indexOf("  function buildDetectorRowsHtml(detectors) {");
  const end = source.indexOf("  // SQLite row/", start);
  vm.runInContext(source.slice(start, end), context);
  const item = { place: "표 테스트", bearCode: "KF-58", owner: '긴 담당자 <script>alert(1)</script>',
    adminRegion: "전라남도 구례군 토지면 긴 위치 이름", lat: 35, lng: 127, heading: 0,
    createdAt: "2026-10-29 10:00:00", shareState: "shared",
    detectors: [{ detectorName: '긴 감지기 이름 "A"', signalStrength: "P3" }, { detectorName: "B", signalStrength: "P5" }] };
  const html = context.buildObservationPopupHtml(item);
  assert.match(html, /<table/);
  assert.match(html, /전라남도 구례군 토지면 긴 위치 이름/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /감지기 1/); assert.match(html, /감지기 2/);
  assert.match(html, /감도 P3/);
  assert.match(html, /KF-58 · 0<\/span>/);
  assert.match(html, /<details class="obs-detail-more"><summary>등록정보/);
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
  assert.doesNotMatch(html, /관리자 페이지/);
  assert.match(html, /data-observation-action="delete"/);
  assert.match(html, /data-observation-action="edit"/);
  assert.match(context.buildObservationPopupHtml({ ...item, shareState: "local" }), /data-observation-action="edit"/);
});
test("shared rows have no status decoration; unshared rows expose no individual send button", () => {
  const context = vm.createContext({ escapeHtml: value => String(value).replace(/"/g, "&quot;") });
  const start = source.indexOf("  function buildShareStatus(item) {");
  const end = source.indexOf("  async function sendItems", start);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.buildShareStatus({ shareState: "shared" }), '');
  for (const state of ["local", "failed"]) {
    const needed = context.buildShareStatus({ shareState: state });
    assert.match(needed, /미공유/);
    assert.doesNotMatch(needed, /<button|data-action="send"/);
  }
  assert.doesNotMatch(context.buildShareStatus({ shareState: "sending" }), /<button/);
  assert.match(context.buildShareStatus({ shareState: "conflict" }), /data-action="conflict"/);
});
test("one list includes shared and unshared observations, with ordinary text search", () => {
  const context = vm.createContext({ observationSamples: rows, searchFieldEl: { value: "obs" }, searchQueryEl: { value: "" }, getObservationLabel: item => item.place,
    window: { BearObservationFilters: require('../public/js/obs/observation-filters') }, readObservationFilters: () => ({ period: 'all' }) });
  const start = source.indexOf("  function getFilteredItems() {");
  const end = source.indexOf("  //", start);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.getFilteredItems().length, 3);
  assert.equal(new Set(context.getFilteredItems().map(item => item.id)).size, 3);
  context.searchQueryEl.value = "local";
  assert.equal(context.getFilteredItems().length, 1);
  assert.equal(context.getFilteredItems()[0].id, "one");
});
test("bulk actions appear only for the selected eligible observations", () => {
  const field = () => ({ hidden: false, disabled: false, style: {}, textContent: "" });
  const context = vm.createContext({ observationSamples: rows, selectedObsIds: new Set(), selectionActionsEl: field(),
    obsSelectedCountEl: field(), btnAnalysis: field(), btnDeleteSelected: field(), btnSendSelected: field(),
    isShared: item => ["shared", "sending"].includes(item.shareState), getFilteredItems: () => rows,
    syncChkAll() {}, syncObservationMarkerSelection() {} });
  const start = source.indexOf("  function updateSelectionUI() {");
  const end = source.indexOf("  //", start);
  vm.runInContext(source.slice(start, end), context);
  context.updateSelectionUI();
  assert.equal(context.selectionActionsEl.hidden, true);
  assert.equal(context.btnAnalysis.hidden, true);
  context.selectedObsIds.add("three"); context.updateSelectionUI();
  assert.equal(context.btnDeleteSelected.hidden, false);
  assert.equal(context.btnSendSelected.hidden, true);
  context.selectedObsIds.add("two"); context.updateSelectionUI();
  assert.equal(context.btnAnalysis.hidden, false);
  assert.equal(context.btnSendSelected.hidden, false);
  assert.equal(context.btnSendSelected.textContent, "선택 공유 1");
  assert.equal(context.btnDeleteSelected.textContent, "선택 삭제 2");
});
