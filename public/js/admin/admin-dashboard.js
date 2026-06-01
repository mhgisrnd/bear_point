function formatNow() {
  const now = new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);
}

function initializeDashboardHeader() {
  const dashboardTimestamp = document.getElementById("dashboardTimestamp");
  const refreshDashboardBtn = document.getElementById("refreshDashboardBtn");

  if (!dashboardTimestamp || !refreshDashboardBtn) {
    return;
  }

  const refreshTimestamp = () => {
    dashboardTimestamp.textContent = `${formatNow()} 기준`;
  };

  refreshDashboardBtn.addEventListener("click", () => {
    refreshTimestamp();
  });

  refreshTimestamp();
}

document.addEventListener("admin-layout:ready", initializeDashboardHeader);