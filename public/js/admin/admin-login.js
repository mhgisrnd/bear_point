const form = document.getElementById("adminLoginForm");
const notice = document.getElementById("notice");
const capsLockNotice = document.getElementById("capsLockNotice");
const togglePwd = document.getElementById("togglePwd");
const passwordInput = document.getElementById("adminPassword");
const submitButton = form.querySelector(".btn-login");

// Caps Lock 상태에 따라 비밀번호 안내 문구를 갱신한다.
function updateCapsLockNotice(event) {
  if (!capsLockNotice) {
    return;
  }

  const isCapsLockOn = Boolean(event?.getModifierState && event.getModifierState("CapsLock"));

  if (isCapsLockOn && document.activeElement === passwordInput) {
    capsLockNotice.textContent = "Caps Lock가 켜져 있습니다. 비밀번호 입력을 확인해 주세요.";
    capsLockNotice.classList.add("show");
    return;
  }

  capsLockNotice.textContent = "";
  capsLockNotice.classList.remove("show");
}

togglePwd.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwd.textContent = isPassword ? "숨김" : "보기";
});

passwordInput.addEventListener("keydown", updateCapsLockNotice);
passwordInput.addEventListener("keyup", updateCapsLockNotice);
passwordInput.addEventListener("focus", updateCapsLockNotice);
passwordInput.addEventListener("blur", () => {
  if (!capsLockNotice) {
    return;
  }

  capsLockNotice.textContent = "";
  capsLockNotice.classList.remove("show");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const adminId = form.adminId.value.trim();
  const password = form.adminPassword.value.trim();

  if (!adminId || !password) {
    notice.textContent = "관리자 아이디와 비밀번호를 입력해 주세요.";
    notice.classList.add("show");
    return;
  }

  notice.classList.remove("show");
  if (capsLockNotice) {
    capsLockNotice.textContent = "";
    capsLockNotice.classList.remove("show");
  }
  submitButton.disabled = true;
  submitButton.textContent = "로그인 중...";

  try {
    const response = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        adminId,
        adminPassword: password,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      notice.textContent = result.message || "로그인에 실패했습니다.";
      notice.classList.add("show");
      return;
    }

    window.location.href = "/admin/dashboard";
  } catch (error) {
    console.error("[admin-login] login request failed", error);
    notice.textContent = "로그인 중 오류가 발생했습니다.";
    notice.classList.add("show");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "관리자 로그인";
  }
});