// Extended-cut gameplay demonstrations. Boards and powers use the actual Player
// rules; only their setup and inputs are choreographed to the soundtrack.
(function(){
  'use strict';
  function create(api){
    var C=api.state,K=api.K,App=api.App,players=[],cards=[],pending=[],expires=[];
    var lastActor=0,lastBeat=null,lastTime=0,lastShot='',pulse=null,root=null,pop=null,popIcon=null,popName=null,popBody=null;
    var powerList=K.powerSkulls||[],byKind={},mods=['noGhost','noHold','blind','birthday'];
    var skulls=App.skulls(),skullById={};skulls.forEach(function(s){skullById[s.id]=s;});
    powerList.forEach(function(p){byKind[p.kind]=p;});
    var stats={clears:0,failedClears:0,powers:{},freeze:0,shell:0,curse:0,history:[]};
    var roadShots=['highway','road','tunnel','showcase','temple','collapse'];
    var descriptions={pStreak:'STREAK TIMER ×2',pSlow:'SLOW TIME · 10 s',pDouble:'DOUBLE POINTS · 15 s',pQuake:'BOTTOM TWO ROWS DROP',pBomb:'ROW + COLUMN BLAST',pStarBomb:'SIX JUNK BLOCKS',pFreeze:'OPPONENT FROZEN · 3.5 s',pShell:'LEADER GETS THREE GARBAGE ROWS',pCurse:'SKULL → HASTE'};
    function element(tag,cls,parent){var e=document.createElement(tag);e.className=cls||'';if(parent)parent.appendChild(e);return e;}
    function clamp(v){return Math.max(0,Math.min(1,v));}
    function metadata(index){return powerList[((index%powerList.length)+powerList.length)%powerList.length];}
    function build(){
      root=element('div','cine-feature-boards',C.stage);root.hidden=true;
      var count=innerWidth<620?2:3;
      for(var i=0;i<count;i++){
        var p=api.makePlayer({name:['DRIVER','BLOCKY','LUNAR'][i],versus:true,level:null,streaks:true});
        p.noBake=true;p.scripted=true;p.cpu=null;players.push(p);expires.push({});
        var card=element('div','panel board-card cine-feature-player',root),head=element('div','board-head cine-feature-head',card);
        element('span','',head).textContent=p.name;
        var label=element('span','cine-feature-skull',head);
        card.appendChild(p.ui.canvas);p.ui.canvas.classList.add('cine-feature-canvas');
        p.ui.stats.className='board-stats cine-feature-stats';card.appendChild(p.ui.stats);
        p.ui.timers.className='hud-timers cine-feature-timers';card.appendChild(p.ui.timers);
        cards.push({node:card,label:label});pending.push(null);
        prepare(i,i,0);
      }
      pop=element('div','panel cine-feature-power',C.stage);pop.hidden=true;
      popIcon=element('div','cine-feature-icon',pop);var words=element('div','cine-feature-words',pop);
      popName=element('div','cine-feature-power-name',words);popBody=element('div','cine-feature-power-body',words);
    }
    function applySkulls(p,i,beat,power){
      skulls.forEach(function(s){p.f[s.id]=false;});
      var id=mods[(Math.floor(beat/4)+i)%mods.length],mod=skullById[id];
      p.f[id]=true;p.f[power.id]=true;p.f.noStreaks=false;
      p.skulls=[id,power.id];p.powerKinds=[power.kind];p.multiplier=1+(mod?mod.eff:0);
      p.hold=p.f.noHold?null:'T';p.canHold=!p.f.noHold;
      var label=cards[i].label;label.textContent='';label.appendChild(App.skullIcon(id));
      var text=document.createElement('span');text.textContent=(mod?mod.name:id)+' + '+power.name;label.appendChild(text);
    }
    function prepare(i,beat,t){
      var p=players[i],power=metadata(beat),rows=beat%4===3?4:1;
      applySkulls(p,i,beat,power);
      p.board=[];
      for(var r=0;r<K.ROWS;r++){
        var row=new Array(K.COLS).fill(0);
        if(r>=K.ROWS-rows)for(var x=0;x<K.COLS-1;x++)row[x]=1+((x+r+i)%7);
        else if(r>=K.ROWS-6)for(x=0;x<7;x++)if((x+r+beat)%4!==0)row[x]=1+((x+r)%7);
        p.board.push(row);
      }
      p.board[K.ROWS-1][4]=K.cellPowerBase+power.kind-1;
      var cursed=p.pendingCurses>0;if(cursed)p.pendingCurses--;
      p.piece={type:'I',rot:1,x:7,y:-1,power:cursed?K.powerTypes.SKULL:0,powerCell:3};
      p.scripted=true;p.alive=true;p.eliminated=false;p.fall=0;p.lockTimer=0;
      pending[i]={beat:beat,prepared:t,power:power,rows:rows};
    }
    function displayPower(p,res,t){
      var kinds=res.clearedPowers||[],info=byKind[kinds[0]];
      if(!res.cleared)return;
      pulse={at:t,info:info,rows:res.cleared};popIcon.textContent='';
      if(info)popIcon.appendChild(App.skullIcon(info.id));
      popName.textContent=info?info.name.toUpperCase():res.tetris?'TETRIS!':'LINE CLEAR';
      popBody.textContent=info?(descriptions[info.id]||info.body):res.cleared+' rows · streak '+p.streak+'×';
      if(api.audio.on&&api.audio.ctx){var now=api.audio.ctx.currentTime+0.003;api.audio.chime(now,info&&info.cat==='attack'?75:72,0.35);}
    }
    function lockBeat(beat,t){
      var i=((beat%players.length)+players.length)%players.length;
      if(players[i].frozen>0){var free=players.findIndex(function(p){return p.frozen<=0;});if(free>=0)i=free;}
      lastActor=i;var p=players[i];if(!pending[i])prepare(i,beat,t-0.5);
      p.piece.y=16;
      var res=p.lock();p.scripted=true;
      stats.clears++;if(!res.cleared)stats.failedClears++;
      (res.clearedPowers||[]).forEach(function(kind){stats.powers[kind]=(stats.powers[kind]||0)+1;});
      if(p.slow>0)expires[i].slow=t+p.slow;if(p.double>0)expires[i].double=t+p.double;
      if(p.haste>0)expires[i].haste=t+p.haste;
      var target=(i+1)%players.length,other=players[target],out=res.out||{};
      if(out.freeze){other.frozen=K.powerEffects.freeze;expires[target].frozen=t+K.powerEffects.freeze;stats.freeze++;}
      if(out.shell){
        var leader=players.filter(function(candidate){return candidate!==p;}).sort(function(a,b){return b.score-a.score;})[0];
        leader.addGarbage(K.powerEffects.shell*out.shell);stats.shell++;
      }
      if(out.curse){other.pendingCurses+=out.curse;stats.curse++;}
      cards[i].node.classList.add('clearing');cards[i].clearUntil=t+0.25;
      var star=powerList.find(function(info){return info.id==='pStarBomb';});
      cards[i].nextAt=t+(star&&(res.clearedPowers||[]).indexOf(star.kind)>=0?1.6:0.38);cards[i].nextBeat=beat+players.length;
      pending[i]=null;
      displayPower(p,res,t);
      stats.history.push({beat:beat,t:t,player:i,rows:res.cleared,powers:(res.clearedPowers||[]).slice(),out:out});
      if(stats.history.length>128)stats.history.shift();
    }
    function update(t,shot){
      var active=roadShots.indexOf(shot.id)>=0&&t>=api.cueTime('highway')&&t<api.cueTime('fall');
      var wide=shot.id==='showcase';root.hidden=!active;
      root.classList.toggle('cine-feature-mini',!wide);
      if(active){
        var beat=Math.max(0,Math.floor(api.beatAt(t)+1e-8));
        if(lastBeat==null){players.forEach(function(p,i){prepare(i,beat+((i-beat%players.length+players.length)%players.length),t-0.5);cards[i].nextAt=null;});}
        players.forEach(function(p,i){
          Object.keys(expires[i]).forEach(function(key){p[key]=Math.max(0,expires[i][key]-t);});
          if(cards[i].nextAt!=null&&t>=cards[i].nextAt){prepare(i,cards[i].nextBeat,t);cards[i].nextAt=null;}
          if(pending[i]&&p.frozen<=0){
            var phase=((t-api.cueTime('highway'))/(60/77))%1;
            p.piece.y=Math.floor(-1+17*Math.pow(clamp(phase),p.f.heavy?0.55:1.2));
          }
          p.elapsed=t;p.flash=Math.max(0,p.flash-Math.max(0,t-lastTime));
          cards[i].node.classList.toggle('clearing',t<(cards[i].clearUntil||0));
          cards[i].node.hidden=!wide&&i!==beat%players.length;
        });
        if(lastBeat==null||beat!==lastBeat){lockBeat(beat,t);lastBeat=beat;}
        cards.forEach(function(card,i){card.node.hidden=!wide&&i!==lastActor;});
        players.forEach(api.drawPlayer);
      }else lastBeat=null;
      if(pulse){
        var age=t-pulse.at;pop.hidden=age<0||age>0.72;
        pop.style.opacity=String(clamp((0.72-age)/0.12));
        pop.classList.toggle('cine-feature-power-wide',wide);
      }
      if(lastShot!==shot.id&&!active&&pulse&&t-pulse.at>0.72)pop.hidden=true;
      lastShot=shot.id;lastTime=t;
    }
    function install(S){
      S.showcase={pat:5,build:build,update:function(t,lt,u){
        api.drive.update('tunnel',t,lt,u);C.speed=0.04;C.streaks=0;C.lens=0;C.cam.fov=56;
        api.drive.state.dash=0;
      }};
    }
    function notify(p,res){
      if(!root||p.bakeJob||!C.running||!res.cleared)return;
      if(!root.hidden)return;
      displayPower(p,res,C.t);
    }
    return {install:install,update:update,notify:notify,stats:stats,players:players};
  }
  window.TetrisCinematicFeatures={create:create};
})();
