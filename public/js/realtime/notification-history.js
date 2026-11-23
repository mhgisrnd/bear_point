(function (root) {
  'use strict';
  let started = false, mounted = false;
  function mount(message) {
    const button = document.getElementById('btn-notification-history');
    const panel = document.getElementById('notification-history');
    if (!button || !panel || mounted) return;
    mounted = true;
    button.hidden = false;
    document.getElementById('notification-status').textContent = message;
    document.getElementById('notification-read').disabled = true;
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) button.dispatchEvent(new Event('notification-opened'));
    });
    document.getElementById('notification-close').addEventListener('click', () => {
      panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus();
    });
  }
  function setPendingMessage(message) {
    if (!started && mounted) document.getElementById('notification-status').textContent = message;
  }
  function start({ apiBase, plugin }) {
    if (started) return;
    mount('알림 이력을 연결하고 있습니다.');
    const button = document.getElementById('btn-notification-history');
    const panel = document.getElementById('notification-history');
    if (!button || !panel || !plugin?.getCredentials) return;
    started = true;
    const badge = document.getElementById('notification-unread');
    const status = document.getElementById('notification-status');
    const list = document.getElementById('notification-items');
    const mark = document.getElementById('notification-read');
    const more = document.getElementById('notification-more');
    const filter = document.getElementById('notification-filter');
    let latest = 0, oldest = 0, controller = null, retry = null, generation = 0, refreshId = 0;
    button.hidden = false;
    async function headers() {
      const data = await plugin.getCredentials();
      return { Authorization: 'Bearer ' + data.credential };
    }
    async function refresh(before = 0) {
      const requestId = ++refreshId;
      const params = new URLSearchParams({ direction: filter.value });
      if (before) params.set('before', String(before));
      const response = await fetch(apiBase + '/notifications?' + params, { headers: await headers(), cache: 'no-store' });
      if (!response.ok) throw new Error('이력을 불러오지 못했습니다.');
      const data = await response.json();
      if (requestId !== refreshId) return;
      badge.hidden = !data.unread;
      badge.textContent = data.unread > 99 ? '99+' : String(data.unread);
      button.setAttribute('aria-label', data.unread ? `알림 이력, 확인하지 않은 알림 ${data.unread}개` : '알림 이력');
      latest = Number(data.read_through) || 0;
      if (data.items.length) oldest = Number(data.items[data.items.length - 1].id);
      mark.disabled = filter.value === 'sent' || !data.unread || !latest;
      if (!before) list.replaceChildren();
      for (const item of data.items) {
        const sent = item.direction === 'sent';
        const row = document.createElement('div'); row.className = 'notification-item'; row.dataset.unread = String(!sent && !item.read_at);
        const heading = document.createElement('div'); heading.className = 'notification-item-heading';
        const direction = document.createElement('span'); direction.className = 'notification-direction'; direction.dataset.direction = sent ? 'sent' : 'received'; direction.textContent = sent ? '발송' : '수신';
        const title = document.createElement('strong'); title.textContent = item.title;
        heading.append(direction, title);
        const body = document.createElement('p'); body.textContent = item.body;
        const time = document.createElement('time'); time.textContent = new Date(item.accepted_at).toLocaleString('ko-KR') + (sent ? ' · 공유 등록' : ' · 발송 접수');
        row.append(heading, body, time); list.append(row);
      }
      more.hidden = data.items.length < 100;
      status.textContent = list.children.length ? '' : '표시할 알림 이력이 없습니다.';
    }
    function update() { return refresh().catch(() => { status.textContent = '알림 이력을 불러오지 못했습니다. 연결을 확인해주세요.'; }); }
    button.addEventListener('notification-opened', () => { void update(); });
    filter.addEventListener('change', () => { list.replaceChildren(); more.hidden = true; latest = 0; mark.disabled = true; status.textContent = '알림 이력을 불러오고 있습니다.'; void update(); });
    more.addEventListener('click', async () => { more.disabled = true; try { await refresh(oldest); } catch (_) { status.textContent = '이전 알림을 불러오지 못했습니다.'; } finally { more.disabled = false; } });
    mark.addEventListener('click', async () => {
      const through = latest; if (!through) return;
      mark.disabled = true;
      try {
        const response = await fetch(apiBase + '/notifications/read', { method: 'POST', headers: { ...await headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ through }) });
        if (!response.ok) throw new Error();
        await refresh();
      } catch (_) { status.textContent = '확인 상태를 저장하지 못했습니다.'; mark.disabled = false; }
    });
    function disconnect() { generation++; controller?.abort(); controller = null; clearTimeout(retry); retry = null; }
    async function connect() {
      if (document.hidden || controller) return;
      const current = ++generation; controller = new AbortController();
      try {
        const response = await fetch(apiBase + '/notifications/stream', { headers: { ...await headers(), Accept: 'text/event-stream' }, cache: 'no-store', signal: controller.signal });
        if (!response.ok || !response.body) throw new Error('stream unavailable');
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        while (current === generation) {
          const part = await reader.read(); if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true }).replace(/\r\n/g, '\n');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (/^event: ?(?:ready|changed)$/m.test(event)) void update();
          }
          if (buffer.length > 65536) throw new Error('invalid stream');
        }
      } catch (_) { /* Reconnect after network interruptions. */ }
      if (current === generation) { controller = null; retry = setTimeout(connect, 5000); }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) disconnect(); else { void update(); void connect(); } });
    root.addEventListener('online', () => { disconnect(); void update(); void connect(); });
    void update(); void connect();
  }
  root.BearNotificationHistory = { mount, start, setPendingMessage };
})(window);
