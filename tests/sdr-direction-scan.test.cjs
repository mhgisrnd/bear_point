const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(window = {}) {
  const sources = ['public/js/heading-dial.js', 'public/js/sdr/direction-scan.js'];
  vm.runInNewContext(sources.map(path => fs.readFileSync(path, 'utf8')).join('\n'), { window });
  return window.BearDirectionScan;
}

test('absolute headings compensate screen rotation and interpolate across north', () => {
  const { bearing, headingAt } = load();
  assert.equal(bearing({ type: 'deviceorientation', alpha: 90 }, 0), null);
  assert.equal(bearing({ type: 'deviceorientationabsolute', alpha: 45 }, 90), 45);
  assert.equal(bearing({ webkitCompassHeading: 275 }, 0), 275);
  assert.equal(headingAt([{ angle: 355, time: 10 }, { angle: 5, time: 110 }], 60), 0);
  assert.equal(headingAt([{ angle: 120, time: 1000 }], 1300), null);
});

test('AR anchoring uses the forward camera bearing in both portrait and landscape', () => {
  const { cameraBearing } = load();
  const event = (alpha, beta, gamma) => ({ type: 'deviceorientationabsolute', alpha, beta, gamma });
  assert.equal(cameraBearing(event(0, 90, 0)), 0);
  assert.equal(cameraBearing(event(270, 90, 0)), 90);
  assert.equal(cameraBearing(event(0, 0, -90)), 90);
  assert.equal(cameraBearing(event(0, 0, 0)), null);
});

test('direction uses matching CW pulses and flags competing peaks', () => {
  const { summarize } = load();
  const pulses = [
    { angle: 89, db: -23, tone: 700 }, { angle: 92, db: -25, tone: 715 },
    { angle: 100, db: -36, tone: 700 }, { angle: 270, db: -25, tone: 695 }, { angle: 272, db: -25, tone: 702 },
    { angle: 20, db: -8, tone: 1700 }
  ];
  const result = summarize(pulses);
  assert.equal(result.peak.angle, 90);
  assert.equal(result.peak.db, -24);
  assert.equal(result.alternative.angle, 270);
  assert.equal(result.count, 5);
  assert.equal(result.levels[2], null);
  assert.equal(summarize(pulses.slice(0, 2)).peak, null);
});

test('one isolated strong pulse cannot displace a repeatedly supported bearing', () => {
  const { summarize } = load();
  const result = summarize([
    { angle: 140, db: -9, tone: 700 }, { angle: 60, db: -25, tone: 710 },
    { angle: 50, db: -29, tone: 695 }, { angle: 70, db: -30, tone: 698 }
  ]);
  assert.equal(result.peak.angle, 60);
  assert.equal(result.isolated.angle, 140);
});

test('strength scale spreads close levels while identical levels are drawn with equal length', () => {
  const { strengthScale } = load();
  const scale = strengthScale([-44, null, -43.8, -43.6]);
  assert.equal(scale.fraction(-44), 0);
  assert.equal(scale.fraction(-43.6), 1);
  assert.ok(Math.abs(scale.fraction(-43.8) - 0.5) < 1e-10);
  assert.equal(strengthScale([-43, -43]).fraction(-43), 0.5);
});

function scanFixture(plugins = {}) {
  let time = 1000, nextTimer = 0;
  const sensors = new Map(), timers = new Map(), nodes = new Map();
  const window = {
    performance: { now: () => time },
    Date: { now: () => 1700000000000 + time },
    Capacitor: { Plugins: plugins },
    addEventListener: (name, fn) => sensors.set(name, fn),
    removeEventListener: name => sensors.delete(name),
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id)
  };
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {
      hidden: true, addEventListener: (_, fn) => { nodes.get(key).click = fn; },
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, toggleAttribute() {}
    });
    return nodes.get(key);
  };
  const panel = { querySelector: selector => node(selector.slice(16, -1)) };
  const scan = load(window).mount(panel);
  const emit = angle => sensors.get('deviceorientationabsolute')({ type: 'deviceorientationabsolute', alpha: 360 - angle });
  return { scan, node, emit, sensors, timers, setTime: value => { time = value; } };
}

test('AR uses the compass once and follows the ARCore rotation thereafter', async () => {
  let pose, closed = 0;
  const plugin = {
    availability: async () => ({ supported: true }),
    addListener: async (_, callback) => { pose = callback; return {}; },
    start: async () => ({ active: true }),
    stop: async () => { closed++; }
  };
  const { scan, node, sensors, setTime } = scanFixture({ BearArDirection: plugin });
  scan.update(true, 'bt');
  await Promise.resolve();
  assert.equal(node('ar-button').hidden, false);
  await node('ar-button').click();
  assert.equal(node('start').disabled, false);
  assert.equal(node('direct').disabled, false);
  const point = alpha => sensors.get('deviceorientationabsolute')({ type: 'deviceorientationabsolute', alpha, beta: 90, gamma: 0 });
  point(280);
  pose({ state: 'tracking', yaw: -15 });
  assert.equal(node('heading').textContent, '80°');
  setTime(1500);
  point(220);
  pose({ state: 'tracking', yaw: 5 });
  assert.equal(node('heading').textContent, '100°');
  assert.equal(node('start').disabled, false);
  scan.update(false, null);
  assert.equal(closed, 1);
});

test('AR buttons explain paused tracking and resume a queued search when tracking returns', async () => {
  let pose;
  const plugin = {
    availability: async () => ({ supported: true }),
    addListener: async (_, callback) => { pose = callback; return {}; },
    start: async () => ({ active: true }),
    stop: async () => {}
  };
  const { scan, node, sensors } = scanFixture({ BearArDirection: plugin });
  scan.update(true, 'bt');
  await node('ar-button').click();
  pose({ state: 'paused', reason: 'INSUFFICIENT_LIGHT' });
  assert.match(node('ar-status').textContent, /조명이 밝은/);
  assert.match(node('ar-input').textContent, /수신 입력 준비됨/);
  await node('start').click();
  assert.match(node('status').textContent, /AR 추적이 준비되면 시작/);
  assert.equal(node('finish').textContent, '시작 대기 취소');
  node('finish').click();
  assert.match(node('status').textContent, /대기를 취소/);
  await node('direct').click();
  sensors.get('deviceorientationabsolute')({ type: 'deviceorientationabsolute', alpha: 280, beta: 90, gamma: 0 });
  pose({ state: 'tracking', yaw: 20 });
  assert.equal(node('progress').max, 90);
  assert.match(node('guide').textContent, /시작 방향 80° 주변 35° ↔ 125°/);
  assert.notEqual(node('finish').textContent, '시작 대기 취소');
});

test('a full sweep leads to a narrower second sweep using only the matching signal', async () => {
  const { scan, node, emit, sensors, timers, setTime } = scanFixture();
  scan.update(true, 'bt');
  assert.equal(node('start').disabled, false);
  await node('start').click();
  for (let degree = 0; degree <= 360; degree += 5) {
    const time = 1000 + degree * 110;
    // Send a compass sample between the 5° grid points for interpolation.
    if (degree) { setTime(time - 275); emit(degree - 2.5); }
    setTime(time);
    emit(degree);
    if ([95, 105, 115].includes(degree)) {
      scan.push('bt', time - 440, 440, degree === 105 ? -20 : -32, 710);
      scan.push('bt', time - 440, 440, -5, 710);
    }
  }
  assert.ok(node('progress').value >= 358);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.match(node('result').textContent, /100°/);
  assert.match(node('detail').textContent, /삡 3회/);
  assert.match(node('chart').innerHTML, /sdr-direction-ray/);
  assert.equal(node('refine').hidden, false);
  assert.equal(sensors.size, 2);
  emit(82);
  assert.match(node('target-guide').textContent, /오른쪽으로 18°/);
  emit(102);
  assert.match(node('target-guide').textContent, /방향이 맞았어요/);

  let time = 43000;
  setTime(time);
  await node('refine').click();
  assert.equal(node('fine-step').attributes['aria-current'], 'step');
  assert.match(node('guide').textContent, /55° ↔ 145°/);
  emit(100);
  scan.push('bt', 10, 0, -8, 710); // Still aligning, outside the sweep.
  assert.match(node('status').textContent, /55° 또는 145°/);
  for (let angle = 145; angle >= 55; angle -= 2.5) {
    time += 1000;
    setTime(time);
    emit(angle);
    if (angle === 110) scan.push('bt', time, 0, -3, 1600);
    if ([120, 117.5, 112.5].includes(angle)) scan.push('bt', time, 0, angle === 117.5 ? -21 : -30, 710);
    if (timers.size) break;
  }
  assert.equal(node('progress').max, 90);
  assert.ok(node('progress').value >= 85);
  [...timers.values()][0]();
  assert.match(node('result').textContent, /정밀 측정 약 117°/);
  assert.match(node('detail').textContent, /3° 간격 · 삡 3회/);
  assert.equal(sensors.size, 2);
  emit(126);
  assert.match(node('target-guide').textContent, /왼쪽으로 9°/);
  scan.update(false, null);
  assert.equal(sensors.size, 0);
});

test('a physical return with a 15° compass mismatch can finish without changing recorded headings', async () => {
  const { scan, node, emit, timers, setTime } = scanFixture();
  scan.update(true, 'bt');
  await node('start').click();
  assert.equal(node('finish').disabled, true);
  for (let angle = 0; angle <= 345; angle += 5) {
    const time = 1000 + angle * 120;
    setTime(time);
    emit(angle);
    if ([55, 65, 75].includes(angle)) scan.push('bt', time, 0, angle === 65 ? -20 : -26, 710);
  }
  assert.equal(node('progress').value, 345);
  assert.equal(timers.size, 0);
  assert.equal(node('finish').disabled, false);
  assert.equal(node('finish').textContent, '한 바퀴 완료');
  node('finish').click();
  [...timers.values()][0]();
  assert.equal(node('progress').value, 345);
  assert.match(node('coverage').textContent, /시작 0° · 종료 345° · 나침반 회전 345° \/ 360°/);
  assert.match(node('result').textContent, /약 70°/);
});

test('the live heading at Start counts when the first post-start sensor update arrives after rotation has begun', async () => {
  const { scan, node, emit, sensors, timers, setTime } = scanFixture();
  scan.update(true, 'bt');
  emit(0);
  assert.equal(node('heading').textContent, '0°');
  sensors.get('deviceorientation')({ type: 'deviceorientation', absolute: true, alpha: 345 });
  assert.equal(node('heading').textContent, '0°');
  setTime(1500);
  await node('start').click();
  assert.match(node('status').textContent, /시작 0°/);
  for (let angle = 15; angle <= 360; angle += 5) {
    const time = 1500 + angle * 120;
    setTime(time);
    emit(angle);
  }
  assert.equal(node('progress').value, 360);
  [...timers.values()][0]();
  assert.match(node('coverage').textContent, /시작 0° · 종료 0° · 나침반 회전 360°/);
});

test('the capture timestamp removes systematic forward bias in both rotation directions', async () => {
  const epoch = 1700000000000;
  for (const sign of [1, -1]) {
    for (const absolute of [true, false]) {
      const { scan, node, emit, timers, setTime } = scanFixture();
      scan.update(true, 'usb');
      await node('start').click();
      for (let turn = 0; turn <= 345; turn += 5) {
        const time = 1000 + turn * 120;
        if (turn) { setTime(time - 300); emit(sign * (turn - 2.5)); }
        setTime(time);
        emit(sign * turn);
        const capturedAngle = (360 + sign * (turn - 15)) % 360;
        if ([80, 90, 100].includes(capturedAngle)) {
          scan.push('usb', time - 1800, 200, capturedAngle === 90 ? -20 : -26, 710,
            absolute ? epoch + time - 1800 : undefined);
        }
      }
      node('finish').click();
      [...timers.values()][0]();
      const expected = absolute ? 90 : 90 + sign * 10;
      assert.match(node('result').textContent, new RegExp(`약 ${expected}°`));
    }
  }
});

test('90° direct search centers on the first heading and reset clears live and finished data', async () => {
  const { scan, node, emit, timers, setTime } = scanFixture();
  scan.update(true, 'usb');
  assert.equal(node('direct').disabled, false);
  assert.equal(node('reset').disabled, true);
  await node('direct').click();
  assert.match(node('guide').textContent, /첫 나침반 값/);
  emit(350);
  assert.match(node('guide').textContent, /시작 방향 350° 주변 305° ↔ 35°/);
  assert.equal(node('progress').value, 0);
  node('reset').click();
  assert.equal(timers.size, 0);
  assert.equal(node('progress').max, 360);
  assert.equal(node('direct').hidden, false);

  await node('direct').click();
  assert.match(node('guide').textContent, /305° ↔ 35°/);
  emit(330);
  emit(305);
  for (let angle = 307.5; angle <= 395 && !timers.size; angle += 2.5) {
    const time = 1000 + (angle - 305) * 400;
    setTime(time);
    emit(angle % 360);
    if ([335, 347.5, 350, 365].includes(angle)) scan.push('usb', time, 0, angle === 350 ? -20 : -29, 710);
    if (angle === 375) scan.push('usb', time, 0, -3, 1600);
  }
  assert.ok(node('progress').value >= 85);
  [...timers.values()][0]();
  assert.match(node('result').textContent, /90° 직접 탐색 약 351°/);
  assert.match(node('detail').textContent, /삡 4회/);
  assert.equal(node('target-guide').hidden, false);
  node('reset').click();
  assert.equal(node('chart').innerHTML, '');
  assert.equal(node('marker').innerHTML, '');
  assert.equal(node('sector').innerHTML, '');
  assert.equal(node('target-guide').hidden, true);
  assert.equal(node('report').hidden, true);
  assert.equal(node('reset').disabled, true);
});
