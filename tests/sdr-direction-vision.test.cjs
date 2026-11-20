const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('public/js/sdr/direction-vision.js', 'utf8'), { window });
const { createHeadingFusion, imageRotation } = window.BearDirectionVision;

test('camera estimates small rotation through translation and rejects a textureless frame', () => {
  const size = 128, cells = new Float64Array(160 * 160);
  let seed = 137;
  for (let i = 0; i < cells.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    cells[i] = seed % 255;
  }
  function texture(x, y) {
    const col = Math.floor(x + 15), row = Math.floor(y + 15);
    const at = row * 160 + col;
    return (cells[at] + cells[at + 1] + cells[at + 160] + cells[at + 161]) / 4;
  }
  const before = new Uint8Array(size ** 2), after = new Uint8Array(size ** 2);
  const angle = 2.5 * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      before[y * size + x] = texture(x, y);
      const u = x - 64 - 2, v = y - 64 + 1;
      after[y * size + x] = texture(64 + cos * u + sin * v, 64 - sin * u + cos * v);
    }
  }
  const measured = imageRotation(before, after, size, size);
  assert.ok(Number.isFinite(measured) && Math.abs(measured - 2.5) < 0.8, `estimated ${measured}°`);
  assert.equal(imageRotation(new Uint8Array(size ** 2), after, size, size), null);
});

test('camera steers relative heading through a temporary compass spike and falls back when tracking stops', () => {
  const fusion = createHeadingFusion();
  assert.equal(fusion.compass(355, 1000), 355);
  assert.equal(fusion.vision(0, 1100), 355);
  assert.equal(fusion.compass(40, 1180), null);
  assert.equal(fusion.vision(-7, 1200), 2);
  assert.equal(fusion.compass(3, 1300), null);
  assert.ok(Math.abs(fusion.compass(5, 1600) - 4) < 1);
  assert.equal(fusion.compass(10, 1700, false), 10);
});
