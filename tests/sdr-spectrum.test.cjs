const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/sdr/spectrum.js'), 'utf8');

function setup() {
  const window = { devicePixelRatio: 2 };
  vm.runInNewContext(source, { window });
  return window.SdrSpectrumPlot;
}

test('CW zoom centers the selected carrier, includes zero offset and draws precise frequency ticks',()=>{
  const plot=setup(),bins=Array(128).fill(-100);bins[64]=-78;
  const data=plot.describe(bins,148241000,6000,{narrow:true});
  assert.equal(data.peakHz,148241000);assert.equal(data.binWidthHz,46.875);
  assert.equal(data.startHz,148238000);assert.equal(data.endHz,148244000);
  const labels=[];
  const ctx={setTransform(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
    fillText(text,x,y){labels.push({text,x,y});},setLineDash(){},closePath(){},fill(){},arc(){}};
  plot.draw({clientWidth:260,clientHeight:128,getContext:()=>ctx},data,148241000,6000,'receiving',148241000);
  for(const text of ['148.238','148.241','148.244','대상','-60','-120'])assert.ok(labels.some(x=>x.text===text),text);
  assert.ok(!labels.some(x=>x.text==='148.229'));
  assert.ok(labels.every(x=>x.x>=0&&x.x<=260&&x.y>=0&&x.y<128));
});

test('FFT-shift mapping puts negative offsets on the left and positive offsets on the right', () => {
  const plot = setup();
  for (const [index, expected] of [[256, 103244000], [768, 103756000]]) {
    const bins = Array(1024).fill(-90); bins[index] = -20;
    const data = plot.describe(bins, 103500000, 1024000);
    assert.equal(data.peakHz, expected); assert.equal(data.binWidthHz, 1000);
  }
});

test('canvas draws the frequency ticks and resets to waiting without stale paths', () => {
  const plot = setup(), text = [];
  let strokes = 0;
  const ctx = { setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { strokes++; }, fillText(value) { text.push(value); }, setLineDash() {}, closePath() {}, fill() {}, arc() {} };
  const canvas = { clientWidth: 320, getContext: () => ctx };
  const bins = Array(1024).fill(-80); bins[600] = -25;
  plot.draw(canvas, plot.describe(bins, 103500000, 1024000), 103500000, 1024000, 'receiving');
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 480);
  assert.ok(text.includes('102.988') && text.includes('103.500') && text.includes('104.012'));
  assert.ok(strokes > 0);
  text.length = 0;
  plot.draw(canvas, null, 103500000, 1024000, 'starting');
  assert.ok(text.includes('수신 준비 중'));
});

test('redrawing a frame does not resize the canvas backing store', () => {
  const plot = setup();
  const ctx = { setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fillText() {}, setLineDash() {}, closePath() {}, fill() {}, arc() {} };
  let resizes = 0, width, height;
  const canvas = { clientWidth: 320, getContext: () => ctx,
    get width() { return width; }, set width(value) { width = value; resizes++; },
    get height() { return height; }, set height(value) { height = value; resizes++; } };
  const data = plot.describe(Array(1024).fill(-80), 103500000, 1024000);
  plot.draw(canvas, data, 103500000, 1024000, 'receiving');
  plot.draw(canvas, data, 103500000, 1024000, 'receiving');
  assert.equal(resizes, 2);
});

test('compact spectrum uses its displayed height and keeps axis labels within the canvas', () => {
  const plot=setup(),labels=[];
  const ctx={setTransform(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
    fillText(text,x,y){labels.push({text,x,y});},setLineDash(){},closePath(){},fill(){},arc(){}};
  const canvas={clientWidth:260,clientHeight:128,getContext:()=>ctx};
  plot.draw(canvas,plot.describe(Array(1024).fill(-80),148229000,1024000),148229000,1024000,'receiving',148241000);
  assert.equal(canvas.width,520);assert.equal(canvas.height,256);
  assert.ok(labels.every(label=>label.x>=0&&label.x<=260&&label.y>=0&&label.y<128));
  assert.ok(labels.some(label=>label.text==='MHz'));
});
