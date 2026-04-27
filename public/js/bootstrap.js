// public/js/bootstrap.js

// 브라우저는 <div include="..."> 같은 문법을 기본적으로 처리하지 않는다.
// 그래서 페이지 진입 시 include 속성을 찾아 HTML partial을 주입하는
// 아주 얇은 부트스트랩 스크립트가 필요하다.

async function loadHtmlPartials(root = document) {
  // include 또는 이전 호환용 data-include 속성이 있는 노드를 모두 찾는다.
  const includeNodes = Array.from(root.querySelectorAll("[include], [data-include]"));

  await Promise.all(includeNodes.map(async (node) => {
    const url = node.getAttribute("include") || node.getAttribute("data-include");
    if (!url) return;

    try {
      // partial은 항상 최신 파일을 읽어오도록 no-store로 요청한다.
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`${url} load failed: ${res.status}`);
      }

      // 응답 HTML을 대상 노드 안에 삽입하고, 중복 로딩 방지를 위해 속성을 제거한다.
      node.innerHTML = await res.text();
      node.removeAttribute("include");
      node.removeAttribute("data-include");
    } catch (err) {
      console.error("partial 로드 실패:", url, err);
    }
  }));
}

function loadClientScript() {
  // partial이 먼저 DOM에 들어와야 client.js의 getElementById/querySelector가 정상 동작한다.
  const script = document.createElement("script");
  script.src = "/js/client.js";
  script.defer = true;
  document.body.appendChild(script);
}

(async function bootstrapIndexPage() {
  // 1) HTML partial 주입
  await loadHtmlPartials(document);

  // 2) partial이 준비된 뒤 메인 클라이언트 스크립트 실행
  loadClientScript();
})();
