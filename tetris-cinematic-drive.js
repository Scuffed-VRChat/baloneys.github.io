// Full-track highway, scenery, Tetris-mobile, and the fall into the hex dimension.
// Uses the cinematic's existing camera, scene planes, fixed-step Players, and audio clock.
// Chess scenery lives in tetris-cinematic-scenery.js. Car sprites are by Pay 'n' Sprite;
// the Tetris lights, scanner and night tint are rendering layers, not edits to the source PNGs.
(function () {
  'use strict';
  var Art = window.TetrisDriveArt;
  if (!Art) return;
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function mix(a, b, k) { return a + (b - a) * k; }
  function span(x, a, b) { return clamp((x - a) / (b - a)); }
  function smooth(x) { x = clamp(x); return x * x * (3 - 2 * x); }

  var GLSL = `
uniform float u_route;
uniform float u_routePhase;
uniform float u_portal;
uniform float u_lens;
uniform float u_extended;
${Art.sky}
vec3 driveRoad(vec3 dir){
  float az=atan(dir.x,-dir.z), el=asin(clamp(-dir.y,-1.0,1.0));
  vec3 sky=driveSky(dir);
  bool tunnel=u_route>1.5&&u_route<2.5;
  if(tunnel){
    sky=vec3(0.018,0.008,0.04);
    if(dir.y<-0.0005){
      float rt=(-1100.0-u_cpos.y)/dir.y; vec3 rp=u_cpos+dir*rt;
      float lamp=smoothstep(26.0,0.0,abs(mod(rp.z,1300.0)-650.0))*step(abs(rp.x),650.0);
      sky+=vec3(0.12,0.75,0.95)*lamp*exp(-rt/15000.0);
      sky+=vec3(0.12,0.025,0.2)*exp(-rt/7000.0);
    }
    if(abs(dir.x)>0.0005){
      float wall=(sign(dir.x)*950.0-u_cpos.x)/dir.x; vec3 wp=u_cpos+dir*wall;
      if(wall>0.0&&wp.y<0.0&&wp.y>-1100.0){
        float strip=exp(-abs(wp.y+200.0)*0.03)+exp(-abs(wp.y+800.0)*0.03);
        sky=vec3(0.035,0.015,0.07)+vec3(0.8,0.1,0.55)*strip*exp(-wall/12000.0);
        sky+=vec3(0.08,0.025,0.1)*step(0.94,fract(wp.z/1000.0));
      }
    }
  }
  if(dir.y<=0.0005) return sky;
  float t=-u_cpos.y/dir.y; if(t<0.0) return sky;
  vec3 p=u_cpos+dir*t;
  float coast=step(0.5,u_route)*step(u_route,1.5);
  float bend=sin(-p.z/10000.0)*330.0*coast;
  float dx=p.x-bend, rd=abs(dx), fade=exp(-t/16500.0);
  vec2 grid=abs(fract(p.xz/300.0)-0.5);
  float lines=smoothstep(0.477,0.5,max(grid.x,grid.y));
  vec3 floorCol=vec3(0.025,0.018,0.08)+vec3(0.35,0.08,0.46)*lines*fade;
  if(coast>0.5&&p.x<-650.0){
    float water=pow(0.5+0.5*sin(p.z*0.015+sin(p.x*0.008)+u_time),12.0);
    floorCol=vec3(0.035,0.05,0.16)+vec3(0.65,0.2,0.48)*water*fade*0.5;
    floorCol+=vec3(0.8,0.4,0.4)*exp(-abs(p.x+1800.0)/1600.0)*fade*0.08;
  }
  float road=1.0-smoothstep(380.0,395.0,rd);
  vec3 asphalt=vec3(0.022,0.017,0.045)+vec3(0.06,0.025,0.08)*exp(-t/5000.0);
  float dash=step(0.50,fract(p.z/550.0))*smoothstep(9.0,3.0,abs(dx));
  asphalt+=vec3(0.95,0.66,0.69)*dash*fade;
  asphalt+=vec3(0.15,0.5,0.7)*exp(-abs(dx)*0.007)*exp(-t/5000.0)*0.08;
  floorCol=mix(floorCol,asphalt,road);
  floorCol+=vec3(1.0,0.12,0.55)*exp(-abs(rd-390.0)*0.05)*fade*0.6;
  floorCol+=vec3(0.16,0.78,1.0)*exp(-abs(rd-405.0)*0.05)*fade*0.4;
  if(u_route>3.5&&u_route<4.5){
    float ahead=u_cpos.z-p.z;
    float brink=mix(4200.0,230.0,u_routePhase);
    vec2 cell=floor(p.xz/280.0);
    float loose=h2(cell);
    float missing=step(brink+loose*1100.0,ahead);
    floorCol=mix(floorCol,vec3(0.001,0.0,0.003),missing);
    floorCol+=vec3(0.7,0.13,1.0)*lines*missing*step(0.92,loose)*0.18;
  }
  if(tunnel) return floorCol*0.8;
  return mix(floorCol,sky,1.0-exp(-t/22000.0));
}
vec3 drivePortal(vec2 screen){
  float portalH=min(u_css.y,u_css.x/1.65);
  vec2 q=screen/portalH;
  q.y-=0.06*(1.0-u_portal);
  float k=clamp((u_portal-0.215)/0.785,0.0,1.0);
  float radius=0.032+u_portal*0.45+pow(smoothstep(0.965,1.0,k),2.0)*3.5;
  float rot=0.07*sin(u_time*0.5)*(1.0-k);
  mat2 m=mat2(cos(rot),-sin(rot),sin(rot),cos(rot)); q=m*q;
  vec3 col=vec3(0.001,0.0,0.003);
  vec2 box=abs(q)-vec2(radius*1.22,radius*1.04);
  float bd=max(box.x,box.y);
  col+=vec3(0.032,0.022,0.052)*(1.0-smoothstep(0.0,0.006,bd));
  col+=vec3(0.08,0.045,0.12)*exp(-abs(bd)*600.0)*(1.0-k);
  float h=hexd(q/radius);
  vec3 realm=world(normalize(vec3(q/radius*2.0,-1.0)));
  realm+=vec3(0.21,0.03,0.30)*exp(-length(q/radius)*1.4);
  float inside=1.0-smoothstep(0.85,0.87,h);
  col=mix(col,realm,inside);
  float px=1.5/portalH;
  float split=0.003+0.006*smoothstep(0.12,0.8,u_portal);
  for(int i=0;i<3;i++){
    float fi=float(i), edge=0.87+fi*0.055;
    float red=hexd((q+vec2(split,0.0))/radius), blue=hexd((q-vec2(split,0.0))/radius);
    col+=vec3(1.0,0.035,0.45)*exp(-abs(red-edge)*radius/(px*1.6))*(0.9-fi*0.15);
    col+=vec3(0.03,0.8,1.0)*exp(-abs(blue-edge)*radius/(px*1.6))*(0.9-fi*0.15);
    col+=vec3(0.5,0.15,0.9)*exp(-abs(h-edge)*radius/(px*6.0))*0.25;
  }
  float reveal=smoothstep(0.005,0.08,u_portal);
  return col*reveal;
}
`;

  function extendShader(source) {
    return source.replace('void main(){', GLSL + '\nvoid main(){')
      .replace('  vec3 cc=vec3(sp.x, sp.y, -u_P);', '  sp*=1.0+u_lens*dot(sp/u_css.y,sp/u_css.y)*0.75;\n  vec3 cc=vec3(sp.x, sp.y, -u_P);')
      .replace('else if (u_pat<1.5) c=road(dir);', 'else if (u_pat<1.5) { if(u_extended>0.5)c=driveRoad(dir);else c=road(dir); }')
      .replace('else c=warehouse(vec2(css.x-0.5*u_css.x, 0.5*u_css.y-css.y)/u_css.y);', 'else if (u_pat<3.5) c=warehouse(vec2(css.x-0.5*u_css.x, 0.5*u_css.y-css.y)/u_css.y);\n  else if (u_pat<5.5) c=driveRoad(dir);\n  else c=drivePortal(sp);');
  }

  var cachedArt = {};
  function propCanvas(kind) {
    if (cachedArt[kind]) return cachedArt[kind];
    var a = Art.props[kind], cv = document.createElement('canvas');
    cv.width = a.r[0].length; cv.height = a.r.length;
    var ctx = cv.getContext('2d');
    a.r.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (a.p[row[x]]) { ctx.fillStyle = a.p[row[x]]; ctx.fillRect(x, y, 1, 1); } });
    cachedArt[kind] = cv; return cv;
  }

  // An original fallback car. Body, roof, scanner, and T-shaped lights have
  // their own pixel layers, so steering and the scanner animate without filtering.
  function fallbackCar(front, turn, time) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    var c = cv.getContext('2d'), shift = Math.round(turn * 3);
    function r(x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
    r(12,43,15,16,'#080918'); r(101,43,15,16,'#080918');
    r(8,32,112,22,'#17162b'); r(12,27,104,8,'#28233d'); r(19,22,90,6,'#302c49');
    r(24+shift,13,80,13,'#201c39'); r(31+shift,8,66,6,'#4d3f66'); r(36+shift,5,56,4,'#bd72ad');
    r(30+shift,14,68,14,'#51869f'); r(34+shift,15,58,4,'#82b9c1'); r(34+shift,20,58,6,'#2b405e');
    r(12,33,104,3,'#66dce9'); r(8,46,112,3,'#725a9d'); r(17,50,94,6,'#34304c');
    r(21,51,86,2,'#b075c9'); r(54,43,20,7,'#0c0b1b'); r(59,44,10,4,'#a5e8e7');
    if (front) {
      r(14,36,28,6,'#eaf5dd'); r(86,36,28,6,'#eaf5dd'); r(45,36,38,6,'#080a16');
      var sx = 48 + Math.floor((0.5 + 0.5 * Math.sin(time * 4)) * 26);
      r(sx-4,37,12,3,'#6c1835'); r(sx,37,5,3,'#ff4664');
    } else {
      r(15,37,29,4,'#ef3d77'); r(24,40,10,4,'#ef3d77'); r(84,37,29,4,'#ef3d77'); r(94,40,10,4,'#ef3d77');
      r(17,37,24,1,'#ffa5aa'); r(88,37,22,1,'#ffa5aa'); r(45,27,38,3,'#bda2ce');
    }
    r(10,29,7,3,'#7cc8de'); r(111,29,7,3,'#7cc8de');
    r(14,53,8,3,'#9496b0'); r(106,53,8,3,'#9496b0');
    return cv;
  }

  var carImages = {};
  ['rear','front','left','right'].forEach(function(key){var img=new Image();img.src='tetris-drive-assets/car-'+key+'.png';carImages[key]=img;});
  function carCanvas(front,turn,time){
    var key=front?'front':turn<-0.25?'left':turn>0.25?'right':'rear', img=carImages[key];
    if(!img.complete||!img.naturalWidth)return fallbackCar(front,turn,time);
    var cv=document.createElement('canvas');cv.width=128;cv.height=64;
    var c=cv.getContext('2d');c.imageSmoothingEnabled=false;c.filter='brightness(0.68) saturate(0.65)';
    c.drawImage(img,0,8,64,48,0,0,128,64);c.filter='none';
    c.fillStyle='#4acde3';c.fillRect(22,49,84,1);
    c.fillStyle='#c48ade';c.fillRect(57,39,14,2);c.fillRect(62,41,4,5);
    if(front){
      var x=51+Math.round((0.5+0.5*Math.sin(time*4))*22);
      c.fillStyle='#6c1835';c.fillRect(x-4,32,12,2);c.fillStyle='#ff4664';c.fillRect(x,32,4,2);
    }else{
      c.fillStyle='#ff486e';c.fillRect(14,30,20,3);c.fillRect(21,33,6,3);c.fillRect(94,30,20,3);c.fillRect(101,33,6,3);
    }
    return cv;
  }

  function profileCar(){
    var cv=document.createElement('canvas');cv.width=128;cv.height=64;var c=cv.getContext('2d');
    function r(x,y,w,h,col){c.fillStyle=col;c.fillRect(x,y,w,h);}
    r(8,34,112,13,'#18223a');r(15,29,99,8,'#24415c');r(44,20,42,10,'#355b74');r(49,17,30,4,'#8cc6dc');
    r(45,22,37,9,'#0d142b');r(18,37,95,2,'#58d0e4');r(11,43,105,3,'#784e94');r(111,34,9,3,'#fff1cf');r(8,33,5,4,'#ff4e88');
    [30,95].forEach(function(x){c.fillStyle='#060914';c.beginPath();c.arc(x,46,10,0,Math.PI*2);c.fill();c.fillStyle='#667694';c.beginPath();c.arc(x,46,5,0,Math.PI*2);c.fill();r(x-1,41,2,10,'#b7b5ce');});
    r(60,33,14,2,'#d08ae0');r(65,35,4,6,'#d08ae0');return cv;
  }

  var RAIN_SHAPES=[[[0,0],[1,0],[2,0],[3,0]],[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[2,0],[1,1]],[[1,0],[2,0],[0,1],[1,1]],[[0,0],[1,0],[1,1],[2,1]],[[0,0],[0,1],[1,1],[2,1]],[[2,0],[0,1],[1,1],[2,1]]];
  var CITY_SHAPES=[[[0,0],[0,1],[0,2],[0,3]],[[0,0],[1,0],[0,1],[1,1]],[[0,0],[0,1],[0,2],[1,1]],[[0,0],[0,1],[1,1],[1,2]],[[1,0],[1,1],[0,1],[0,2]],[[0,0],[0,1],[0,2],[1,2]],[[1,0],[1,1],[1,2],[0,2]]];
  function mod(x,n){return ((x%n)+n)%n;}
  // Side-view street, drawn on a small pixel canvas. All layers scroll right,
  // matching the requested car direction; nearby rooftops move fastest.
  function cityStreet(c,t,w,h,foreground){
    function r(x,y,ww,hh,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.ceil(ww),Math.ceil(hh));}
    if(foreground){
      var roofCell=Math.max(18,Math.round(h*.12)),roofSlot=roofCell*4.8,roofScroll=t*h*.48;
      var roofTurn=Math.floor(roofScroll/roofSlot),roofOffset=mod(roofScroll,roofSlot);
      for(var q=-1;q<Math.ceil(w/roofSlot)+1;q++){
        var id=q-roofTurn,shape=CITY_SHAPES[mod(id,7)],ox=q*roofSlot+roofOffset;
        shape.forEach(function(p){
          var x=ox+p[0]*roofCell,y=h*(.93+mod(id,3)*.012)+p[1]*roofCell*.18,deep=roofCell*.28;
          r(x,y,roofCell,h-y,'#080b19');
          c.fillStyle='#14182d';c.beginPath();c.moveTo(Math.round(x),Math.round(y));c.lineTo(Math.round(x+deep),Math.round(y-deep*.5));c.lineTo(Math.round(x+roofCell+deep),Math.round(y-deep*.5));c.lineTo(Math.round(x+roofCell),Math.round(y));c.closePath();c.fill();
          r(x+2,y,roofCell-3,1,'#29314c');
        });
      }
      return;
    }
    var haze=c.createLinearGradient(0,h*.46,0,h*.70);haze.addColorStop(0,'#472b50');haze.addColorStop(1,'#17172e');
    c.fillStyle=haze;c.fillRect(0,Math.floor(h*.48),w,Math.ceil(h*.25));
    function buildings(base,cell,speed,far){
      var slot=cell*4,scroll=t*h*speed,turn=Math.floor(scroll/slot),offset=mod(scroll,slot);
      for(var i=-1;i<Math.ceil(w/slot)+1;i++){
        var id=i-turn,shape=CITY_SHAPES[mod(id,7)],x=i*slot+offset;
        var rows=1+Math.max.apply(null,shape.map(function(p){return p[1];})),top=base-rows*cell;
        var colors=far?['#392b57','#352b50','#26364d']:['#623451','#304d66','#51406b'];
        var front=colors[mod(id,colors.length)],edge=far?'#674368':mod(id,2)?'#67b7ca':'#e181b9';
        shape.forEach(function(p){
          var bx=Math.round(x+p[0]*cell),by=Math.round(top+p[1]*cell),d=Math.max(2,Math.round(cell*.16));
          r(bx+d,by-d,cell,cell,'#202439');
          r(bx,by,cell,cell,front);
          r(bx,by,cell,1,edge);r(bx,by,1,cell,edge);
          r(bx+cell-2,by,2,cell,far?'#2b2544':'#25283d');r(bx,by+cell-2,cell,2,'#211a34');
          if(!far){
            for(var wy=1;wy<5;wy++)for(var wx=1;wx<4;wx++){
              if(mod(id+wy*3+wx*5+p[1],5)===0)continue;
              r(bx+wx*cell*.22,by+wy*cell*.16,cell*.085,cell*.045,mod(id+wx,3)?'#72baca':'#ed8fbc');
            }
            // Art-deco light bands keep the facades legible as joined Tetris cells.
            r(bx+2,by+cell*.80,cell-5,1,edge);
          }
        });
      }
    }
    buildings(h*.61,Math.max(11,Math.round(h*.045)),.045,true);
    buildings(h*.69,Math.max(18,Math.round(h*.076)),.16,false);
    r(0,h*.69,w,h*.022,'#41405a');r(0,h*.69,w,1,'#efa0c1');
    var asphalt=c.createLinearGradient(0,h*.71,0,h);asphalt.addColorStop(0,'#14172b');asphalt.addColorStop(1,'#0b1020');
    c.fillStyle=asphalt;c.fillRect(0,Math.round(h*.712),w,h);
    r(0,h*.719,w,1,'#39798c');r(0,h*.914,w,1,'#c56eab');
    var dash=Math.max(24,h*.14),offset=mod(t*h*.31,dash*2);
    for(var x=-dash*2+offset;x<w;x+=dash*2)r(x,h*.825,dash,1,'#baadc7');
    // Pixel palms along the opposite sidewalk, between the block facades.
    var palmSlot=h*.48,palmOffset=mod(t*h*.16,palmSlot);
    for(var px=-palmSlot+palmOffset;px<w;px+=palmSlot){
      var py=h*.695,ph=h*.19;c.strokeStyle='#172839';c.lineWidth=Math.max(2,h*.009);c.beginPath();c.moveTo(px,py);c.lineTo(px+ph*.12,py-ph);c.stroke();
      var crownX=px+ph*.12,crownY=py-ph;
      for(var f=0;f<6;f++){
        var a=(f-2.5)*.48;c.strokeStyle=f%2?'#31506b':'#28435d';c.lineWidth=Math.max(2,h*.008);c.beginPath();c.moveTo(crownX,crownY);c.lineTo(crownX+Math.sin(a)*ph*.46,crownY-Math.cos(a)*ph*.15);c.lineTo(crownX+Math.sin(a)*ph*.70,crownY+ph*.07);c.stroke();
      }
    }
  }
  function tetrominoRain(ctx,t,w,h,beat){
    var count=w<620?15:30,colors=['#74cbe0','#b18cdb','#e28ab9','#a092df'];
    var whole=Math.floor(beat),phase=beat-whole,burst=Math.min(1,phase/0.22);
    var fallBeat=whole+1-Math.pow(1-burst,3);
    ctx.save();ctx.imageSmoothingEnabled=false;
    for(var i=0;i<count;i++){
      var seed=((i*613)%997)/997,depth=((i*43)%97)/97;
      var fall=((seed+fallBeat*(0.07+depth*0.08))%1+1)%1;
      var x=((seed*w*1.9+t*(12+depth*28))%(w+120))-60,y=-90+fall*(h+180);
      var cell=(w<620?4:7)+depth*(w<620?5:14);
      ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.rotate(Math.sin(t*.28+i)*.18);
      ctx.globalAlpha=.16+depth*.26;ctx.fillStyle=colors[i%colors.length];
      RAIN_SHAPES[i%7].forEach(function(p){ctx.fillRect(Math.round(p[0]*cell),Math.round(p[1]*cell),Math.round(cell-1),Math.round(cell-1));});ctx.restore();
    }ctx.restore();
  }

  function create(api) {
    var C = api.state, S, props = [], dashboard, carLayer = document.createElement('canvas'),cityLayer=document.createElement('canvas');
    carLayer.width = 128; carLayer.height = 64;
    var drive = { scene: 'dusk', car: 1, dash: 0, turn: 0, front: false, u: 0, view:'rear', x:0.5, y:0.75, scale:1, fallback: false,city:false,backgroundDirection:'toward',rendered:false,renderAngle:0 };
    function camera(t, u, speed, route) {
      C.route = route || 0; C.routePhase = u; C.portal = 0;
      var c = C.cam, z = -t * speed;
      var bend = route === 1 ? Math.sin(-z / 10000) * 330 : 0;
      c.x = bend + Math.sin(t * 0.6) * 35; c.y = -230; c.z = z + 800;
      c.roll = route === 1 ? Math.sin(t * 0.7) * 4 : Math.sin(t * 0.4) * 1.2;
      c.fov = 58 + Math.min(18, speed / 110); api.lookAt(bend, -170, z - 2600);
      C.speed = Math.min(0.18, speed / 16000); C.streaks = C.speed * 0.18;
      drive.turn = Math.sin(t * 0.6) * 0.45;
    }
    function scenery(t, route) {
      var c = C.cam;
      props.forEach(function (it, i) {
        var temple = route === 3, coast = route === 1, visible = temple ? it.kind.indexOf('col') === 0 || it.kind === 'temple' || it.kind === 'ruin' : coast ? ['dolphin','flamingo','beachball','swimring'].indexOf(it.kind) >= 0 : it.kind === 'arcade';
        it.op = visible ? 1 : 0;
        var motion=drive.front?1:-1;
        var distance = temple ? 700 + mod(Math.floor(it.slot/2)*1450+motion*t*950,8200) : 800 + mod(it.slot*1500+motion*t*850,6500);
        it.z = c.z - distance;
        it.x = it.side * (temple ? 820 : 1050) + (it.side > 0 ? 0 : -180);
        it.y = -it.h * it.s / 2;
        if (it.kind === 'temple') { it.x=0; it.z=c.z-(8500-C.routePhase*7000); }
        if (it.kind === 'dolphin') { it.y -= 280 + Math.sin(t * 0.8) * 100; it.x = -1350; }
        it.ry = -c.yaw; it.rz = it.kind === 'dolphin' ? Math.sin(t) * 8 : 0;
      });
    }
    function update(kind, t, lt, u) {
      drive.scene = kind; drive.u = u; drive.car = 1; drive.dash = 0; drive.front = false;
      drive.view='rear';drive.x=.5;drive.y=.75;drive.scale=1;drive.city=false;drive.backgroundDirection='toward';
      C.lens = 0; api.hideLogo();
      if (kind === 'dusk') {
        camera(t, u, 65, 0); C.cam.fov = 45; C.speed = 0.02;
        drive.car = 0.6; drive.front = true;
        if (u > 0.25 && u < 0.8) api.caption('TETRIS', 'a night drive · tetronimo$'); else api.caption();
      } else if (kind === 'ignition') {
        camera(t, u, 140 + u * u * 1000, 0);
        C.env=smooth(span(lt,0,.75));drive.car=C.env;
        if(u<.30){drive.front=true;drive.scale=1.55;drive.y=.67;C.cam.fov=44;}
        else if(u<.66){drive.dash=smooth(span(u,.30,.36))*(1-smooth(span(u,.60,.66)));drive.car=.18;C.cam.fov=52;}
        else{var q=span(u,.66,1);drive.view='profile';drive.x=mix(.12,.82,smooth(q));drive.scale=1.1;C.cam.yaw=mix(-12,12,q);C.cam.roll=0;}
        C.lens = smooth(span(u, 0.8, 1)) * 0.14; api.caption();
      } else if (kind === 'highway') {
        camera(t, u, 1600, 0); C.cam.fov = 76 + 8 * Math.sin(Math.PI * u); C.lens = 0.10 + Math.pow(1-u,3)*0.35;
        if(u>.30&&u<.54){drive.view='wheel';drive.x=.23;drive.scale=2;C.cam.y=-110;C.cam.fov=68;}
        else if(u>=.54&&u<.8){drive.front=true;drive.x=mix(.3,.66,span(u,.54,.8));drive.scale=1.12;C.cam.yaw=Math.sin(t*.5)*8;}
        else if(u>=.8){drive.view='roof';drive.scale=.85;drive.y=.67;C.cam.y=-1100;api.lookAt(C.cam.x,-40,C.cam.z-2200);C.cam.fov=56;}
        C.speed = 0.08 + 0.5*Math.pow(1-u,8); C.streaks = 0.04 + 0.18*Math.pow(1-u,8);
      } else if (kind === 'tunnel') {
        camera(t, u, 850, 2); C.cam.fov = 56; C.speed = 0.12; C.streaks = 0;
        drive.front=true;drive.scale=1.35;drive.y=.7;C.cam.y=-130;
      } else if (kind === 'temple') {
        camera(t,u,1450,3); C.cam.fov = 70; C.cam.roll = Math.sin(t*0.65)*5; C.lens=0.12;
        if(u<.34){drive.view='profile';drive.x=mix(.22,.72,smooth(u/.34));drive.scale=1.1;C.cam.yaw=Math.sin(t*.3)*12;}
        else if(u<.68){drive.view='roof';drive.y=.63;drive.scale=.8;C.cam.y=-900;api.lookAt(0,-100,C.cam.z-2100);C.cam.fov=57;}
        else{drive.view='bonnet';drive.y=1.02;drive.scale=2.5;C.cam.y=-210;C.cam.fov=74;}
      } else if (kind === 'collapse') {
        camera(t,u,1900,4); C.cam.fov=74+u*12; C.lens=0.14+u*0.22;
        C.speed=0.12+u*0.3; C.streaks=0.08+u*0.15; drive.turn=Math.sin(t*1.3)*0.8;
      } else if (kind === 'fall') {
        drive.view='profile';
        C.route=0; C.portal=0.015+u*0.2; C.lens=0.05+u*0.08; C.speed=0; C.streaks=0;
        C.cam.x=0; C.cam.y=0; C.cam.z=1000; C.cam.fov=62; C.cam.roll=0; api.lookAt(0,0,-1000);
        props.forEach(function(it){it.op=0;});
      } else if (kind === 'portal') {
        drive.view='profile';
        C.portal=0.215+u*0.785; C.lens=0.12+u*u*0.48; C.speed=Math.pow(u,8)*0.4; C.streaks=Math.pow(u,6)*0.15;
        C.cam.x=0; C.cam.y=0; C.cam.z=1000; C.cam.fov=65+u*23; C.cam.roll=0; api.lookAt(0,0,-1000);
        props.forEach(function(it){it.op=0;});
      } else if (kind === 'home') {
        camera(t,u,230*(1-u)+35,0); C.cam.fov=56; C.speed=0; C.streaks=0; drive.car=0.65;
      }
      if (kind !== 'fall' && kind !== 'portal') {
        // A front-facing car needs the inverse road flow. The camera's orientation
        // is already set, so reflecting its longitudinal position reverses travel
        // without turning the sky upside down or changing the car sprite.
        if(drive.front){C.cam.z=1600-C.cam.z;drive.backgroundDirection='away';}
        drive.city=drive.view==='profile'||drive.view==='wheel';
        if(drive.city){C.cam.yaw=0;C.cam.pitch=0;C.cam.roll=0;drive.backgroundDirection='right';}
        scenery(t,C.route);
        if(drive.city)props.forEach(function(it){it.op=0;});
      }
    }
    function install(shots) {
      S=shots;
      S.dusk={pat:4,build:function(g){
        ['arcade','arcade','colPinkIvy','colMintIvy','colBlueIvy','colPinkIvy','colMintIvy','colBlueIvy','colPinkIvy','colMintIvy','colBlueIvy','colPinkIvy','ruin','temple'].forEach(function(kind,i){
          var cv=propCanvas(kind), scale=kind==='temple'?12:kind==='arcade'?6:kind.indexOf('col')===0?12:8;
          var it=api.plane(g,cv,cv.width*scale,cv.height*scale,{cull:true,op:0});
          it.kind=kind;it.slot=i+1;it.side=i%2?1:-1;props.push(it);
        });
        dashboard=api.makePlayer({name:'TETRIS-MOBILE',warm:8,stack:10,speed:1.2});
        // The dashboard is filmed too, so its locks share the beat-timed replay.
        var b=api.boardPlane(g,dashboard,{x:0,y:0,z:0,op:0}); b.visible=false;
      },update:function(t,lt,u){update('dusk',t,lt,u);}};
      ['ignition','highway','tunnel','temple','collapse','fall','portal','home'].forEach(function(kind){
        S[kind]={pat:kind==='fall'||kind==='portal'?6:kind==='tunnel'?5:4,update:function(t,lt,u){update(kind,t,lt,u);}};
      });
      S.ignition.build=S.dusk.build;
      var buildRoad=S.road.build;
      S.road.build=function(g){
        buildRoad(g);
        ['dolphin','flamingo','beachball','swimring'].forEach(function(kind,i){
          var cv=propCanvas(kind),it=api.plane(g,cv,cv.width*8,cv.height*8,{cull:true,op:0});
          it.kind=kind;it.slot=i+1;it.side=i%2?1:-1;props.push(it);
        });
      };
      // Reuse the actual gameplay close-up and CPU billboards, with the coast
      // sky instead of switching to space before the portal has been crossed.
      ['road','gameplay','clear'].forEach(function(id){
        var base=S[id].update;S[id].pat=1;
        S[id].update=function(t,lt,u,dt){base(t,lt,u,dt);C.route=1;C.routePhase=u;C.lens=id==='road'?0.07:0;C.portal=0;drive.scene=id;drive.u=u;drive.dash=0;drive.view='rear';drive.x=.5;drive.y=.78;drive.scale=1;drive.city=false;drive.backgroundDirection='toward';drive.car=id==='road'?1-smooth(span(u,0.55,0.86)):0;drive.front=false;scenery(t,1);};
      });
      // Home and the social run share the same sunset, while the real profile,
      // messages and invite remain the existing game UI rather than new facsimiles.
      ['achievements','profile','chat','friends'].forEach(function(id){
        var base=S[id].update;S[id].pat=4;
        S[id].update=function(t,lt,u,dt){base(t,lt,u,dt);C.route=0;C.routePhase=0;C.portal=0;C.lens=0;drive.scene=id;drive.car=0;drive.dash=0;};
      });
      var menuBase=S.menu.update;S.menu.pat=4;
      S.menu.update=function(t,lt,u,dt){menuBase(t,lt,u,dt);C.route=0;C.portal=0;C.lens=0;drive.scene='menu';drive.car=0;drive.dash=0;};
    }
    function draw(ctx,t,shot){
      var w=innerWidth,h=innerHeight,id=shot.id;
      drive.rendered=false;drive.renderAngle=0;
      var roadIds=['dusk','ignition','highway','road','tunnel','showcase','temple','collapse','fall','portal','home'];
      var inRoad=roadIds.indexOf(id)>=0;
      // The car belongs to the road and the fall into the portal, never cyberspace.
      if(!inRoad)return;
      function cityPass(foreground){
        var cw=Math.ceil(w/3),ch=Math.ceil(h/3);
        if(cityLayer.width!==cw||cityLayer.height!==ch){cityLayer.width=cw;cityLayer.height=ch;}
        var cc=cityLayer.getContext('2d');cc.clearRect(0,0,cw,ch);cityStreet(cc,t,cw,ch,foreground);
        ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(cityLayer,0,0,w,h);ctx.restore();
      }
      if(drive.city)cityPass(false);
      if(inRoad&&id!=='fall'&&id!=='portal')tetrominoRain(ctx,t,w,h,api.beatAt(t));
      var u=drive.u, alpha=drive.car;
      // Height-based sizing preserves the framing on 2560x1080 / 3440x1440.
      // Extra ultrawide width reveals more street instead of shrinking the car.
      var size=Math.min(w*.25,h*(460/1080))*(drive.scale||1), x=w*(drive.x||.5), y=h*(drive.y||.75), angle=0;
      if(id==='dusk'){size*=0.6;x=w*0.68;y=h*0.72;}
      if(id==='fall'){size*=mix(0.85,0.32,u);x=w/2;y=mix(-size*.75,h*.56,u*u);angle=-Math.PI/2;}
      if(id==='portal'){size*=mix(0.32,0.06,smooth(u));y=mix(h*.56,h*.51,smooth(u));alpha*=1-smooth(span(u,.65,.85));angle=-Math.PI/2;}
      if(id==='home'){size*=0.7;x=w*0.65;y=h*0.78;}
      if(alpha>0.01){
        drive.rendered=true;drive.renderAngle=angle;drive.renderPosition={x:x,y:y,size:size};
        var art=drive.view==='profile'||drive.view==='wheel'?profileCar():carCanvas(drive.front,drive.turn,t);
        ctx.save();ctx.imageSmoothingEnabled=false;ctx.globalAlpha=alpha;ctx.translate(x,y);ctx.rotate(angle);
        if(id!=='fall'&&id!=='portal'){
          ctx.fillStyle='rgba(15,4,28,.48)';ctx.beginPath();ctx.ellipse(0,size*.18,size*.47,size*.05,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='rgba(150,30,190,.18)';ctx.fillRect(-size*.36,size*.13,size*.72,size*.08);
        }
        if(drive.view==='roof'){
          ctx.fillStyle='#14243b';ctx.fillRect(-size*.29,-size*.43,size*.58,size*.87);ctx.fillStyle='#6093aa';ctx.fillRect(-size*.23,-size*.24,size*.46,size*.21);ctx.fillStyle='#6bd3e3';ctx.fillRect(-size*.3,-size*.4,size*.6,3);ctx.fillStyle='#ce8bd8';ctx.fillRect(-size*.08,size*.14,size*.16,3);
        }else if(drive.view==='bonnet'){
          ctx.fillStyle='#142039';ctx.beginPath();ctx.moveTo(-size*.5,size*.25);ctx.lineTo(-size*.3,-size*.25);ctx.lineTo(size*.3,-size*.25);ctx.lineTo(size*.5,size*.25);ctx.fill();ctx.strokeStyle='#58cfe3';ctx.stroke();
        }else ctx.drawImage(art,-size/2,-size/4,size,size/2);
        ctx.restore();
      }
      if(drive.city)cityPass(true);
      if(id==='collapse'){
        ctx.save();ctx.imageSmoothingEnabled=false;
        for(var i=0;i<18;i++){
          var phase=(t*.7+i*.618)%1, xx=(i*151%997)/997*w, yy=h*.52+phase*h*.52;
          var s=3+phase*15;ctx.fillStyle=i%2?'#8b52b2':'#3cb4d3';ctx.globalAlpha=drive.u*.6;
          ctx.fillRect(xx,yy,s,s*.5);
        }ctx.restore();
      }
      if(drive.dash>0.01&&dashboard){
        api.drawPlayer(dashboard);
        var ph=Math.min(h*.78,w*.95),pw=ph*0.84,bx=(w-pw)/2,by=(h-ph)/2;
        ctx.save();ctx.globalAlpha=drive.dash;ctx.fillStyle='rgba(5,5,17,.92)';ctx.fillRect(bx-22,by-18,pw+44,ph+36);
        ctx.strokeStyle='#6cd3e9';ctx.lineWidth=2;ctx.strokeRect(bx-22,by-18,pw+44,ph+36);
        ctx.imageSmoothingEnabled=false;ctx.drawImage(dashboard.ui.canvas,bx,by,pw,ph);
        ctx.restore();
      }
    }
    return {install:install,draw:draw,update:update,state:drive};
  }
  window.TetrisCinematicDrive={extendShader:extendShader,create:create};
})();
