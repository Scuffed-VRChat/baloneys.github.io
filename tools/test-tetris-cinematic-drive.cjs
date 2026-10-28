// Run with Node; no browser dependencies. Real browser screenshot checks cover shaders/art.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=process.argv[2]||path.join(__dirname,'..','tetris-cinematic-drive.js');
function context(canvas){
 return {canvas,rects:[],images:[],fillStyle:'',save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},ellipse(){},translate(){},rotate(){},strokeRect(){},
  fillRect(x,y,w,h){this.rects.push({x,y,w,h,color:this.fillStyle});},clearRect(){this.rects=[];},
  createLinearGradient(){return {addColorStop(){}};},
  drawImage(source,...args){this.images.push({width:source.width,height:source.height,args,rects:source.ctx?source.ctx.rects.map(r=>({...r})):[]});}
 };
}
const sandbox={window:{TetrisDriveArt:{sky:'',props:{}}},innerWidth:2560,innerHeight:1080,
 Image:class{constructor(){this.complete=false;this.naturalWidth=0;}},
 document:{createElement(){const c={width:0,height:0};c.ctx=context(c);c.getContext=()=>c.ctx;return c;}}
};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
const state={cam:{x:0,y:0,z:0,yaw:0,pitch:0,roll:0}},api={state,lookAt(){},hideLogo(){},caption(){},beatAt:t=>(t-24.965)/(60/77)};
const drive=sandbox.window.TetrisCinematicDrive.create(api);
drive.update('ignition',14,1.5,.12);const front=state.cam.z;
drive.update('ignition',14.08,1.58,.127);assert.ok(state.cam.z>front);assert.equal(drive.state.backgroundDirection,'away');
drive.update('highway',27,2.035,.16);const rear=state.cam.z;
drive.update('highway',27.08,2.115,.17);assert.ok(state.cam.z<rear);assert.equal(drive.state.backgroundDirection,'toward');
function city(t){drive.update('ignition',t,t-12.5,(t-12.5)/(24.965-12.5));const c=context({});drive.draw(c,t,{id:'ignition'});return c.images.filter(i=>i.width===Math.ceil(sandbox.innerWidth/3));}
const a=city(22),b=city(22.1);assert.equal(a.length,2);assert.equal(b.length,2);assert.equal(drive.state.backgroundDirection,'right');
function delta(pass,colors){const x=a[pass].rects.find(r=>colors.includes(r.color)),y=b[pass].rects.find(r=>colors.includes(r.color));assert.ok(x&&y);return y.x-x.x;}
const far=delta(0,['#392b57','#352b50','#26364d']),near=delta(0,['#623451','#304d66','#51406b']),roof=delta(1,['#080b19']);
assert.ok(far>0&&near>far&&roof>near,'far buildings, near buildings and foreground rooftops scroll right with depth parallax');
assert.ok(a[1].rects.filter(r=>r.color==='#080b19').every(r=>r.y>=Math.ceil(sandbox.innerHeight/3)*.9),'dark camera-side rooftops stay at the bottom edge');
drive.update('fall',87.4,.1,.016);drive.draw(context({}),87.4,{id:'fall'});
assert.equal(drive.state.renderAngle,-Math.PI/2);assert.equal(drive.state.view,'profile');
assert.ok(drive.state.renderPosition.y+drive.state.renderPosition.size/2<0,'fall enters from above');
// A wheel below the side-view body rotates to the right, not the left.
assert.ok(-Math.sin(drive.state.renderAngle)>0);
for(const id of ['streak','multiplayer','eliminated','attack','montage']){
 const c=context({});drive.draw(c,115,{id});assert.equal(drive.state.rendered,false);assert.equal(c.images.length,0,'no car draw calls in cyberspace');
}
const sizes=[];
for(const [w,h] of [[2560,1080],[3440,1440]]){
 sandbox.innerWidth=w;sandbox.innerHeight=h;drive.update('ignition',22,9.5,.76);drive.draw(context({}),22,{id:'ignition'});sizes.push(drive.state.renderPosition.size/h);
}
assert.ok(Math.abs(sizes[0]-sizes[1])<1e-10,'21:9 framing preserves car size relative to height');
console.log('PASS reversed front flow, right-moving city/parallax, bottom rooftops, wheels-right top entry, no cyberspace car and 21:9 scaling');
