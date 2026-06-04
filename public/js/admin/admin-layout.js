const adminSidebar = document.getElementById("adminSidebar");
const adminHeader = document.getElementById("adminHeader");
const adminFooter = document.getElementById("adminFooter");

let adminNoticeModalState = null;
let adminSidebarActionsBound = false;

async function injectFragment(targetElement, url) {
  if (!targetElement) {
    return;
  }

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`${url} 로드를 실패했습니다.`);
  }

  targetElement.innerHTML = await response.text();
}

function applyAdminPageMetadata() {
  const pageKey = document.body.dataset.adminPage || "";
  const pageTitle = document.body.dataset.adminTitle || "관리자 페이지";
  const pageSubtitle = document.body.dataset.adminSubtitle || "";
  const titleElement = document.getElementById("adminHeaderTitle");
  const subtitleElement = document.getElementById("adminHeaderSubtitle");

  document.querySelectorAll("[data-admin-link]").forEach((linkElement) => {
    linkElement.classList.toggle("is-active", linkElement.dataset.adminLink === pageKey);
  });

  if (titleElement) {
    titleElement.textContent = pageTitle;
  }

  if (subtitleElement) {
    subtitleElement.textContent = pageSubtitle;
  }
}

function ensureAdminNoticeModal() {
  // 서비스 준비중 안내 모달은 한 번만 생성해서 재사용한다.
  if (adminNoticeModalState) {
    return adminNoticeModalState;
  }

  const modalElement = document.createElement("div");
  modalElement.className = "admin-notice-modal";
  modalElement.id = "adminNoticeModal";
  modalElement.setAttribute("aria-hidden", "true");
  modalElement.innerHTML = `
    <div class="admin-notice-modal-backdrop" data-admin-notice-close="true"></div>
    <div
      class="admin-notice-modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adminNoticeModalTitle"
      aria-describedby="adminNoticeModalMessage"
    >
      <div class="admin-notice-modal-head">
        <h3 id="adminNoticeModalTitle">서비스 안내</h3>
      </div>
      <p class="admin-notice-modal-message" id="adminNoticeModalMessage">서비스 준비중입니다.</p>
      <div class="admin-notice-modal-actions">
        <button type="button" class="primary-link" data-admin-notice-close="true">확인</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);

  const titleElement = modalElement.querySelector("#adminNoticeModalTitle");
  const messageElement = modalElement.querySelector("#adminNoticeModalMessage");
  const confirmButton = modalElement.querySelector(".admin-notice-modal-actions .primary-link");

  adminNoticeModalState = {
    modalElement,
    titleElement,
    messageElement,
    confirmButton,
    triggerElement: null,
  };

  modalElement.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-admin-notice-close='true']");

    if (!closeTarget) {
      return;
    }

    closeAdminNoticeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!adminNoticeModalState?.modalElement.classList.contains("is-open")) {
      return;
    }

    closeAdminNoticeModal();
  });

  return adminNoticeModalState;
}

function openAdminNoticeModal(options = {}) {
  // 공통 안내 모달은 title/message만 바꿔서 여러 곳에서 사용한다.
  const title = String(options.title || "서비스 안내").trim();
  const message = String(options.message || "서비스 준비중입니다.").trim();
  const modalState = ensureAdminNoticeModal();

  if (!modalState || !modalState.modalElement) {
    window.alert(message);
    return;
  }

  modalState.titleElement.textContent = title;
  modalState.messageElement.textContent = message;
  modalState.triggerElement = options.triggerElement || document.activeElement;
  modalState.modalElement.classList.add("is-open");
  modalState.modalElement.setAttribute("aria-hidden", "false");
  document.body.classList.add("admin-modal-open");
  modalState.confirmButton.focus();
}

function closeAdminNoticeModal() {
  if (!adminNoticeModalState) {
    return;
  }

  adminNoticeModalState.modalElement.classList.remove("is-open");
  adminNoticeModalState.modalElement.setAttribute("aria-hidden", "true");
  document.body.classList.remove("admin-modal-open");

  if (adminNoticeModalState.triggerElement instanceof HTMLElement) {
    adminNoticeModalState.triggerElement.focus();
  }

  adminNoticeModalState.triggerElement = null;
}

function showAdminNotice(options = {}) {
  // 다른 화면 스크립트에서 쉽게 호출할 수 있도록 한 번 더 감싼다.
  openAdminNoticeModal(options);
}

function findAdminActionTrigger(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest("[data-admin-action]");
}

function handleAdminAction(event) {
  const triggerElement = findAdminActionTrigger(event.target);

  if (!triggerElement) {
    return;
  }

  const actionName = String(triggerElement.dataset.adminAction || "").trim();

  if (!actionName) {
    return;
  }

  if (actionName === "coming-soon") {
    event.preventDefault();

    // data-admin-action 속성만 붙이면 같은 안내 모달을 재사용할 수 있다.
    const title = String(
      triggerElement.dataset.adminActionTitle
      || triggerElement.querySelector("strong")?.textContent
      || "서비스 안내"
    ).trim();

    const message = String(
      triggerElement.dataset.adminActionMessage || "서비스 준비중입니다."
    ).trim();

    showAdminNotice({
      title,
      message,
      triggerElement,
    });
  }
}

function bindAdminSidebarActions() {
  if (adminSidebarActionsBound) {
    return;
  }

  adminSidebarActionsBound = true;

  const clickHandler = (event) => {
    handleAdminAction(event);
  };

  const keydownHandler = (event) => {
    const triggerElement = findAdminActionTrigger(event.target);

    if (!triggerElement) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    handleAdminAction(event);
  };

  if (adminSidebar) {
    // include로 주입된 사이드바 내부 요소도 공통 액션 규칙으로 처리한다.
    adminSidebar.addEventListener("click", clickHandler, true);
    adminSidebar.addEventListener("keydown", keydownHandler, true);
  }

  document.addEventListener("click", clickHandler, true);
}

function exposeAdminUiHelpers() {
  // 필요하면 다른 JS에서 window.showAdminNotice({ title, message })로 호출한다.
  window.showAdminNotice = showAdminNotice;
  window.closeAdminNotice = closeAdminNoticeModal;
}

async function syncAdminAccountHeader() {
  const avatarElement = document.getElementById("adminAccountAvatar");
  const nameElement = document.getElementById("adminAccountUserName");
  const roleElement = document.getElementById("adminAccountRole");

  if (!avatarElement && !nameElement && !roleElement) {
    return;
  }

  try {
    const response = await fetch("/api/admin/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) {
      return;
    }

    const result = await response.json();
    const admin = result.admin || {};
    const userName = String(admin.userName || admin.userId || "관리자").trim();
    const displayName = userName ? `${userName}` : "관리자";
    const roleLabel = `${result.admin.roleCode}`;

    if (avatarElement) {
      avatarElement.textContent = userName ? userName.charAt(0).toUpperCase() : "A";
    }

    if (nameElement) {
      nameElement.textContent = displayName;
    }

    if (roleElement) {
      roleElement.textContent = roleLabel;
    }
  } catch (error) {
    console.error("[admin-layout] admin session sync failed", error);
  }
}

function bindAdminLogoutButton() {
  const logoutButton = document.getElementById("adminLogoutBtn");

  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (error) {
      console.error("[admin-layout] logout failed", error);
    }

    window.location.href = "/admin/login";
  });
}

async function initializeAdminLayout() {
  try {
    await Promise.all([
      injectFragment(adminSidebar, "/includes/admin-sidebar.html"),
      injectFragment(adminHeader, "/includes/admin-header.html"),
      injectFragment(adminFooter, "/includes/admin-footer.html"),
    ]);

    applyAdminPageMetadata();
    bindAdminSidebarActions();
    exposeAdminUiHelpers();
    await syncAdminAccountHeader();
    bindAdminLogoutButton();
    document.dispatchEvent(new CustomEvent("admin-layout:ready"));
  } catch (error) {
    console.error("[admin-layout] include load failed", error);
  }
}

initializeAdminLayout();
