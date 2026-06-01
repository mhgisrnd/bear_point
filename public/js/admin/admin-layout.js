const adminSidebar = document.getElementById("adminSidebar");
const adminHeader = document.getElementById("adminHeader");
const adminFooter = document.getElementById("adminFooter");

async function injectFragment(targetElement, url) {
  if (!targetElement) {
    return;
  }

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`${url} 로드에 실패했습니다.`);
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

// 세션 정보를 읽어 상단 계정 표시를 실제 로그인 사용자로 맞춘다.
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
    const displayName = userName ? `${userName} 관리자` : "관리자";
    const roleLabel = "반달가슴곰 추적위치 관리";

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

// 로그아웃 버튼을 서버 세션 종료와 연결한다.
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
    await syncAdminAccountHeader();
    bindAdminLogoutButton();
    document.dispatchEvent(new CustomEvent("admin-layout:ready"));
  } catch (error) {
    console.error("[admin-layout] include load failed", error);
  }
}

initializeAdminLayout();