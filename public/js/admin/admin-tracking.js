function normalizeTrackingItem(rawItem) {
  const item = rawItem || {};
  const lat = Number(item.lat);
  const lng = Number(item.lng != null ? item.lng : item.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    id: item.id != null ? String(item.id) : "",
    bearCode: String(item.bear_code || item.bearCode || "-").trim() || "-",
    owner: String(item.owner || "미지정").trim() || "미지정",
    place: String(item.place || "미지정").trim() || "미지정",
    uploadedAt: String(item.uploaded_at || item.timestamp || "-").trim() || "-",
    lat,
    lng,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTrackingTable(items, tableBody, rowStartNumber) {
  if (!tableBody) return;

  if (!items.length) {
    tableBody.innerHTML = [
      '<tr>',
      '  <td colspan="9" class="tracking-empty">등록된 추적위치 데이터가 없습니다.</td>',
      '</tr>'
    ].join("\n");
    return;
  }

  const startNumber = Number.isFinite(Number(rowStartNumber)) ? Number(rowStartNumber) : 1;

  tableBody.innerHTML = items.map(function (item, index) {
    return [
      '<tr>',
      '  <td class="tracking-col-num">' + String(startNumber + index) + '</td>',
      '  <td class="tracking-cell-select"><input type="checkbox" class="tracking-row-check" data-id="' + escapeHtml(item.id) + '" /></td>',
      '  <td>' + escapeHtml(item.bearCode) + '</td>',
      '  <td>' + escapeHtml(item.owner) + '</td>',
      '  <td>' + escapeHtml(item.place) + '</td>',
      '  <td>' + escapeHtml(item.lat.toFixed(6)) + '</td>',
      '  <td>' + escapeHtml(item.lng.toFixed(6)) + '</td>',
      '  <td>' + escapeHtml(item.uploadedAt) + '</td>',
      '  <td class="tracking-cell-actions">',
      '    <button type="button" class="tracking-row-edit" data-id="' + escapeHtml(item.id) + '">수정</button>',
      '    <button type="button" class="tracking-row-delete" data-id="' + escapeHtml(item.id) + '">삭제</button>',
      '  </td>',
      '</tr>'
    ].join("\n");
  }).join("\n");
}

async function fetchTrackingItems(options) {
  const queryOptions = options || {};
  const params = new URLSearchParams();
  params.set("page", String(queryOptions.page || 1));
  params.set("pageSize", String(queryOptions.pageSize || 10));

  if (queryOptions.query && String(queryOptions.query).trim()) {
    params.set("q", String(queryOptions.query).trim());
  }

  const response = await fetch("/api/realtime/bear-estimates?" + params.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  const result = await response.json().catch(function () { return {}; });

  if (!response.ok || !result || result.ok === false) {
    throw new Error(result && result.message ? result.message : "추적위치 목록 조회에 실패했습니다.");
  }

  const items = Array.isArray(result.items)
    ? result.items.map(normalizeTrackingItem).filter(Boolean)
    : [];

  return {
    items,
    total: Math.max(Number(result.total || items.length), 0),
    page: Math.max(Number(result.page || queryOptions.page || 1), 1),
    pageSize: Math.max(Number(result.pageSize || queryOptions.pageSize || 10), 1),
  };
}

async function deleteTrackingItems(ids) {
  const response = await fetch("/api/realtime/bear-estimates", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({ ids }),
  });

  const result = await response.json().catch(function () { return {}; });
  if (!response.ok || !result || result.ok === false) {
    throw new Error(result && result.message ? result.message : "선택 항목 삭제에 실패했습니다.");
  }

  return Number(result.deletedCount || 0);
}

async function updateTrackingItem(id, payload) {
  const response = await fetch("/api/realtime/bear-estimates/" + encodeURIComponent(String(id)), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(function () { return {}; });
  if (!response.ok || !result || result.ok === false) {
    throw new Error(result && result.message ? result.message : "항목 수정에 실패했습니다.");
  }

  return result.item || null;
}

function renderPagination(state, prevButton, nextButton, infoElement) {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const currentPage = Math.min(Math.max(state.page, 1), totalPages);

  if (prevButton) {
    prevButton.disabled = state.isLoading || currentPage <= 1;
  }

  if (nextButton) {
    nextButton.disabled = state.isLoading || currentPage >= totalPages;
  }

  if (infoElement) {
    infoElement.textContent = String(currentPage) + " / " + String(totalPages);
  }
}

function initializeTrackingBoard() {
  const refreshButton = document.getElementById("btnTrackingRefresh");
  const tableBody = document.getElementById("trackingTableBody");
  const statusEl = document.getElementById("trackingBoardStatus");
  const searchInput = document.getElementById("trackingSearchInput");
  const clearSearchButton = document.getElementById("btnTrackingSearchClear");
  const prevPageButton = document.getElementById("btnTrackingPrevPage");
  const nextPageButton = document.getElementById("btnTrackingNextPage");
  const pageSizeSelect = document.getElementById("trackingPageSizeSelect");
  const paginationInfo = document.getElementById("trackingPaginationInfo");
  const selectAllCheckbox = document.getElementById("trackingSelectAll");
  const deleteSelectedButton = document.getElementById("btnTrackingDeleteSelected");
  const editModal = document.getElementById("trackingEditModal");
  const editForm = document.getElementById("trackingEditForm");
  const editIdInput = document.getElementById("trackingEditId");
  const editBearCodeInput = document.getElementById("trackingEditBearCode");
  const editOwnerInput = document.getElementById("trackingEditOwner");
  const editPlaceInput = document.getElementById("trackingEditPlace");
  const editStatusEl = document.getElementById("trackingEditStatus");
  const editSaveButton = document.getElementById("btnTrackingEditSave");
  const editCancelButton = document.getElementById("btnTrackingEditCancel");
  const editCloseButton = document.getElementById("btnTrackingEditClose");

  if (!refreshButton || !tableBody || !statusEl || !prevPageButton || !nextPageButton || !pageSizeSelect || !paginationInfo || !selectAllCheckbox || !deleteSelectedButton || !editModal || !editForm || !editIdInput || !editBearCodeInput || !editOwnerInput || !editPlaceInput || !editStatusEl || !editSaveButton || !editCancelButton || !editCloseButton) {
    return;
  }

  const state = {
    isLoading: false,
    page: 1,
    pageSize: Number(pageSizeSelect.value || 10),
    total: 0,
    query: "",
    selectedIds: new Set(),
    currentItems: [],
    isEditSaving: false,
  };
  let searchDebounceId = 0;

  function closeEditModal() {
    editModal.classList.remove("is-open");
    editModal.setAttribute("aria-hidden", "true");
    editForm.reset();
    editIdInput.value = "";
    editStatusEl.textContent = "";
    state.isEditSaving = false;
    editSaveButton.disabled = false;
  }

  function openEditModal(item) {
    if (!item) return;
    editIdInput.value = String(item.id || "");
    editBearCodeInput.value = String(item.bearCode || "");
    editOwnerInput.value = String(item.owner || "");
    editPlaceInput.value = String(item.place || "");
    editStatusEl.textContent = "";
    editModal.classList.add("is-open");
    editModal.setAttribute("aria-hidden", "false");
    window.setTimeout(function () {
      editBearCodeInput.focus();
    }, 0);
  }

  function updateSelectionUi() {
    const currentIds = state.currentItems.map(function (item) { return String(item.id || ""); }).filter(Boolean);
    const selectedCount = currentIds.filter(function (id) { return state.selectedIds.has(id); }).length;
    selectAllCheckbox.checked = currentIds.length > 0 && selectedCount === currentIds.length;
    selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < currentIds.length;
    deleteSelectedButton.disabled = state.isLoading || selectedCount === 0;
  }

  function bindTableRowEvents() {
    tableBody.querySelectorAll(".tracking-row-check").forEach(function (checkboxEl) {
      const id = String(checkboxEl.getAttribute("data-id") || "");
      checkboxEl.checked = state.selectedIds.has(id);
      checkboxEl.addEventListener("change", function () {
        if (checkboxEl.checked) {
          state.selectedIds.add(id);
        } else {
          state.selectedIds.delete(id);
        }
        updateSelectionUi();
      });
    });

    tableBody.querySelectorAll(".tracking-row-edit").forEach(function (editButtonEl) {
      editButtonEl.addEventListener("click", function () {
        const id = String(editButtonEl.getAttribute("data-id") || "");
        const targetItem = state.currentItems.find(function (item) {
          return String(item.id || "") === id;
        });
        openEditModal(targetItem);
      });
    });

    tableBody.querySelectorAll(".tracking-row-delete").forEach(function (deleteButtonEl) {
      deleteButtonEl.addEventListener("click", async function () {
        if (state.isLoading) return;

        const id = String(deleteButtonEl.getAttribute("data-id") || "");
        if (!id) return;

        const targetItem = state.currentItems.find(function (item) {
          return String(item.id || "") === id;
        });
        const label = targetItem ? String(targetItem.bearCode || id) : id;
        const ok = window.confirm("선택한 항목(" + label + ")을 삭제하시겠습니까?");
        if (!ok) return;

        try {
          const deletedCount = await deleteTrackingItems([id]);
          if (deletedCount > 0) {
            state.selectedIds.delete(id);
          }

          const expectedRemaining = Math.max(state.total - deletedCount, 0);
          const totalPagesAfterDelete = Math.max(1, Math.ceil(expectedRemaining / state.pageSize));
          if (state.page > totalPagesAfterDelete) {
            state.page = totalPagesAfterDelete;
          }

          await loadTrackingItems();
          statusEl.textContent = deletedCount > 0 ? "항목을 삭제했습니다." : "삭제할 항목이 없습니다.";
        } catch (error) {
          statusEl.textContent = error && error.message ? error.message : "항목 삭제에 실패했습니다.";
          console.error("[admin-tracking] row delete failed", error);
          updateSelectionUi();
        }
      });
    });

    updateSelectionUi();
  }

  async function loadTrackingItems() {
    if (state.isLoading) return;
    state.isLoading = true;
    refreshButton.disabled = true;
    renderPagination(state, prevPageButton, nextPageButton, paginationInfo);
    statusEl.textContent = "추적위치 목록을 불러오는 중입니다...";

    try {
      const result = await fetchTrackingItems({
        page: state.page,
        pageSize: state.pageSize,
        query: state.query,
      });

      state.currentItems = result.items;
      state.selectedIds.clear();
      state.total = result.total;
      state.page = result.page;
      state.pageSize = result.pageSize;

      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
      if (state.page > totalPages) {
        state.page = totalPages;
      }

      const rowStartNumber = state.total > 0 ? (state.page - 1) * state.pageSize + 1 : 1;
      renderTrackingTable(result.items, tableBody, rowStartNumber);
      bindTableRowEvents();
      statusEl.textContent = '총 ' + String(state.total) + '건 중 ' + String(result.items.length) + '건을 표시합니다.';
    } catch (error) {
      renderTrackingTable([], tableBody, 1);
      state.currentItems = [];
      state.selectedIds.clear();
      state.total = 0;
      updateSelectionUi();
      statusEl.textContent = error && error.message ? error.message : "추적위치 목록을 불러오지 못했습니다.";
      console.error("[admin-tracking] list load failed", error);
    } finally {
      refreshButton.disabled = false;
      state.isLoading = false;
      renderPagination(state, prevPageButton, nextPageButton, paginationInfo);
    }
  }

  refreshButton.addEventListener("click", function () {
    loadTrackingItems();
  });

  selectAllCheckbox.addEventListener("change", function () {
    const shouldSelectAll = !!selectAllCheckbox.checked;
    state.currentItems.forEach(function (item) {
      const id = String(item.id || "");
      if (!id) return;
      if (shouldSelectAll) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
    });

    tableBody.querySelectorAll(".tracking-row-check").forEach(function (checkboxEl) {
      checkboxEl.checked = shouldSelectAll;
    });
    updateSelectionUi();
  });

  deleteSelectedButton.addEventListener("click", async function () {
    if (state.isLoading) return;

    const ids = Array.from(state.selectedIds);
    if (!ids.length) return;

    const ok = window.confirm("선택한 " + String(ids.length) + "건을 삭제하시겠습니까?");
    if (!ok) return;

    try {
      deleteSelectedButton.disabled = true;
      const deletedCount = await deleteTrackingItems(ids);
      statusEl.textContent = String(deletedCount) + "건을 삭제했습니다.";

      const expectedRemaining = Math.max(state.total - deletedCount, 0);
      const totalPagesAfterDelete = Math.max(1, Math.ceil(expectedRemaining / state.pageSize));
      if (state.page > totalPagesAfterDelete) {
        state.page = totalPagesAfterDelete;
      }

      await loadTrackingItems();
    } catch (error) {
      statusEl.textContent = error && error.message ? error.message : "선택 항목 삭제에 실패했습니다.";
      console.error("[admin-tracking] bulk delete failed", error);
      updateSelectionUi();
    }
  });

  prevPageButton.addEventListener("click", function () {
    if (state.page <= 1 || state.isLoading) return;
    state.page -= 1;
    loadTrackingItems();
  });

  nextPageButton.addEventListener("click", function () {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page >= totalPages || state.isLoading) return;
    state.page += 1;
    loadTrackingItems();
  });

  pageSizeSelect.addEventListener("change", function () {
    const nextSize = Math.max(Number(pageSizeSelect.value || 10), 1);
    state.pageSize = nextSize;
    state.page = 1;
    loadTrackingItems();
  });

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      if (searchDebounceId) {
        window.clearTimeout(searchDebounceId);
      }

      searchDebounceId = window.setTimeout(function () {
        state.query = String(searchInput.value || "").trim();
        state.page = 1;
        loadTrackingItems();
      }, 260);
    });
  }

  if (clearSearchButton && searchInput) {
    clearSearchButton.addEventListener("click", function () {
      if (!searchInput.value && !state.query) return;
      searchInput.value = "";
      state.query = "";
      state.page = 1;
      loadTrackingItems();
    });
  }

  [editCancelButton, editCloseButton].forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeEditModal();
    });
  });

  editModal.querySelectorAll("[data-modal-close='tracking-edit']").forEach(function (el) {
    el.addEventListener("click", function () {
      closeEditModal();
    });
  });

  editForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (state.isEditSaving) return;

    const id = String(editIdInput.value || "").trim();
    const bearCode = String(editBearCodeInput.value || "").trim();
    const owner = String(editOwnerInput.value || "").trim();
    const place = String(editPlaceInput.value || "").trim();

    if (!id) {
      editStatusEl.textContent = "수정 대상 id가 없습니다.";
      return;
    }

    if (!bearCode) {
      editStatusEl.textContent = "곰 코드는 필수입니다.";
      editBearCodeInput.focus();
      return;
    }

    try {
      state.isEditSaving = true;
      editSaveButton.disabled = true;
      //editStatusEl.textContent = "저장 중...";
      await updateTrackingItem(id, {
        bear_code: bearCode,
        owner,
        place,
      });

      closeEditModal();
      await loadTrackingItems();
      statusEl.textContent = "항목 정보를 수정했습니다.";
    } catch (error) {
      editStatusEl.textContent = error && error.message ? error.message : "수정에 실패했습니다.";
      console.error("[admin-tracking] item update failed", error);
      state.isEditSaving = false;
      editSaveButton.disabled = false;
    }
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && editModal.classList.contains("is-open")) {
      closeEditModal();
    }
  });

  renderPagination(state, prevPageButton, nextPageButton, paginationInfo);
  updateSelectionUi();

  loadTrackingItems();
}

document.addEventListener("admin-layout:ready", initializeTrackingBoard);
document.addEventListener("DOMContentLoaded", initializeTrackingBoard);
