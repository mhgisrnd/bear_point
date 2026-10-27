const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-cw-'));
const compiler = process.env.SDR_TEST_CLANG || path.join(process.env.LOCALAPPDATA, 'Android/Sdk/ndk/26.1.10909125/toolchains/llvm/prebuilt/windows-x86_64/bin/clang++.exe');
const wasm = path.join(dir, 'wfm.wasm');
const object = path.join(dir, 'wfm.o');
const compiled = spawnSync(compiler, ['--target=wasm32', '-DSDR_DSP_TEST', '-std=c++17', '-O2', '-fno-exceptions', '-fno-rtti', '-nostdlib',
  '-c', path.join(__dirname, 'cw-harness.cpp'), '-o', object], { encoding: 'utf8' });
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
function keyed(rate, carrier = 12000, dc = 0) {
  const iq = new Uint8Array(rate * 2);
  for (let i = 0; i < rate; i++) {
    const on = (i / rate >= .2 && i / rate < .22) || (i / rate >= .6 && i / rate < .62);
    iq[2*i] = Math.round(127.5 + dc + (on ? 65*Math.cos(2*Math.PI*carrier*i/rate) : 0));
    iq[2*i+1] = Math.round(127.5 + (on ? 65*Math.sin(2*Math.PI*carrier*i/rate) : 0));
  }
  return iq;
}
function rms(pcm, start, end) {
  const a = Math.round(start * 48000), b = Math.round(end * 48000);
  let total = 0; for(let i=a;i<b;i++) total += pcm[i]*pcm[i];
  return Math.sqrt(total/(b-a));
}
test('CW renders keyed carriers as 700 Hz pulses at every supported rate and rejects tuner DC', () => {
  for (const rate of [250000,1024000,1536000,2048000,2400000]) {
    const r = receiver(); assert.equal(r.api.configure(rate,12000,0),1);
    const pcm = r.decode(keyed(rate,12000,15));
    assert.equal(pcm.length,48000);
    assert.ok(rms(pcm,.203,.219)>5000, String(rate));
    assert.ok(rms(pcm,.3,.4)<rms(pcm,.203,.219)/100, 'DC suppression');
    let best=0, bestHz=0;
    for(let hz=500;hz<=900;hz+=10) {
      let re=0,im=0;for(let i=9800;i<10500;i++){re+=pcm[i]*Math.cos(2*Math.PI*hz*i/48000);im+=pcm[i]*Math.sin(2*Math.PI*hz*i/48000);}
      if(re*re+im*im>best){best=re*re+im*im;bestHz=hz;}
    }
    assert.ok(Math.abs(bestHz-700)<=10, 'beat note '+bestHz);
  }
});
test('CW preserves odd USB chunks and rejects invalid offsets', () => {
  const a=receiver(),b=receiver();a.api.configure(1024000,12000,0);b.api.configure(1024000,12000,0);
  const iq=keyed(1024000);assert.deepEqual(a.decode(iq),b.decode(iq,4093));
  assert.equal(a.api.configure(250000,120000,0),0);
});

test('audible CW follows pulse timing, strength and tuning rather than a generated beep', () => {
  const rate = 1024000, iq = keyed(rate);
  const strong = receiver(); strong.api.configure(rate, 12000, 0);
  const loud = strong.decode(iq);
  const weak = receiver(); weak.api.configure(rate, 12000, 0);
  const quiet = weak.decode(Uint8Array.from(iq, x => Math.round(127.5 + (x - 127.5) * .25)));
  const ratio = rms(loud, .203, .219) / rms(quiet, .203, .219);
  assert.ok(ratio > 3.5 && ratio < 4.5, 'audio level follows received amplitude');
  for (const [a, b] of [[.1, .19], [.23, .59], [.63, .9]])
    assert.ok(rms(loud, a, b) < rms(loud, .203, .219) / 100, 'no beeps between actual pulses');
  assert.ok(rms(loud, .603, .619) > 5000, 'second received pulse remains audible');
  const detuned = receiver(); detuned.api.configure(rate, 11000, 0);
  const shifted = detuned.decode(iq);
  const energy = (pcm, hz) => {
    let re = 0, im = 0;
    for (let i = 9800; i < 10500; i++) {
      re += pcm[i] * Math.cos(2 * Math.PI * hz * i / 48000);
      im += pcm[i] * Math.sin(2 * Math.PI * hz * i / 48000);
    }
    return re * re + im * im;
  };
  assert.ok(energy(loud, 700) > energy(loud, 1700) * 100);
  assert.ok(energy(shifted, 1700) > energy(shifted, 700) * 100, 'tuning changes the CW beat pitch');
});

test('CW strength tracks actual carrier power, captures short pulses, and falls after silence', () => {
  const r=receiver();r.api.configure(1024000,12000,0);
  const strong=keyed(1024000);
  r.decode(strong);const high=r.api.signalPeak();
  assert.ok(high>.1);
  assert.equal(r.api.signalPeak(),-1);
  r.decode(new Uint8Array(204800).fill(128));
  assert.ok(r.api.signalPeak()<high/1000);
  const weak=Uint8Array.from(strong,x=>Math.round(127.5+(x-127.5)*.25));
  r.api.configure(1024000,12000,0);r.decode(weak);
  const low=r.api.signalPeak();
  assert.ok(high/low>12 && high/low<20, 'power follows squared amplitude');
});

function noisyBeacon(amplitude, noise, random) {
  const rate=1024000, iq=new Uint8Array(204800);
  for(let i=0;i<iq.length/2;i++) {
    const mag=Math.sqrt(-2*Math.log(random()))*noise, angle=2*Math.PI*random();
    const on=i/rate>=.04&&i/rate<.06, phase=2*Math.PI*12000*i/rate;
    iq[2*i]=Math.round(127.5+mag*Math.cos(angle)+(on?amplitude*Math.cos(phase):0));
    iq[2*i+1]=Math.round(127.5+mag*Math.sin(angle)+(on?amplitude*Math.sin(phase):0));
  }
  return iq;
}

test('CW noise reference suppresses the old noise-only floor while retaining weak and strong pulses', () => {
  let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
  for(const noise of [1.3,2.5,5]) {
    const r=receiver();r.api.configure(1024000,12000,0);
    assert.equal(r.api.noisePower(),-1);
    let peak;
    for(let i=0;i<8;i++) {r.decode(noisyBeacon(0,noise,random));peak=r.api.signalPeak();}
    let floor=r.api.noisePower();
    assert.ok(floor>0);
    assert.ok(10*Math.log10(peak/floor)<6,'noise alone must stay below the bar threshold');
    r.decode(noisyBeacon(noise*2,noise,random));
    const strong=10*Math.log10(r.api.signalPeak()/r.api.noisePower());
    r.decode(noisyBeacon(noise*.4,noise,random));
    const weak=10*Math.log10(r.api.signalPeak()/r.api.noisePower());
    assert.ok(strong>weak+8);assert.ok(weak>6);
    for(let i=0;i<4;i++){r.decode(noisyBeacon(0,noise,random));peak=r.api.signalPeak();}
    assert.ok(10*Math.log10(peak/r.api.noisePower())<6,'meter must return to noise level');
    // Changes in the receiver noise floor settle without becoming a fixed bar floor.
    for(let i=0;i<30;i++){r.decode(noisyBeacon(0,noise*2,random));peak=r.api.signalPeak();}
    assert.ok(10*Math.log10(peak/r.api.noisePower())<6);
  }
});
