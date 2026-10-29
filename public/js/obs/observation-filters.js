(function (root) {
  "use strict";
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  function dateKey(value) {
    if (value == null || value === "") return "";
    let input = value;
    if (typeof input === "string") {
      input = input.trim();
      // observations.created_at uses UTC, including SQLite's timezone-less values.
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(input) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(input)) input = input.replace(" ", "T") + "Z";
    }
    const date = new Date(input);
    if (!Number.isFinite(date.getTime())) return "";
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function periodKey(filters, now = new Date()) {
    if (filters.period === "today") return dateKey(now);
    if (filters.period === "day") return validDay(filters.day || "") ? filters.day : null;
    if (filters.period === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month || "") ? filters.month : null;
    if (filters.period === "year") return /^(19\d{2}|[2-9]\d{3})$/.test(filters.year || "") ? filters.year : null;
    return "";
  }
  function filter(items, filters, now) {
    const period = periodKey(filters, now);
    const owner = String(filters.owner || "").trim();
    if (period === null) return [];
    return items.filter(item => (!owner || String(item.owner || "").trim() === owner) &&
      (!period || dateKey(item.createdAt ?? item.created_at).startsWith(period)));
  }
  function summary(filters, now) {
    const parts = [];
    if (filters.owner) parts.push("담당자: " + filters.owner);
    const period = periodKey(filters, now);
    if (filters.period !== "all") parts.push(period === null ? "기간 선택 필요" : filters.period === "today" ? "오늘" : period);
    return parts.join(" · ");
  }
  const api = { dateKey, periodKey, filter, summary };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearObservationFilters = api;
})(typeof window !== "undefined" ? window : globalThis);
