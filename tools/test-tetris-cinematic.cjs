// Regression checks for refresh-rate-independent cinematic board playback.
// Run: node tools/test-tetris-cinematic.cjs (or pass a path to tetris-cinematic.js).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'tetris-cinematic.js'), 'utf8');
const bakeCode = source.slice(source.indexOf('  var BAKE_HZ ='), source.indexOf('  // A seed whose palette'));
const drawCode = source.slice(source.indexOf('  function drawBoards('), source.indexOf('  function shotIndexAt('));
function context() {
  const box = { Cine: { t: 0, hold: null, bakeJobs: [] }, performance, K: { drawPlayer() {} },
    sim(p, dt) { p.elapsed += dt; p.piece.x += dt; } };
  vm.createContext(box);
  vm.runInContext(bakeCode + drawCode, box);
  return box;
}
for (const hz of [30, 60, 144, 240, 360]) {
  const box = context();
  vm.runInContext(`
    var p = { elapsed: 0, board: [[1,0],[0,1]], piece: { x: 0 }, fx: [] };
    var job = { p: p, t0: 0, n: 50, snaps: [] };
    p.bakeJob = job; Cine.bakeJobs.push(job);
    while (!bakeOne(job)) {}
    var frames = p.baked.snaps.length, original = JSON.stringify(p.baked.snaps);
    var g = { boards: [{ board: p, visible: true }] };
  `, box);
  for (let i = 0; i < hz * 2; i++) {
    box.Cine.t = i / hz;
    vm.runInContext(`drawBoards(g, ${1 / hz});`, box);
    assert.equal(box.p.bakeJob, null, `No restored bake job at ${hz} Hz`);
    assert.equal(box.p.baked.snaps.length, 50, `Snapshot count stable at ${hz} Hz`);
  }
  assert.equal(JSON.stringify(box.p.baked.snaps), box.original, 'Playback preserves saved states');
  assert.equal(box.Cine.bakeJobs.length, 0);

  // A live board must receive the same simulation steps at any display rate.
  vm.runInContext('var live={elapsed:0,piece:{x:0}}; var liveGroup={boards:[{board:live,visible:true}]};', box);
  for (let i = 0; i < hz * 2; i++) vm.runInContext(`drawBoards(liveGroup, ${1 / hz});`, box);
  assert.ok(Math.abs(box.live.elapsed - 2) < 1e-10, `Live simulation elapsed at ${hz} Hz`);
  assert.ok(Math.abs(box.live.piece.x - 2) < 1e-10, `Live simulation state at ${hz} Hz`);
  box.Cine.hold = 2;
  vm.runInContext('drawBoards(liveGroup, 0.05)', box);
  assert.ok(Math.abs(box.live.elapsed - 2) < 1e-10, 'Held preview does not advance a live board');
  console.log(`PASS ${hz} Hz: stable replay, immutable frames, identical live progression`);
}
