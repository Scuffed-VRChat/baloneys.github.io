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

// Irregular recorded CPU locks must appear exactly on the song's beat grid.
for(const bpm of [77,89])for(const hz of [30,60,144,240,360]){
  const box=context(),spb=60/bpm,offset=12.5;
  box.SPB=spb;box.CUES={offset};
  vm.runInContext(`
    var song={elapsed:0,piece:{x:0},beatPlayback:true,cineLocks:0};
    var beatJob={p:song,t0:12.5,n:40,snaps:[]};
    sim=function(p,dt){p.elapsed+=dt;p.piece.x+=dt;p.cineLocks=Math.floor(p.elapsed*8);};
    while(!bakeOne(beatJob)){}
    var saved=JSON.stringify(song.baked.snaps);
  `,box);
  assert.ok(box.song.baked.beat.frames.length>5);
  let prior=0,seen=0;
  for(let frame=0;frame<hz*4;frame++){
    box.t=offset+frame/hz;vm.runInContext('replayBoard(song,t)',box);
    if(box.song.cineLocks!==prior){
      const beats=(box.t-offset)/spb,error=Math.abs(beats-Math.round(beats))*spb;
      assert.ok(error<=1/hz+1e-8,`${bpm} BPM lock occurs on a beat at ${hz} Hz`);
      prior=box.song.cineLocks;seen++;
    }
  }
  assert.ok(seen>=4);assert.equal(JSON.stringify(box.song.baked.snaps),box.saved,'Beat retiming preserves recorded states');
}
console.log('PASS 77/89 BPM locks land on beats at 30/60/144/240/360 Hz without mutating snapshots');

// The original keeps its short visuals, but uses the supplied music in source
// order. Guard against accidentally restoring old music or reintroducing a splice.
const moviePath=path.resolve(process.argv[2]||path.join(__dirname,'..','tetris-cinematic.js'));
const musicBox={window:{}};vm.createContext(musicBox);
vm.runInContext(fs.readFileSync(path.join(path.dirname(moviePath),'tetris-cinematic-cuts.js'),'utf8'),musicBox);
const short=musicBox.window.TetrisCinematicCuts.shortCues;
vm.runInContext(source.slice(source.indexOf('  var CUES ='),source.indexOf('  var SPB =')),musicBox);
const extended=musicBox.CUES;
for(const cue of [short,extended]){
  assert.equal(cue.track,'tetrinomos-full-track.mp3');assert.ok(cue.credit.includes('tetronimo$')&&cue.credit.includes('MoneyRhy$'));
  assert.equal(cue.bpm,77);assert.equal(cue.offset,24.965);assert.equal(cue.trackHasSfx,false);
  assert.equal(cue.segments.length,1);assert.equal(cue.segments[0].t0,0);assert.equal(cue.segments[0].at,0);
  const times=cue.shots.map(s=>s.at==null?cue.offset+s.beat*60/cue.bpm:s.at);
  assert.ok(times.every((t,i)=>!i||t>times[i-1]),'Shot order remains chronological');
}
assert.equal(short.end,60);assert.equal(short.segments[0].t1,60);assert.equal(extended.end,137.976);
assert.equal(short.shots.find(s=>s.id==='clear').beat,0,'The hero clear hits the first full drum beat');
console.log('PASS both cuts use unmodified tetronimo$ from source zero; original has one continuous 0-60 s segment');
