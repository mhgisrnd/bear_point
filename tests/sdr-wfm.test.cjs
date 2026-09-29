const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-wfm-'));
const compiler = process.env.SDR_TEST_CLANG || path.join(process.env.LOCALAPPDATA, 'Android/Sdk/ndk/26.1.10909125/toolchains/llvm/prebuilt/windows-x86_64/bin/clang++.exe');
const wasm = path.join(dir, 'wfm.wasm');
const object = path.join(dir, 'wfm.o');
const compiled = spawnSync(compiler, ['--target=wasm32', '-DSDR_DSP_TEST', '-std=c++17', '-O2', '-fno-exceptions', '-fno-rtti', '-nostdlib',
  '-c', path.join(__dirname, 'wfm-harness.cpp'), '-o', object], { encoding: 'utf8' });
if (compiled.status !== 0) throw new Error(compiled.error?.message || compiled.stderr);
const linked = spawnSync(path.join(path.dirname(compiler), 'ld.lld.exe'), ['-flavor', 'wasm', '--no-entry', '--export-all', '--allow-undefined', object, '-o', wasm], { encoding: 'utf8' });
if (linked.status !== 0) throw new Error(linked.error?.message || linked.stderr);
const binary = fs.readFileSync(wasm);
// Execute the very same C++ DSP used by the APK, with host math as WASM imports.
function receiver() {
  let memory;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(binary), { env: {
    sin: Math.sin, cos: Math.cos, atan2: Math.atan2, exp: Math.exp,
    memset: (ptr, value, length) => { new Uint8Array(memory.buffer, ptr, length).fill(value); return ptr; }
  } });
  const api = instance.exports; memory = api.memory; api.__wasm_call_ctors?.();
  return { api, decode(iq, chunk = 65536) {
    const pcm = [];
    for (let i = 0; i < iq.length; i += chunk) {
      const block = iq.subarray(i, i + chunk);
      new Uint8Array(memory.buffer, api.inputBuffer(), block.length).set(block);
      const count = api.process(block.length);
      pcm.push(...new Int16Array(memory.buffer, api.outputBuffer(), count));
    }
    return pcm;
  } };
}
function signal(rate, carrier = 200000, tone = 1000, deviation = 25000, seconds = .16) {
  const samples = Math.round(rate * seconds), iq = new Uint8Array(samples * 2);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    phase += 2 * Math.PI * (carrier + deviation * Math.sin(2 * Math.PI * tone * i / rate)) / rate;
    iq[2 * i] = Math.round(127.5 + 90 * Math.cos(phase));
    iq[2 * i + 1] = Math.round(127.5 + 90 * Math.sin(phase));
  }
  return iq;
}
function toneQuality(pcm, hz) {
  let re = 0, im = 0, power = 0;
  const start = 2400, length = pcm.length - start;
  for (let i = start; i < pcm.length; i++) {
    re += pcm[i] * Math.cos(2 * Math.PI * hz * i / 48000);
    im += pcm[i] * Math.sin(2 * Math.PI * hz * i / 48000);
    power += pcm[i] * pcm[i];
  }
  return { amplitude: Math.hypot(re, im) * 2 / length, purity: 2 * (re * re + im * im) / (length * power) };
}
test('offset WFM tone recovers at 48 kHz across every UI sample rate', () => {
  for (const rate of [250000, 1024000, 1536000, 2048000, 2400000]) {
    const offset = rate === 250000 ? 0 : 200000;
    const r = receiver(); assert.equal(r.api.configure(rate, offset, 75), 1);
    const pcm = r.decode(signal(rate, offset));
    assert.ok(Math.abs(pcm.length - 7680) <= 1, `${rate}: ${pcm.length} samples`);
    const quality = toneQuality(pcm, 1000);
    assert.ok(quality.purity > .97, `${rate}: purity ${quality.purity}`);
    assert.ok(quality.amplitude > 5000 && quality.amplitude < 9000, `${rate}: amplitude ${quality.amplitude}`);
  }
});
test('odd USB chunk boundaries preserve oscillator, filter and I/Q alignment', () => {
  const iq = signal(1024000);
  const a = receiver(), b = receiver();
  a.api.configure(1024000, 200000, 75); b.api.configure(1024000, 200000, 75);
  assert.deepEqual(a.decode(iq), b.decode(iq, 4093));
});
test('negative-frequency offset is mixed in the correct direction', () => {
  const r = receiver(); r.api.configure(1024000, -200000, 75);
  assert.ok(toneQuality(r.decode(signal(1024000, -200000)), 1000).purity > .97);
});
test('deemphasis attenuates high tones and rejects invalid channel settings', () => {
  const a = receiver(), b = receiver();
  assert.equal(a.api.configure(1024000, 200000, 50), 1);
  assert.equal(b.api.configure(1024000, 200000, 75), 1);
  const iq = signal(1024000, 200000, 8000);
  const qa = toneQuality(a.decode(iq), 8000), qb = toneQuality(b.decode(iq), 8000);
  assert.ok(qa.purity > .95 && qb.purity > .95);
  assert.ok(qa.amplitude > qb.amplitude * 1.3);
  assert.equal(a.api.configure(1024000, 500000, 75), 0);
  assert.equal(a.api.configure(250000, 200000, 75), 0);
  assert.equal(a.api.configure(1024000, 0, 0), 0);
});
