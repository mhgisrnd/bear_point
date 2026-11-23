(function (root) {
  "use strict";

  function markup(prefix, label) {
    return `<div class="sdr-log-list" data-${prefix}-log-scroll hidden>
      <div class="sdr-log-heading">
        <label><input type="checkbox" data-${prefix}-select-all aria-label="모든 기록 선택"></label>
        <span>일시</span><span>재생</span>
      </div>
      <ul class="sdr-log-rows" data-${prefix}-record aria-label="${label}" hidden></ul>
    </div>`;
  }

  function mount({ scroll, list, selectAll, status, player, save, share, remove, run, describe, loadAudio, saveLogs, shareLogs, deleteLog }) {
    const selected = new Set();
    let rows = [], key, options = {}, previewRequest = 0;

    function resetPreview() {
      ++previewRequest;
      if (!player.hasAttribute?.("src")) return;
      player.pause();
      player.removeAttribute("src");
      player.load();
      player.hidden = true;
    }

    function updateControls() {
      const unchecked = !selected.size;
      selectAll.disabled = options.locked || !rows.length;
      selectAll.checked = !unchecked && selected.size === rows.length;
      selectAll.indeterminate = !unchecked && !selectAll.checked;
      save.disabled = options.locked || unchecked || !options.canSave;
      share.disabled = options.locked || unchecked || !options.canShare;
      remove.disabled = options.locked || unchecked || !options.canDelete;
      for (const { record, checkbox, preview } of rows) {
        checkbox.disabled = options.locked;
        preview.disabled = options.locked || !options.canPreview || !record.hasAudio ||
          typeof root.Capacitor?.convertFileSrc !== "function";
      }
    }

    function createRow(record) {
      const text = describe(record);
      const row = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const description = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const preview = document.createElement("button");
      row.className = "sdr-log-row";
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(record.id);
      title.textContent = text.title;
      detail.textContent = text.detail;
      description.append(title, detail);
      label.append(checkbox, description);
      preview.type = "button";
      preview.className = "sdr-log-preview";
      preview.title = "미리 듣기";
      preview.setAttribute("aria-label", `${text.title} 기록 미리 듣기`);
      preview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>
      </svg>`;
      row.append(label, preview);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(record.id);
        else selected.delete(record.id);
        updateControls();
      });
      preview.addEventListener("click", () => run(async () => {
        resetPreview();
        const request = previewRequest;
        const result = await loadAudio(record.id);
        if (request !== previewRequest) return;
        row.append(player);
        player.src = root.Capacitor.convertFileSrc(result.uri);
        player.hidden = false;
        // Playback controls remain available if the WebView requires a new gesture.
        void player.play().catch(() => {});
      }));
      return { record, row, checkbox, preview };
    }

    const getSelection = () => rows.filter(({ record }) => selected.has(record.id)).map(({ record }) => record.id);
    const exportOptions = ids => ids.length === 1 ? { id: ids[0] } : { ids };
    selectAll.addEventListener("change", () => {
      const checked = selectAll.checked;
      selected.clear();
      for (const { record, checkbox } of rows) {
        checkbox.checked = checked;
        if (checked) selected.add(record.id);
      }
      updateControls();
    });
    save.addEventListener("click", () => {
      const ids = getSelection();
      if (ids.length) return run(() => saveLogs(exportOptions(ids)));
    });
    share.addEventListener("click", () => {
      const ids = getSelection();
      if (ids.length) return run(() => shareLogs(exportOptions(ids)));
    });
    remove.addEventListener("click", () => {
      const ids = getSelection();
      if (!ids.length || !root.confirm(`선택한 수신 진단 기록 ${ids.length}개를 삭제할까요? 삭제한 기록은 복구할 수 없습니다.`)) return;
      resetPreview();
      return run(async () => {
        let deleted = 0;
        for (const id of ids) {
          try { await deleteLog(id); }
          catch (error) {
            if (!deleted) throw error;
            throw new Error(`${ids.length}개 중 ${deleted}개를 삭제했습니다. ${error.message || error}`);
          }
          selected.delete(id);
          deleted++;
        }
      });
    });
    updateControls();

    return {
      resetPreview,
      render(records, nextOptions) {
        options = nextOptions;
        const recordKey = JSON.stringify(records);
        if (recordKey !== key) {
          resetPreview();
          const ids = new Set(records.map(record => record.id));
          for (const id of selected) if (!ids.has(id)) selected.delete(id);
          rows = records.map(createRow);
          list.replaceChildren(...rows.map(({ row }) => row));
          key = recordKey;
        }
        scroll.hidden = list.hidden = !records.length;
        status.textContent = options.error || (records.length ? `저장된 기록 ${records.length}개` : "저장된 기록 없음");
        updateControls();
      }
    };
  }
  root.BearSdrLogs = { markup, mount };
})(window);
