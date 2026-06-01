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

async function initializeAdminLayout() {
  try {
    await Promise.all([
      injectFragment(adminSidebar, "/includes/admin-sidebar.html"),
      injectFragment(adminHeader, "/includes/admin-header.html"),
      injectFragment(adminFooter, "/includes/admin-footer.html"),
    ]);

    applyAdminPageMetadata();
    document.dispatchEvent(new CustomEvent("admin-layout:ready"));
  } catch (error) {
    console.error("[admin-layout] include load failed", error);
  }
}

initializeAdminLayout();