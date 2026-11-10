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
    const { frequency, disabled, bounds, format, onChange, onCommit, onError } = options;
    const prefix = options.prefix || "", wholeDigits = options.wholeDigits || 3;
    const query = key => container.querySelector(`[data-${prefix}${key}]`);
    const group = query("frequency-digits"), edit = query("frequency-edit");
    let editing = false, before = "";
    const digitsOf = value => value.toFixed(5).padStart(wholeDigits + 6, "0").replace(".", "").split("");
    const valid = () => frequency.value.trim() && Number.isFinite(Number(frequency.value)) &&
      Number(frequency.value) >= bounds().min && Number(frequency.value) <= bounds().max;
    function setEditing(value) {
      editing = value;
      if (!value) {
        controls.forEach(({ digit }) => digit.blur?.());
        frequency.blur?.();
      }
      query("frequency-entry").hidden = true;
      group.hidden = false;
      edit.textContent = value ? "완료" : "직접 입력";
      edit.setAttribute("aria-expanded", String(value));
      onChange();
    }
    function complete() {
      if (disabled()) return false;
      if (!valid()) {
        onError(`${bounds().min}–${bounds().max} MHz 범위를 확인하세요.`);
        controls[0].digit.focus?.();
        return false;
      }
      frequency.value = format(Math.round(Number(frequency.value) * 1e6));
      onError("");
      setEditing(false);
      return onCommit();
    }
    const controls = steps(wholeDigits).map((step, index) => {
      const up = query(`freq-up="${step}"`), down = query(`freq-down="${step}"`), digit = query(`freq-digit="${index}"`);
      const adjust = direction => {
        if (disabled() || !valid()) return;
        const hz = Math.round(Number(frequency.value) * 1e6) + direction * step;
        if (hz < bounds().min * 1e6 || hz > bounds().max * 1e6) return;
        frequency.value = format(hz);
        onChange();
        if (!editing) return onCommit();
      };
      up.addEventListener("click", () => adjust(1));
      down.addEventListener("click", () => adjust(-1));
      digit.setAttribute("inputmode", "numeric");
      digit.setAttribute("enterkeyhint", "done");
      digit.setAttribute("role", "textbox");
      digit.setAttribute("aria-label", `${index + 1}번째 주파수 숫자`);
      digit.setAttribute("aria-hidden", "false");
      digit.addEventListener("focus", () => {
        if (!editing || disabled() || !root.getSelection || !document.createRange) return;
        const range = document.createRange(); range.selectNodeContents(digit);
        const selection = root.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      });
      digit.addEventListener("input", (event = {}) => {
        if (event.isComposing) return;
        if (!editing || disabled()) { render(); return; }
        const typed = String(digit.textContent).replace(/\D/g, "").slice(-1);
        if (!typed) { render(); return; }
        const digits = digitsOf(Number(frequency.value));
        digits[index] = typed;
        frequency.value = format(Math.round(Number(`${digits.slice(0, wholeDigits).join("")}.${digits.slice(wholeDigits).join("")}`) * 1e6));
        onChange();
        if (index === controls.length - 1) return complete();
        controls[index + 1].digit.focus?.();
      });
      digit.addEventListener("beforeinput", event => {
        if (editing && !event.isComposing && ["insertParagraph", "insertLineBreak"].includes(event.inputType)) {
          event.preventDefault(); return complete();
        }
      });
      digit.addEventListener("keydown", event => {
        if (!editing || disabled() || event.isComposing) return;
        if (event.key === "Enter" || event.keyCode === 13 || (event.key === "Tab" && !event.shiftKey && index === controls.length - 1)) {
          event.preventDefault(); return complete();
        }
        if (event.key === "Escape") { event.preventDefault(); cancel(); }
      });
      return { step, up, down, digit };
    });
    function render() {
      const value = Number(frequency.value), hz = Math.round(value * 1e6);
      group.dataset.wide = String(wholeDigits > 3 && (editing || value >= 1000));
      const digits = frequency.value.trim() && Number.isFinite(value) && value >= 0 && value < 10 ** wholeDigits
        ? digitsOf(value) : Array(controls.length).fill("—");
      controls.forEach(({ step, up, down, digit }, index) => {
        digit.textContent = digits[index];
        digit.setAttribute("contenteditable", String(editing && !disabled()));
        digit.setAttribute("tabindex", editing && !disabled() ? "0" : "-1");
        up.disabled = disabled() || !valid() || hz + step > bounds().max * 1e6;
        down.disabled = disabled() || !valid() || hz - step < bounds().min * 1e6;
      });
      group.setAttribute("aria-label", valid() ? `수신 주파수 ${format(hz)} MHz` : "주파수 직접 입력 필요");
      edit.disabled = disabled();
    }
    function cancel() {
      if (!disabled()) frequency.value = before;
      options.onCancel?.();
      setEditing(false);
    }
    edit.addEventListener("click", () => {
      if (disabled()) return;
      if (editing) return complete();
      before = frequency.value;
      setEditing(true);
      controls[0].digit.focus?.();
    });
    frequency.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); if (editing) return complete(); }
    });
    return { render, setEditing, cancel, editing: () => editing };
  }
  root.BearSdrFrequency = { matchesAnimalFrequency, matchingAnimalCodes, markup, mount };
})(window);
