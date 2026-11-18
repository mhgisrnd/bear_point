(function (root) {
  "use strict";
  function matchesAnimalFrequency(registeredHz, tunedHz) {
    return Number.isSafeInteger(registeredHz) && Number.isSafeInteger(tunedHz) && Math.abs(registeredHz - tunedHz) <= 900;
  }
  function matchingAnimalCodes(items, tunedHz) {
    return [...new Set(items.filter(item =>
      item.frequencies.some(f => matchesAnimalFrequency(f.hz, tunedHz))).map(item => item.code))];
  }
  function steps(wholeDigits) {
    return Array.from({ length: wholeDigits + 5 }, (_, index) => 10 ** (wholeDigits + 5 - index));
  }
  function markup(prefix = "", wholeDigits = 3) {
    return steps(wholeDigits).map((step, index) => `${index === wholeDigits ? '<span class="sdr-frequency-dot" aria-hidden="true">.</span>' : ''}<div class="sdr-digit"><button type="button" data-${prefix}freq-up="${step}" aria-label="${step / 1e6} MHz 올리기">▲</button><strong data-${prefix}freq-digit="${index}" aria-hidden="true">—</strong><button type="button" data-${prefix}freq-down="${step}" aria-label="${step / 1e6} MHz 내리기">▼</button></div>`).join("");
  }
  function mount(container, options) {
    const { frequency, disabled, bounds, format, onChange, onCommit } = options;
    const prefix = options.prefix || "", wholeDigits = options.wholeDigits || 3;
    const query = key => container.querySelector(`[data-${prefix}${key}]`);
    const group = query("frequency-digits"), edit = query("frequency-edit");
    const entry = query("frequency-entry"), draft = query("frequency-draft"), error = query("frequency-error");
    let editing = false;
    const digitsOf = value => value.toFixed(5).padStart(wholeDigits + 6, "0").replace(".", "").split("");
    function previewHz() {
      const text = (editing ? draft.value : frequency.value).trim();
      if (!text || (editing && !/^(?:\d+(?:[.,]\d{0,5})?|[.,]\d{1,5})$/.test(text))) return null;
      const mhz = Number(text.replace(",", "."));
      const { min, max } = bounds();
      return mhz >= min && mhz <= max ? Math.round(mhz * 1e6) : null;
    }
    function showError(text = "") {
      error.textContent = text;
      error.hidden = !text;
      draft.setAttribute("aria-invalid", String(!!text));
    }
    function setEditing(value) {
      editing = value;
      if (value) draft.value = frequency.value;
      else draft.blur?.();
      showError();
      entry.hidden = !value;
      group.hidden = false;
      edit.textContent = value ? "완료" : "직접 입력";
      edit.setAttribute("aria-expanded", String(value));
      onChange();
    }
    function complete() {
      if (disabled()) return false;
      const hz = previewHz();
      if (hz === null) {
        const { min, max } = bounds();
        showError(`${min}–${max} MHz 범위에서 소수점 아래 최대 5자리까지 입력하세요.`);
        draft.focus?.();
        return false;
      }
      frequency.value = format(hz);
      setEditing(false);
      return onCommit();
    }
    const controls = steps(wholeDigits).map((step, index) => {
      const up = query(`freq-up="${step}"`), down = query(`freq-down="${step}"`), digit = query(`freq-digit="${index}"`);
      const adjust = direction => {
        const currentHz = previewHz();
        if (disabled() || currentHz === null) return;
        const hz = currentHz + direction * step;
        if (hz < bounds().min * 1e6 || hz > bounds().max * 1e6) return;
        if (editing) {
          draft.value = format(hz);
          showError();
        } else {
          frequency.value = format(hz);
        }
        onChange();
        if (!editing) return onCommit();
      };
      up.addEventListener("click", () => adjust(1));
      down.addEventListener("click", () => adjust(-1));
      return { step, up, down, digit };
    });
    function render() {
      const hz = previewHz(), locked = disabled();
      const { min, max } = bounds();
      group.dataset.wide = String(wholeDigits > 3 && (editing || hz >= 1e9));
      const digits = hz === null ? Array(controls.length).fill("—") : digitsOf(hz / 1e6);
      controls.forEach(({ step, up, down, digit }, index) => {
        digit.textContent = digits[index];
        up.disabled = locked || hz === null || hz + step > max * 1e6;
        down.disabled = locked || hz === null || hz - step < min * 1e6;
      });
      group.setAttribute("aria-label", hz === null ? "주파수 직접 입력 필요" : `수신 주파수 ${format(hz)} MHz`);
      draft.disabled = edit.disabled = locked;
    }
    function cancel() {
      options.onCancel?.();
      setEditing(false);
    }
    edit.addEventListener("click", () => {
      if (disabled()) return;
      if (editing) return complete();
      setEditing(true);
      draft.focus?.();
      draft.select?.();
    });
    draft.addEventListener("input", () => {
      if (!editing) return;
      showError();
      onChange();
    });
    draft.addEventListener("beforeinput", event => {
      if (editing && !event.isComposing && ["insertParagraph", "insertLineBreak"].includes(event.inputType)) {
        event.preventDefault(); return complete();
      }
    });
    draft.addEventListener("keydown", event => {
      if (!editing || disabled() || event.isComposing) return;
      if (event.key === "Enter" || event.keyCode === 13 || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault(); return complete();
      }
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
    });
    return { render, setEditing, cancel, previewHz, editing: () => editing };
  }
  root.BearSdrFrequency = { matchesAnimalFrequency, matchingAnimalCodes, markup, mount };
})(window);
