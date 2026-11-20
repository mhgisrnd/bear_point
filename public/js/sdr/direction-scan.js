(function (root) {
  "use strict";
  const COARSE = { arc: 360, step: 10, minimumMs: 25000, minVisited: 35 };
  const FINE = { arc: 90, step: 3, minimumMs: 28000, minVisited: 22 };
  const FINE_HALF_ARC = FINE.arc / 2;
  const COARSE_MANUAL_MIN_DEGREES = 335;
  const COARSE_MANUAL_MIN_SECTORS = 32;
  const AR_TRACKING_MESSAGES = {
    INSUFFICIENT_LIGHT: "조명이 밝은 쪽을 비춰 주세요.",
    INSUFFICIENT_FEATURES: "무늬나 모서리가 잘 보이는 곳을 비춰 주세요.",
    EXCESSIVE_MOTION: "폰을 조금 더 천천히 움직여 주세요.",
    CAMERA_UNAVAILABLE: "다른 앱이 카메라를 쓰고 있는지 확인하세요.",
    POINT_FORWARD: "폰을 세우고 후면 카메라가 전방을 보도록 해 주세요."
  };
  const norm = degrees => ((degrees % 360) + 360) % 360;
  const delta = (to, from) => norm(to - from + 180) - 180;
  const sector = (angle, step) => Math.round(norm(angle) / step) % (360 / step);
  const displayAngle = angle => `${norm(Math.round(angle))}°`;
  const coarseGuide = "태블릿을 수평으로 들고 화면 위쪽과 안테나를 맞추세요. 360° 탐색은 같은 자리에서 40~60초에 걸쳐 돌고, 대략적인 방향을 알면 그쪽을 보고 90° 직접 탐색을 누르세요.";

  function bearing(event, screenAngle) {
    if (Number.isFinite(event.webkitCompassHeading) && event.webkitCompassHeading >= 0) return norm(event.webkitCompassHeading);
    if (event.type !== "deviceorientationabsolute" && !event.absolute) return null;
    return Number.isFinite(event.alpha) ? norm(screenAngle - event.alpha) : null;
  }

  function cameraBearing(event) {
    if (event.type !== "deviceorientationabsolute" && !event.absolute) return null;
    if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return null;
    const [alpha, beta, gamma] = [event.alpha, event.beta, event.gamma].map(angle => angle * Math.PI / 180);
    // Project the rear camera's forward axis through DeviceOrientation's Z-X-Y rotation.
    const east = -Math.sin(gamma) * Math.cos(alpha) - Math.sin(beta) * Math.cos(gamma) * Math.sin(alpha);
    const north = -Math.sin(gamma) * Math.sin(alpha) + Math.sin(beta) * Math.cos(gamma) * Math.cos(alpha);
    return Math.hypot(east, north) >= 0.5 ? norm(Math.atan2(east, north) * 180 / Math.PI) : null;
  }

  function headingAt(history, time) {
    for (let i = history.length - 2; i >= 0; i--) {
      const before = history[i], after = history[i + 1];
      if (before.time > time || after.time < time || after.time - before.time > 500) continue;
      const fraction = (time - before.time) / (after.time - before.time || 1);
      return norm(before.angle + delta(after.angle, before.angle) * fraction);
    }
    const latest = history.at(-1);
    return latest && time >= latest.time && time - latest.time <= 250 ? latest.angle : null;
  }

  function summarize(pulses, step = COARSE.step, targetTone = null) {
    // Keep the dominant audio pitch together so a second tone cannot win by volume alone.
    const groups = new Map();
    for (const pulse of pulses) {
      const center = Math.round(pulse.tone / 100) * 100;
      for (const pitch of [center - 100, center, center + 100]) {
        if (Math.abs(pitch - pulse.tone) > 120) continue;
        if (!groups.has(pitch)) groups.set(pitch, []);
        groups.get(pitch).push(pulse);
      }
    }
    const matching = targetTone === null ? [...groups.values()].sort((a, b) => b.length - a.length)[0] || []
      : pulses.filter(pulse => Math.abs(pulse.tone - targetTone) <= 120);
    const tones = matching.map(pulse => pulse.tone).sort((a, b) => a - b);
    const bins = Array.from({ length: 360 / step }, () => []);
    for (const pulse of matching) bins[sector(pulse.angle, step)].push(pulse.db);
    const levels = bins.map(values => {
      if (!values.length) return null;
      values.sort((a, b) => a - b);
      return (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2;
    });
    const ranked = levels.map((db, index) => ({ db, angle: index * step }))
      .filter(item => item.db !== null).sort((a, b) => b.db - a.db);
    const supported = ranked.filter(item => bins[sector(item.angle, step)].length >= 2 || ranked.some(neighbor =>
      neighbor !== item && Math.abs(delta(neighbor.angle, item.angle)) <= 2 * step && Math.abs(neighbor.db - item.db) <= 14));
    const peak = ranked.length >= 3 ? supported[0] ?? null : null;
    const alternative = peak && supported.find(item => Math.abs(delta(item.angle, peak.angle)) >= 40 && item.db >= peak.db - 3);
    const isolated = ranked[0] && !supported.includes(ranked[0]) ? ranked[0] : null;
    return { levels, step, peak, alternative, isolated, count: matching.length, measured: ranked.length, tone: tones[Math.floor(tones.length / 2)] };
  }

  function polarPoint(angle, radius) {
    const radians = angle * Math.PI / 180;
    return `${(66 + Math.sin(radians) * radius).toFixed(1)} ${(100 - Math.cos(radians) * radius).toFixed(1)}`;
  }

  function strengthScale(levels) {
    const measured = levels.filter(Number.isFinite);
    if (!measured.length) return null;
    const min = Math.min(...measured), max = Math.max(...measured);
    return { min, max, fraction: db => max === min ? 0.5 : (db - min) / (max - min) };
  }

  function mount(panel) {
    const node = key => panel.querySelector(`[data-direction-${key}]`);
    const start = node("start"), refine = node("refine"), direct = node("direct"), reset = node("reset");
    const finish = node("finish"), report = node("report");
    const progress = node("progress");
    const dial = root.BearHeadingDial;
    const vision = root.BearDirectionVision;
    const cameraButton = node("camera-button"), cameraVideo = node("camera-video");
    const ar = root.Capacitor?.Plugins?.BearArDirection;
    const arButton = node("ar-button"), arExit = node("ar-exit"), arStatus = node("ar-status"), arInput = node("ar-input");
    cameraButton.hidden = !(vision && root.navigator?.mediaDevices?.getUserMedia);
    node("ring").innerHTML = dial.markup();

    const history = [];
    let source = null, run = null, coarse = null, fine = null;
    let viewActive = false, listening = false, request = 0, timeout;
    let lastAbsoluteSample = -Infinity;
    let camera, fusion, cameraEnabled = false, cameraPending = false, cameraEpoch = 0, lastCompass = null;
    let arChecked = false, arPending = false, arActive = false, arTracking = false, arEpoch = 0, arListener;
    let arNorthOffset = null, arCompass = null, arLastHeadingAt = null, waitingForAr = null;
    const now = () => root.performance.now();
    const screenRotation = () => root.screen?.orientation?.angle ?? root.orientation ?? 0;
    const setMessage = text => { node("status").textContent = text; };
    const coverage = sample => Math.min(sample.plan.arc, Math.round(sample.plan === FINE ? Math.max(0, sample.turn) : Math.abs(sample.turn)));
    const full = sample => coverage(sample) >= (sample.plan === FINE ? 85 : 358) && sample.visited.size >= sample.plan.minVisited;
    const canFinishCoarse = (sample, time) => sample?.plan === COARSE && sample.start !== null &&
      time - sample.start >= COARSE.minimumMs && coverage(sample) >= COARSE_MANUAL_MIN_DEGREES &&
      sample.visited.size >= COARSE_MANUAL_MIN_SECTORS;
    const activePeak = () => fine?.summary.peak || (fine?.direct ? null : coarse?.summary.peak);

    function syncButtons() {
      start.disabled = refine.disabled = direct.disabled = !viewActive || (!source && !arActive) || !!run || cameraPending || arPending;
      start.hidden = direct.hidden = !!run;
      start.textContent = coarse ? "360° 다시 탐색" : "360° 탐색 시작";
      refine.hidden = !!run || !coarse?.summary.peak;
      reset.disabled = !run && !coarse && !fine;
      cameraButton.disabled = cameraPending || !!run;
      arButton.disabled = arPending || cameraPending || !!run;
      cameraButton.textContent = cameraEnabled ? "카메라 보정 끄기" : "카메라 보정 켜기";
      finish.hidden = !run && !waitingForAr;
      finish.disabled = !waitingForAr && (!run || (run.plan === COARSE && run.completedAt === null && !canFinishCoarse(run, now())));
      finish.textContent = waitingForAr ? "시작 대기 취소" : run?.completedAt != null ? "결과 보기" : run?.plan === COARSE ? "한 바퀴 완료" : "측정 중단";
    }

    function setHeading(angle) {
      node("rotate").setAttribute("transform", dial.rotation(-(angle ?? 0)));
      node("heading").textContent = angle == null ? "—°" : displayAngle(angle);
      node("caption").textContent = "안테나 방향";
      node("index").toggleAttribute("hidden", angle == null);
      const target = run ? null : activePeak();
      const guidance = node("target-guide");
      guidance.hidden = angle == null || !target;
      const overlay = node("ar-target");
      overlay.hidden = !arActive || guidance.hidden || !arTracking;
      if (guidance.hidden) return;
      const difference = delta(target.angle, angle);
      const remaining = Math.round(Math.abs(difference));
      guidance.textContent = remaining <= 3 ? `목표 ${displayAngle(target.angle)} · 방향이 맞았어요.`
        : `목표 ${displayAngle(target.angle)} · ${difference > 0 ? "오른쪽" : "왼쪽"}으로 ${remaining}°`;
      if (!overlay.hidden) {
        overlay.textContent = remaining <= 3 ? "↑ 목표 방향" : `${difference > 0 ? "→" : "←"} ${remaining}°`;
        overlay.style.setProperty("--direction-target-x", `${50 + Math.max(-33, Math.min(33, difference))}%`);
      }
    }

    function setStage(isFine, center = null, directSearch = false) {
      node("coarse-step").setAttribute("aria-current", isFine ? "false" : "step");
      node("fine-step").setAttribute("aria-current", isFine ? "step" : "false");
      const left = center - FINE_HALF_ARC, right = center + FINE_HALF_ARC;
      const path = isFine && center !== null ? `M${polarPoint(left, 100)} A100 100 0 0 1 ${polarPoint(right, 100)}` : "";
      node("sector").innerHTML = path ? `<path class="sdr-direction-range" d="${path}"/>` : "";
      progress.max = isFine ? FINE.arc : COARSE.arc;
      node("guide").textContent = !isFine ? (arActive ? "폰을 세워 발신기를 찾을 방향에 후면 카메라와 안테나를 함께 맞추세요." : coarseGuide) : center === null
        ? "안테나를 대략적인 방향에 맞춘 채 첫 나침반 값이 들어올 때까지 기다려 주세요."
        : `${directSearch ? "시작 방향" : "후보"} ${displayAngle(center)} 주변 ${displayAngle(left)} ↔ ${displayAngle(right)} 구간을 35~45초에 걸쳐 따라가세요.`;
    }

    function renderDial(summary, marker) {
      const scale = summary ? strengthScale(summary.levels) : null;
      node("scale").hidden = !scale;
      if (scale) node("scale").textContent = `이 측정의 범위 ${scale.min.toFixed(1)} ~ ${scale.max.toFixed(1)} dBFS · 차이 ${(scale.max - scale.min).toFixed(1)} dB`;
      node("chart").innerHTML = scale ? summary.levels.map((db, index) => {
        if (db === null) return "";
        const angle = index * summary.step;
        const radius = 114 + 38 * scale.fraction(db);
        const offsets = summary.step === COARSE.step ? [-2.5, 0, 2.5] : [0];
        return offsets.map(offset => `<path class="sdr-direction-ray" d="M${polarPoint(angle + offset, 106)} L${polarPoint(angle + offset, radius - Math.abs(offset) * 2)}"/>`).join("");
      }).join("") : "";
      node("marker").innerHTML = marker == null ? "" :
        `<path class="sdr-direction-peak" d="M66 -65 L61 -56 H71 Z" transform="${dial.rotation(marker)}"/>`;
    }

    function detachHeading() {
      request++;
      root.removeEventListener("deviceorientationabsolute", onHeading);
      root.removeEventListener("deviceorientation", onHeading);
      listening = false;
      history.length = 0;
      lastCompass = null;
      lastAbsoluteSample = -Infinity;
    }

    function attachHeading() {
      if (listening) return;
      root.addEventListener("deviceorientationabsolute", onHeading);
      root.addEventListener("deviceorientation", onHeading);
      listening = true;
    }

    function setArStatus(message) {
      arStatus.hidden = !message;
      if (arStatus.textContent !== message) arStatus.textContent = message;
    }

    function renderArInput() {
      arInput.hidden = !arActive;
      const message = source ? "수신 입력 준비됨" : "수신 입력 대기 · 3단계에서 USB 오디오 또는 CW 수신을 확인하세요.";
      if (arInput.textContent !== message) arInput.textContent = message;
    }

    function setArScene(active) {
      panel.closest?.(".sdr-dialog")?.toggleAttribute("data-direction-ar", active);
      panel.ownerDocument?.documentElement.classList.toggle("sdr-ar-preview", active);
      arExit.hidden = !active;
    }

    function stopAr(message = "", alreadyClosed = false) {
      arEpoch++;
      if (!alreadyClosed && (arActive || arPending)) void ar.stop().catch(() => {});
      arActive = arPending = arTracking = false;
      arNorthOffset = arCompass = arLastHeadingAt = null;
      waitingForAr = null;
      history.length = 0;
      setArScene(false);
      renderArInput();
      if (run) stop("AR 추적이 종료되어 측정을 중단했어요.");
      else renderSaved();
      setArStatus(message);
    }

    function onArPose(frame) {
      if (!arActive) return;
      if (frame.state === "stopped") { stopAr("AR 카메라가 종료됐어요.", true); return; }
      if (frame.state !== "tracking" || !Number.isFinite(frame.yaw) || arCompass === null) {
        arTracking = false;
        node("ar-target").hidden = true;
        const hint = frame.state === "tracking" && arCompass === null ? "폰을 세워 시작 방위를 잡아 주세요."
          : AR_TRACKING_MESSAGES[frame.reason] || "무늬가 있는 곳을 천천히 비춰 주세요.";
        setArStatus(`AR 추적 대기 · ${hint}`);
        if (run?.completedAt === null && arLastHeadingAt !== null && now() - arLastHeadingAt > 1000) {
          stop("AR 추적이 끊겨 측정을 중단했어요. 추적 상태를 확인하고 다시 시작하세요.");
        }
        syncButtons();
        return;
      }
      arNorthOffset ??= delta(arCompass, frame.yaw);
      arTracking = true;
      arLastHeadingAt = now();
      setArStatus("ARCore 추적 중 · 시작 방위는 전자 나침반 기준");
      recordHeading(norm(frame.yaw + arNorthOffset), arLastHeadingAt, screenRotation());
      if (waitingForAr) {
        const { plan, directSearch } = waitingForAr;
        waitingForAr = null;
        void begin(plan, directSearch);
      }
      syncButtons();
    }

    async function startAr() {
      if (!viewActive || run || arPending || arActive || cameraPending) return;
      if (cameraEnabled) stopCamera();
      arPending = true;
      const token = ++arEpoch;
      setArStatus("ARCore 카메라를 여는 중…");
      syncButtons();
      try {
        arListener ||= await ar.addListener("pose", onArPose);
        if (token !== arEpoch) return;
        const state = await ar.start();
        if (token !== arEpoch) { if (state.active) await ar.stop(); return; }
        if (state.active) {
          arActive = true;
          history.length = 0;
          attachHeading();
          // Renew the compass subscription so a stationary phone still supplies the initial heading.
          root.removeEventListener("deviceorientationabsolute", onHeading);
          root.addEventListener("deviceorientationabsolute", onHeading);
          lastAbsoluteSample = -Infinity;
          setArScene(true);
          renderArInput();
          renderSaved();
          setArStatus("폰을 세워 전방을 비춰 주세요.");
        } else if (state.installRequested) {
          setArStatus("Google Play Services for AR 설치가 끝나면 다시 ARCore 테스트를 눌러 주세요.");
        }
      } catch (error) {
        if (token === arEpoch) setArStatus(error.message || "ARCore 카메라를 열지 못했어요.");
      } finally {
        if (token === arEpoch) { arPending = false; syncButtons(); }
      }
    }

    function stopCamera(message = "") {
      cameraEpoch++;
      camera?.stop();
      cameraEnabled = cameraPending = false;
      fusion = null;
      cameraVideo.hidden = true;
      cameraMessage(message);
      syncButtons();
    }

    function cameraMessage(message) {
      const status = node("camera-status");
      status.hidden = !message;
      if (status.textContent !== message) status.textContent = message;
    }

    function onVisualFrame(rotation, time) {
      if (!cameraEnabled || !lastCompass || !fusion) return;
      if (!lastCompass.level) {
        cameraMessage("카메라 보정 대기 · 태블릿을 수평으로 들어 주세요.");
        return;
      }
      if (rotation === null) {
        cameraMessage("카메라 특징점 부족 · 나침반으로 계속 측정 중");
        return;
      }
      const angle = fusion.vision(rotation, time);
      if (angle === null) return;
      cameraMessage("카메라 회전 보정 중 · 절대 방위는 나침반 기준");
      recordHeading(angle, time, lastCompass.screenAngle);
    }

    async function toggleCamera() {
      if (!viewActive || cameraPending || run || !vision) return;
      if (cameraEnabled) { stopCamera(); return; }
      cameraPending = true;
      const token = ++cameraEpoch;
      cameraMessage("후면 카메라 여는 중…");
      syncButtons();
      try {
        camera ||= vision.camera(cameraVideo, onVisualFrame);
        if (!await camera.start() || token !== cameraEpoch) return;
        cameraEnabled = true;
        cameraVideo.hidden = false;
        fusion = vision.createHeadingFusion();
        if (lastCompass) fusion.compass(lastCompass.angle, now());
        cameraMessage("카메라 보정 준비 · 무늬가 있는 지면을 비춰 주세요.");
        attachHeading();
      } catch {
        if (token === cameraEpoch) stopCamera("후면 카메라를 사용할 수 없어 나침반으로 측정합니다.");
      } finally {
        if (token === cameraEpoch) { cameraPending = false; syncButtons(); }
      }
    }

    function renderSaved() {
      const saved = fine || coarse;
      setStage(!!fine, fine?.center, fine?.direct);
      setHeading(history.at(-1)?.angle);
      progress.value = saved?.degrees ?? 0;
      report.hidden = !saved;
      if (!saved) {
        renderDial(null, null);
        syncButtons();
        return;
      }
      const { summary } = saved;
      const peak = activePeak();
      node("result").textContent = summary.peak
        ? `${fine ? (fine.direct ? "90° 직접 탐색" : "정밀 측정") : "360° 후보"} 약 ${displayAngle(summary.peak.angle)}`
        : peak ? `정밀 결과 보류 · 360° 후보 ${displayAngle(peak.angle)}` : "방향 추정 보류";
      node("detail").textContent = `${summary.step}° 간격 · 삡 ${summary.count}회 · 검출 구간 ${summary.measured}곳` +
        (summary.peak ? ` · 후보 ${summary.peak.db.toFixed(1)} dBFS` : "") +
        (summary.alternative ? ` · ${displayAngle(summary.alternative.angle)}에서도 비슷한 세기로 잡혔어요.` : "") +
        (summary.isolated ? ` · ${displayAngle(summary.isolated.angle)}의 단독 강신호는 후보에서 제외했어요.` : "") +
        (fine && summary.peak && Math.abs(delta(summary.peak.angle, fine.center)) >= 39
          ? " · 가장 강한 방향이 측정 구간 끝에 가까워요." : "");
      node("coverage").textContent = `시작 ${displayAngle(saved.firstAngle)} · 종료 ${displayAngle(saved.lastAngle)} · 나침반 회전 ${saved.degrees}° / ${progress.max}°`;
      renderDial(summary, peak?.angle);
      syncButtons();
    }

    function stop(message) {
      request++;
      root.clearTimeout(timeout);
      run = null;
      waitingForAr = null;
      renderSaved();
      setMessage(message);
    }

    function complete(sample) {
      const summary = summarize(sample.pulses, sample.plan.step, sample.targetTone);
      const saved = { source: sample.source, summary, center: sample.center, direct: sample.direct,
        degrees: coverage(sample), firstAngle: sample.firstAngle, lastAngle: sample.lastAngle };
      if (sample.plan === FINE) fine = saved;
      else coarse = saved;
      const label = sample.plan === COARSE ? "360° 탐색 완료" : sample.direct ? "90° 직접 탐색 완료" : "90° 정밀 측정 완료";
      stop(summary.peak ? label : "서로 가까운 방향에서 삡 신호가 충분히 반복되지 않았어요.");
    }

    function queueCompletion(sample, time) {
      sample.completedAt = time;
      setMessage("측정값 정리 중…");
      timeout = root.setTimeout(() => complete(sample), 800);
      syncButtons();
    }

    function alignFine(sample, angle) {
      if (sample.center === null) {
        sample.center = angle;
        setStage(true, angle, true);
      }
      const center = sample.center;
      const left = norm(center - FINE_HALF_ARC), right = norm(center + FINE_HALF_ARC);
      if (Math.abs(delta(angle, left)) <= 5) {
        sample.origin = left;
        sample.sign = 1;
      } else if (Math.abs(delta(angle, right)) <= 5) {
        sample.origin = right;
        sample.sign = -1;
      } else {
        setMessage(`현재 ${displayAngle(angle)} · ${displayAngle(left)} 또는 ${displayAngle(right)}까지 돌리면 측정을 시작해요.`);
        return false;
      }
      return true;
    }

    function onHeading(event) {
      if (arActive) {
        const forward = cameraBearing(event);
        if (forward !== null) arCompass = forward;
        return;
      }
      const screenAngle = screenRotation();
      const angle = bearing(event, screenAngle);
      if (angle === null) return;
      const time = now();
      if (event.type === "deviceorientationabsolute") lastAbsoluteSample = time;
      else if (time - lastAbsoluteSample < 1500) return;
      if (fusion && lastCompass && lastCompass.screenAngle !== screenAngle) fusion = vision.createHeadingFusion();
      lastCompass = { angle, screenAngle, level: Math.abs(event.beta ?? 0) < 23 && Math.abs(event.gamma ?? 0) < 23 };
      const corrected = fusion ? fusion.compass(angle, time, lastCompass.level) : angle;
      if (corrected !== null) recordHeading(corrected, time, screenAngle);
    }

    function recordHeading(angle, time, screenAngle) {
      const previous = history.at(-1);
      if (previous && screenAngle !== previous.screenAngle) {
        history.length = 0;
        if (run?.completedAt === null) stop("화면 방향이 바뀌었어요. 태블릿 방향을 고정하고 다시 시작하세요.");
      }
      const change = history.length ? delta(angle, previous.angle) : 0;
      if (run?.completedAt === null && Math.abs(change) > 45) {
        stop("나침반 값이 갑자기 바뀌었어요. 태블릿 위치를 확인하고 다시 시작하세요.");
        return;
      }
      history.push({ angle, time, screenAngle });
      while (history[0].time < time - 4000) history.shift();
      setHeading(angle);
      if (!run || run.completedAt !== null) return;
      if (run.start === null) root.clearTimeout(timeout);
      const isFine = run.plan === FINE;
      if (run.start === null) {
        if (isFine && !alignFine(run, angle)) return;
        run.start = time;
        run.firstAngle = angle;
      } else if (!isFine) {
        run.turn += change;
      }
      if (isFine) run.turn = run.sign * delta(angle, run.origin);
      run.lastAngle = angle;
      if (!isFine || Math.abs(delta(angle, run.center)) <= FINE_HALF_ARC + 2) {
        run.visited.add(sector(angle, run.plan.step));
      }
      const turn = coverage(run);
      progress.value = turn;
      const direction = isFine ? (run.sign > 0 ? "시계 방향 · " : "반시계 방향 · ") : "";
      const finishHint = canFinishCoarse(run, time) ? " · 시작 방향으로 돌아왔으면 한 바퀴 완료를 누르세요." : "";
      setMessage(`${direction}${turn}° / ${run.plan.arc}° · 삡 ${run.pulses.length}회${finishHint}`);
      if (!full(run)) { syncButtons(); return; }
      if (time - run.start < run.plan.minimumMs) {
        stop(isFine ? "정밀 구간을 너무 빨리 돌았어요. 35~45초에 걸쳐 다시 측정하세요."
          : "한 바퀴를 너무 빨리 돌았어요. 40~60초에 걸쳐 다시 탐색하세요.");
        return;
      }
      queueCompletion(run, time);
    }

    async function begin(plan, directSearch = false) {
      if (!viewActive || run || cameraPending || arPending) return;
      if (!source) { setMessage("삡 소리를 측정하려면 3단계에서 수신 입력을 먼저 켜세요."); return; }
      if (plan === FINE && !directSearch && (!coarse?.summary.peak || coarse.source !== source)) return;
      if (arActive && !arTracking) {
        waitingForAr = { plan, directSearch };
        setMessage(directSearch ? "AR 추적이 준비되면 시작해요. 찾으려는 방향을 유지해 주세요."
          : "AR 추적이 준비되면 시작해요. 지금 방향을 유지해 주세요.");
        syncButtons();
        return;
      }
      const token = ++request;
      try {
        if (typeof root.DeviceOrientationEvent?.requestPermission === "function" &&
            await root.DeviceOrientationEvent.requestPermission(true) !== "granted") {
          if (token === request) setMessage("나침반 권한을 허용해야 측정할 수 있어요.");
          return;
        }
      } catch {
        if (token === request) setMessage("나침반 권한을 확인할 수 없어요.");
        return;
      }
      if (token !== request || !viewActive || !source) return;
      if (plan === COARSE) coarse = null;
      fine = null;
      report.hidden = true;
      if (history.at(-1)?.screenAngle !== screenRotation()) history.length = 0;
      const heading = history.at(-1)?.angle;
      const center = plan === COARSE ? null : directSearch ? heading ?? null : coarse.summary.peak.angle;
      const startTime = plan === COARSE && heading != null ? now() : null;
      const visited = startTime === null ? [] : [sector(heading, plan.step)];
      run = { plan, source, start: startTime, firstAngle: heading, lastAngle: heading, turn: 0, visited: new Set(visited), pulses: [], lastPulse: null,
        completedAt: null, center, direct: directSearch, targetTone: plan === FINE && !directSearch ? coarse.summary.tone : null, origin: 0, sign: 0 };
      if (startTime !== null) history.push({ angle: heading, time: startTime, screenAngle: screenRotation() });
      setStage(plan === FINE, center, directSearch);
      setHeading(heading);
      renderDial(null, plan === FINE && !directSearch ? center : null);
      progress.value = 0;
      attachHeading();
      if (heading == null) {
        setMessage("시작 방향을 유지하세요. 나침반 방향 확인 중…");
        timeout = root.setTimeout(() => stop("기기에서 절대 나침반 방향을 받지 못했어요."), 4000);
      } else {
        setMessage(plan === COARSE ? `시작 ${displayAngle(heading)} · 천천히 한 바퀴 돌아 주세요.` : "강조된 구간의 한쪽 끝으로 돌려 주세요.");
      }
      syncButtons();
    }

    start.addEventListener("click", () => begin(COARSE));
    cameraButton.addEventListener("click", toggleCamera);
    arButton.addEventListener("click", startAr);
    arExit.addEventListener("click", () => stopAr());
    refine.addEventListener("click", () => begin(FINE));
    direct.addEventListener("click", () => begin(FINE, true));
    reset.addEventListener("click", () => {
      coarse = fine = null;
      stop("측정값을 초기화했어요.");
    });
    finish.addEventListener("click", () => {
      if (waitingForAr) { stop("측정 시작 대기를 취소했어요."); return; }
      if (!run) return;
      if (run.completedAt !== null) complete(run);
      else if (canFinishCoarse(run, now())) queueCompletion(run, now());
      else if (run.plan === FINE) stop("측정을 중단했어요.");
    });

    return {
      update(active, nextSource) {
        const previousSource = source;
        const wasActive = viewActive;
        source = nextSource;
        viewActive = active;
        if (waitingForAr && (!active || previousSource !== source)) stop("수신 상태가 바뀌어 시작 대기를 취소했어요.");
        if ((!active || (run && run.source !== source)) && run) stop("수신 상태가 바뀌어 측정을 중단했어요.");
        if (!active && listening) detachHeading();
        if (!active && (cameraEnabled || cameraPending)) stopCamera();
        if (!active && (arActive || arPending)) stopAr();
        if (active && !arChecked && typeof ar?.availability === "function") {
          arChecked = true;
          void ar.availability().then(result => { arButton.hidden = !result.supported; }).catch(() => {});
        }
        const saved = fine || coarse;
        if (active && source && saved && saved.source !== source) {
          coarse = fine = null;
          renderSaved();
        }
        if (active && (!wasActive || previousSource !== source) && report.hidden && !run) {
          setMessage(source ? "준비되면 탐색을 시작하세요." : "3단계에서 USB 오디오 입력 또는 CW 수신을 먼저 켜세요.");
        }
        if (active && (coarse || fine || typeof root.DeviceOrientationEvent?.requestPermission !== "function")) attachHeading();
        if (!active) request++;
        if (arActive) renderArInput();
        syncButtons();
      },
      push(pulseSource, pulse, fallbackAge, db, tone, wallTime) {
        // The native capture timestamp stays fixed even when publication or the WebView is late.
        const wallNow = (root.Date ?? Date).now();
        const age = Number.isFinite(wallTime) ? wallNow - wallTime : fallbackAge;
        if (!run || pulseSource !== run.source || !Number.isFinite(pulse) || (run.lastPulse !== null && pulse <= run.lastPulse) ||
            !Number.isFinite(age) || age < 0 || age > 2000 || !Number.isFinite(db) || !Number.isFinite(tone)) return;
        const time = now() - age;
        if (run.start === null || time < run.start || (run.completedAt !== null && time > run.completedAt)) return;
        const angle = headingAt(history, time);
        if (angle === null) return;
        const isFine = run.plan === FINE;
        if (isFine && (Math.abs(delta(angle, run.center)) > FINE_HALF_ARC + 2 ||
            (run.targetTone !== null && Math.abs(tone - run.targetTone) > 120))) return;
        run.lastPulse = pulse;
        run.pulses.push({ angle, db, tone });
        renderDial(summarize(run.pulses, run.plan.step, run.targetTone), isFine && !run.direct ? run.center : null);
      }
    };
  }

  root.BearDirectionScan = { bearing, cameraBearing, headingAt, summarize, strengthScale, mount };
})(window);
