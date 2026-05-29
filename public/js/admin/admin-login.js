const form = document.getElementById("adminLoginForm");
const notice = document.getElementById("notice");
const togglePwd = document.getElementById("togglePwd");
const passwordInput = document.getElementById("adminPassword");

togglePwd.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwd.textContent = isPassword ? "숨김" : "보기";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const adminId = form.adminId.value.trim();
  const password = form.adminPassword.value.trim();

  if (!adminId || !password) {
    notice.textContent = "관리자 아이디와 비밀번호를 입력해 주세요.";
    notice.classList.add("show");
    return;
  }

  notice.classList.remove("show");
  alert("관리자 로그인 UI 확인용입니다. 실제 인증 API를 연결해 주세요.");
});