function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUserItem(rawItem) {
  const item = rawItem || {};
  return {
    id: item.id != null ? String(item.id) : "",
    loginId: String(item.user_id || "-").trim() || "-",
    name: String(item.user_name || "-").trim() || "-",
    role: String(item.role_code || "-").trim() || "-",
    status: item.is_active === false ? "비활성" : "활성",
    lastLoginAt: String(item.last_login_at || "-").trim() || "-",
    createdAt: String(item.created_at || "-").trim() || "-",
    updatedAt: String(item.updated_at || "-").trim() || "-",
  };
}

function buildUserStatusBadge(status) {
  const label = String(status || "대기").trim() || "대기";
  let toneClass = "user-status--pending";

  if (label === "활성") {
    toneClass = "user-status--active";
  } else if (label === "비활성") {
    toneClass = "user-status--inactive";
  }

  return '<span class="user-status ' + toneClass + '">' + escapeHtml(label) + "</span>";
}

function renderUserTable(items, tableBody) {
  if (!tableBody) return;

  if (!items.length) {
    tableBody.innerHTML = [
      "<tr>",
      '  <td colspan="9" class="tracking-empty">표시할 사용자 데이터가 없습니다.</td>',
      "</tr>",
    ].join("\n");
    return;
  }

  tableBody.innerHTML = items.map(function (item) {
    return [
      "<tr>",
      '  <td class="tracking-cell-select"><input type="checkbox" class="user-row-check" data-id="' + escapeHtml(item.id) + '" /></td>',
      "  <td>" + escapeHtml(item.loginId) + "</td>",
      "  <td>" + escapeHtml(item.name) + "</td>",
      "  <td>" + escapeHtml(item.role) + "</td>",
      "  <td>" + buildUserStatusBadge(item.status) + "</td>",
      "  <td>" + escapeHtml(item.lastLoginAt) + "</td>",
      "  <td>" + escapeHtml(item.createdAt) + "</td>",
      "  <td>" + escapeHtml(item.updatedAt) + "</td>",
      '  <td class="tracking-cell-actions">',
      '    <button type="button" class="tracking-row-edit user-row-edit" data-id="' + escapeHtml(item.id) + '">수정</button>',
      '    <button type="button" class="tracking-row-delete user-row-delete" data-id="' + escapeHtml(item.id) + '">삭제</button>',
      "  </td>",
      "</tr>",
    ].join("\n");
  }).join("\n");
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

async function fetchUserItems(options) {
  const queryOptions = options || {};
  const params = new URLSearchParams();
  params.set("page", String(queryOptions.page || 1));
  params.set("pageSize", String(queryOptions.pageSize || 10));

  if (queryOptions.query && String(queryOptions.query).trim()) {
    params.set("q", String(queryOptions.query).trim());
  }

  const response = await fetch("/api/admin/users?" + params.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  const result = await response.json().catch(function () { return {}; });
  if (!response.ok || !result || result.ok === false) {
    throw new Error(result && result.message ? result.message : "사용자 목록 조회에 실패했습니다.");
  }

  const items = Array.isArray(result.items)
    ? result.items.map(normalizeUserItem)
    : [];

  return {
    items,
    total: Math.max(Number(result.total || items.length), 0),
    page: Math.max(Number(result.page || queryOptions.page || 1), 1),
    pageSize: Math.max(Number(result.pageSize || queryOptions.pageSize || 10), 1),
  };
}

function initializeUserBoard() {
  const refreshButton = document.getElementById("btnUserRefresh");
  //const inviteButton = document.getElementById("btnUserInvite");
  const tableBody = document.getElementById("userTableBody");
  const statusEl = document.getElementById("userBoardStatus");
  const searchInput = document.getElementById("userSearchInput");
  const clearSearchButton = document.getElementById("btnUserSearchClear");
  const prevPageButton = document.getElementById("btnUserPrevPage");
  const nextPageButton = document.getElementById("btnUserNextPage");
  const pageSizeSelect = document.getElementById("userPageSizeSelect");
  const paginationInfo = document.getElementById("userPaginationInfo");
  const selectAllCheckbox = document.getElementById("userSelectAll");
  const deleteSelectedButton = document.getElementById("btnUserDeleteSelected");

  if (!refreshButton || !tableBody || !statusEl || !searchInput || !clearSearchButton || !prevPageButton || !nextPageButton || !pageSizeSelect || !paginationInfo || !selectAllCheckbox || !deleteSelectedButton) {
    return;
  }

  const state = {
    isLoading: false,
    page: 1,
    pageSize: Number(pageSizeSelect.value || 10),
    total: 0,
    query: "",
    currentItems: [],
    selectedIds: new Set(),
  };
  let searchDebounceId = 0;

  function updateSelectionUi() {
    const currentIds = state.currentItems.map(function (item) { return String(item.id || ""); }).filter(Boolean);
    const selectedCount = currentIds.filter(function (id) { return state.selectedIds.has(id); }).length;

    selectAllCheckbox.checked = currentIds.length > 0 && selectedCount === currentIds.length;
    selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < currentIds.length;
    deleteSelectedButton.disabled = true;
  }

  function bindTableRowEvents() {
    tableBody.querySelectorAll(".user-row-check").forEach(function (checkboxEl) {
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

    tableBody.querySelectorAll(".user-row-edit").forEach(function (buttonEl) {
      buttonEl.addEventListener("click", function () {
        if (window.showAdminNotice) {
          window.showAdminNotice({
            title: "사용자 수정",
            message: "조회/검색 연동만 우선 적용된 상태입니다. 수정 기능은 다음 단계에서 연결됩니다.",
            triggerElement: buttonEl,
          });
          return;
        }

        window.alert("조회/검색 연동만 우선 적용된 상태입니다. 수정 기능은 다음 단계에서 연결됩니다.");
      });
    });

    tableBody.querySelectorAll(".user-row-delete").forEach(function (buttonEl) {
      buttonEl.addEventListener("click", function () {
        if (window.showAdminNotice) {
          window.showAdminNotice({
            title: "사용자 삭제",
            message: "조회/검색 연동만 우선 적용된 상태입니다. 삭제 기능은 다음 단계에서 연결됩니다.",
            triggerElement: buttonEl,
          });
          return;
        }

        window.alert("조회/검색 연동만 우선 적용된 상태입니다. 삭제 기능은 다음 단계에서 연결됩니다.");
      });
    });

    updateSelectionUi();
  }

  async function loadUserItems() {
    if (state.isLoading) return;
    state.isLoading = true;
    refreshButton.disabled = true;
    renderPagination(state, prevPageButton, nextPageButton, paginationInfo);
    statusEl.textContent = "사용자 목록을 불러오는 중입니다...";

    try {
      const result = await fetchUserItems({
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

      renderUserTable(result.items, tableBody);
      bindTableRowEvents();
      statusEl.textContent = "총 " + String(state.total) + "건 중 " + String(result.items.length) + "건을 표시합니다.";
    } catch (error) {
      renderUserTable([], tableBody);
      state.currentItems = [];
      state.selectedIds.clear();
      state.total = 0;
      updateSelectionUi();
      statusEl.textContent = error && error.message ? error.message : "사용자 목록을 불러오지 못했습니다.";
      console.error("[admin-users] list load failed", error);
    } finally {
      refreshButton.disabled = false;
      state.isLoading = false;
      renderPagination(state, prevPageButton, nextPageButton, paginationInfo);
    }
  }

  refreshButton.addEventListener("click", function () {
    loadUserItems();
  });

  // inviteButton.addEventListener("click", function () {
  //   if (window.showAdminNotice) {
  //     window.showAdminNotice({
  //       title: "사용자 초대",
  //       message: "조회/검색 연동만 우선 적용된 상태입니다. 초대 기능은 다음 단계에서 연결됩니다.",
  //       triggerElement: inviteButton,
  //     });
  //     return;
  //   }

  //   window.alert("조회/검색 연동만 우선 적용된 상태입니다. 초대 기능은 다음 단계에서 연결됩니다.");
  // });

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

    tableBody.querySelectorAll(".user-row-check").forEach(function (checkboxEl) {
      checkboxEl.checked = shouldSelectAll;
    });
    updateSelectionUi();
  });

  deleteSelectedButton.addEventListener("click", function () {
    if (window.showAdminNotice) {
      window.showAdminNotice({
        title: "선택 삭제",
        message: "조회/검색 연동만 우선 적용된 상태입니다. 삭제 기능은 다음 단계에서 연결됩니다.",
        triggerElement: deleteSelectedButton,
      });
      return;
    }

    window.alert("조회/검색 연동만 우선 적용된 상태입니다. 삭제 기능은 다음 단계에서 연결됩니다.");
  });

  prevPageButton.addEventListener("click", function () {
    if (state.page <= 1 || state.isLoading) return;
    state.page -= 1;
    loadUserItems();
  });

  nextPageButton.addEventListener("click", function () {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page >= totalPages || state.isLoading) return;
    state.page += 1;
    loadUserItems();
  });

  pageSizeSelect.addEventListener("change", function () {
    state.pageSize = Math.max(Number(pageSizeSelect.value || 10), 1);
    state.page = 1;
    loadUserItems();
  });

  searchInput.addEventListener("input", function () {
    if (searchDebounceId) {
      window.clearTimeout(searchDebounceId);
    }

    searchDebounceId = window.setTimeout(function () {
      state.query = String(searchInput.value || "").trim();
      state.page = 1;
      loadUserItems();
    }, 220);
  });

  clearSearchButton.addEventListener("click", function () {
    if (!searchInput.value && !state.query) return;
    searchInput.value = "";
    state.query = "";
    state.page = 1;
    loadUserItems();
  });

  loadUserItems();
}

document.addEventListener("admin-layout:ready", initializeUserBoard);
document.addEventListener("DOMContentLoaded", initializeUserBoard);
