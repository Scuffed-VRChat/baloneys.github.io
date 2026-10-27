// Original short visuals over the supplied recording, played in order from source zero.
(function(){
  var shortCues = {
    track: 'tetrinomos-full-track.mp3',
    credit: 'Music: "tetronimo$" by MoneyRhy$',
    trackHasSfx: false,
    bpm: 77,
    offset: 24.965,
    end: 60,
    volume: 0.9,
    sfx: 0.3,
    // One continuous source segment. Only its playback gain fades at the exit;
    // the supplied MP3 is neither spliced, shortened, re-encoded nor time-stretched.
    segments: [{t0:0,t1:60,at:0,handoff:true,fadeOut:[58.5,60]}],
    duck: [],
    spark: [11.14,12.5],
    shots: [
      {id:'cabinet',at:0,nominal:4},
      {id:'logo',at:4,group:'cabinet'},
      {id:'subtitle',at:7,group:'cabinet'},
      {id:'spark',at:10,group:'cabinet'},
      {id:'launch',at:12.5,nominal:2.743},
      {id:'road',at:12.5+4*60/77,nominal:4.114},
      {id:'gameplay',beat:-3,group:'road'},
      {id:'clear',beat:0,group:'road',nominal:2.743},
      {id:'streak',beat:4,nominal:4.114},
      {id:'multiplayer',beat:8,nominal:4.114},
      {id:'eliminated',beat:13,group:'multiplayer',nominal:1.372},
      {id:'attack',beat:15,group:'multiplayer',nominal:2.743},
      {id:'achievements',beat:17,nominal:4.114},
      {id:'profile',beat:21,group:'achievements',nominal:1.372},
      {id:'chat',beat:24,group:'achievements',nominal:2.743},
      {id:'friends',beat:27,group:'achievements',nominal:2.743},
      {id:'modes',beat:30,nominal:2.743},
      {id:'skulls',beat:34,group:'modes',nominal:2.743},
      {id:'montage',beat:38,nominal:4.262},
      {id:'menu',beat:43,group:'montage'}
    ]
  };
  function shortScore(api) {
    var CUES=api.CUES, cueTime=api.cueTime, MOMENTS=api.moments, SPB=60/CUES.bpm, IMPACT=api.impact;
    var ev = [];
    function at(t, f) { ev.push({ t: t, f: f }); }
    at(cueTime('logo'), function (a, t) { a.crackle(t, 0.4, 0.3); a.chime(t, 72, 0.4); });
    at(CUES.spark[0], function (a, t) { a.crackle(t, 0.7, 0.8); a.whoosh(t, 0.7, CUES.spark[1] - CUES.spark[0]); });
    at(cueTime('launch'), function (a, t) { a.impact(t, 0.8); });
    at(cueTime('road'), function (a, t) { a.whoosh(t, 0.6, 0.6); });
    at(cueTime('gameplay'), function (a, t) { a.whoosh(t, 0.4, 0.4); });
    at(cueTime('clear'), function (a, t) { a.impact(t, 0.8); a.chime(t, 72, 0.7); a.chime(t + 0.08, 79, 0.6); });
    [0.2, 0.5, 0.8].forEach(function (f, i) {
      at(cueTime('streak', f), function (a, t) { a.chime(t, [72, 75, 79][i], 0.7); a.zap(t, 0.3, 0.25); });
    });
    at(MOMENTS.attack, function (a, t) { a.zap(t, 0.7, 0.9); });
    at(MOMENTS.attack + 0.9, function (a, t) { a.impact(t, 0.6); });
    at(MOMENTS.eliminated, function (a, t) { a.impact(t, 0.6); a.glitch(t, 0.6); });
    at(MOMENTS.shatter, function (a, t) { a.crackle(t, 0.8, 0.5); });
    at(MOMENTS.exitAttack, function (a, t) { a.zap(t, 0.7, 1); });
    at(MOMENTS.exitAttack + 1, function (a, t) { a.impact(t, 0.5); });
    [0.6, 1.5, 2.3].forEach(function (local, i) {
      var duration = cueTime('profile') - cueTime('achievements');
      at(cueTime('achievements') + local / 4.114 * duration, function (a, t) { a.chime(t, [72, 79, 84][i], 0.55); });
    });
    at(cueTime('profile'), function (a, t) { a.whoosh(t, 0.3, 0.4); });
    var socialStart = cueTime('achievements'), socialDuration = cueTime('modes') - socialStart;
    for (var k = 0; k < 6; k++) (function (i) {
      at(Math.max(cueTime('chat'), socialStart + (0.56 + i * 0.045) * socialDuration),
        function (a, t) { a.blip(t, [72, 75, 79][i % 3], 0.45); });
    })(k);
    at(socialStart + 0.95 * socialDuration, function (a, t) { a.blip(t, 79, 0.6); a.chime(t + 0.1, 84, 0.4); });
    for (k = 0; k < 8; k++) (function (i) {
      at(cueTime('modes', i / 8), function (a, t) { a.tick(t, 0.5); });
    })(k);
    for (k = 0; k < 8; k++) (function (i) {
      at(cueTime('skulls') + i * SPB / 2, function (a, t) { a.tick(t, 0.5); });
    })(k);
    [0, 0.25, 0.5].forEach(function (f) { at(cueTime('montage', f), function (a, t) { a.zap(t, 0.4, 0.3); }); });
    at(cueTime('menu'),function(a,t){a.consoleSwish(t,0.7);});
    ev.sort(function (a, b) { return a.t - b.t; });
    return ev;
  }

window.TetrisCinematicCuts={shortCues:shortCues,shortScore:shortScore};
})();
