(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const form = $("edit-form"), modal = $("edit-modal");
  const field = name => form.elements.namedItem(name);
  let items = [], page = 1, editing = null, refreshing = false, saving = false;
  const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  async function request(path = "", options = {}) {
    const response = await fetch("../api/observations" + path, { ...options, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "요청에 실패했습니다.");
    return result;
  }
  window.BearAdminBoundary = { lookup: async (lat, lng) => {
    const response = await fetch("../api/admin-boundary?lat=" + lat + "&lng=" + lng);
    if (!response.ok) throw new Error("위치 조회 실패");
    return (await response.json()).region;
  } };
  const region = window.createEditableRegionField(field("admin_region"));
  for (const name of ["lat", "lng"]) field(name).addEventListener("input", () => {
    region.update(field("lat").value === "" ? NaN : Number(field("lat").value), field("lng").value === "" ? NaN : Number(field("lng").value));
  });
  function render() {
    const search = $("search").value.trim().toLowerCase();
    const filtered = items.filter(row => !row.deleted && [row.place, row.bear_code, row.owner, row.admin_region].some(value => String(value || "").toLowerCase().includes(search)));
    const pages = Math.max(1, Math.ceil(filtered.length / 20));
    page = Math.min(Math.max(1, page), pages);
    $("rows").innerHTML = filtered.slice((page - 1) * 20, page * 20).map(row => `<tr>
      <td>${escape(row.place)}</td><td>${escape(row.bear_code)}</td><td>${escape(row.owner)}</td>
      <td>${escape(row.admin_region || "미지정")}</td><td>${escape(row.lat)}</td><td>${escape(row.lng)}</td><td>${escape(row.heading)}</td>
      <td><button type="button" class="tracking-row-edit" data-edit="${escape(row.id)}">수정</button>
      <button type="button" class="tracking-row-delete" data-delete="${escape(row.id)}">삭제</button></td></tr>`).join("") || '<tr><td colspan="8">공유 관측점이 없습니다.</td></tr>';
    $("page").textContent = `${page} / ${pages} · ${filtered.length}건`;
    $("prev").disabled = page <= 1; $("next").disabled = page >= pages;
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true; $("refresh").disabled = true; $("status").textContent = "불러오는 중…";
    try {
      const rows = []; let after = "";
      do { const result = await request("?after=" + encodeURIComponent(after)); rows.push(...result.items); after = result.next; } while (after);
      items = rows; render(); $("status").textContent = "최신 자료입니다. 앱에서는 공유 새로고침 후 변경사항을 확인할 수 있습니다.";
    } catch (error) { $("status").textContent = error.message; }
    finally { refreshing = false; $("refresh").disabled = false; }
  }
  function close() {
    if (saving) return;
    modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); editing = null; region.reset();
  }
  $("rows").addEventListener("click", async event => {
    const button = event.target.closest("button"); if (!button) return;
    const row = items.find(item => item.id === (button.dataset.edit || button.dataset.delete)); if (!row) return;
    if (button.dataset.edit) {
      editing = row; form.reset();
      for (const name of ["place", "bear_code", "owner", "lat", "lng", "heading"]) field(name).value = row[name];
      const detectors = row.detectors_json || [];
      for (let i = 0; i < 3; i++) {
        field("detector_name_" + i).value = detectors[i]?.detectorName || "";
        field("signal_strength_" + i).value = detectors[i]?.signalStrength || "";
      }
      region.reset(row.admin_region || "", Number(row.lat), Number(row.lng));
      $("edit-status").textContent = ""; modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false"); field("place").focus();
    } else if (window.confirm(row.place + " 관측점을 서버에서 삭제하시겠습니까?")) {
      button.disabled = true;
      try { await request("/" + encodeURIComponent(row.id), { method: "DELETE", body: JSON.stringify({ server_version: row.server_version }) }); await refresh(); }
      catch (error) { $("status").textContent = error.message; }
      finally { button.disabled = false; }
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (saving || !editing) return;
    saving = true; $("save").disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.detectors = [];
      for (let i = 0; i < 3; i++) {
        const detectorName = data["detector_name_" + i].trim();
        const signalStrength = data["signal_strength_" + i].trim();
        if (!!detectorName !== !!signalStrength) throw new Error("감지기명과 신호강도를 함께 입력해주세요.");
        if (detectorName) data.detectors.push({ detectorName, signalStrength });
        delete data["detector_name_" + i]; delete data["signal_strength_" + i];
      }
      data.server_version = editing.server_version;
      data.admin_region = await region.resolve(Number(data.lat), Number(data.lng));
      await request("/" + encodeURIComponent(editing.id), { method: "PATCH", body: JSON.stringify(data) });
      saving = false; close(); await refresh();
    } catch (error) { $("edit-status").textContent = error.message; }
    finally { saving = false; $("save").disabled = false; }
  });
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  $("search").addEventListener("input", () => { page = 1; render(); });
  $("refresh").addEventListener("click", refresh);
  $("prev").addEventListener("click", () => { page--; render(); });
  $("next").addEventListener("click", () => { page++; render(); });
  void refresh();
})();
