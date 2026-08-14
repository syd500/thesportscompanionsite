// ── SSC K-Zone 2D — pure Canvas, zero dependencies ─────────────
// Works on file://, http://, https:// — no CDN required
// API identical to old Three.js version:
//   showPitchZone(label, isCorrect, pitchType, speed, balls, strikes, outs)
//   resetPitchZone()
//   newAtBat()

(function(){
'use strict';

// ── CONFIG ─────────────────────────────────────────────────────
const CFG = {
  bg:        '#06080f',
  skyTop:    '#0a0e1a',
  skyBot:    '#0d1520',
  grassDark: '#091a06',
  grassLight:'#0d2209',
  dirtDark:  '#1a0a03',
  dirtLight: '#2a1205',
  zoneStroke:'rgba(255,255,255,0.88)',
  zoneGrid:  'rgba(255,255,255,0.2)',
  zoneFill:  'rgba(79,195,247,0.045)',
  zoneGlow:  'rgba(79,195,247,0.12)',
  plateCol:  'rgba(230,230,230,0.85)',
  kzoneBlue: '#4fc3f7',
  gold:      '#F2C230',
  // Count dot colors
  ballCol:   '#4caf50',
  strikeCol: '#ffb300',
  outCol:    '#ef5350',
};

// Pitch colors by type
const PITCH_COLORS = {
  fastball:   '#ef5350', '4-seam':'#ef5350', '2-seam':'#ff7043',
  sinker:     '#ff7043', cutter: '#ffa726', curveball:'#42a5f5',
  slider:     '#ab47bc', changeup:'#66bb6a', splitter:'#26c6da',
  knuckleball:'#d4e157', default:'#F2C230',
};

function pitchColor(type){
  if(!type) return PITCH_COLORS.default;
  const t = type.toLowerCase();
  for(const[k,v] of Object.entries(PITCH_COLORS)){
    if(t.includes(k)) return v;
  }
  return PITCH_COLORS.default;
}

// Zone locations — normalised x(-1..1), y(-1..1)
const ZONE_LOCS = {
  'up & in':       {x:-.67,y:.67, iz:true},
  'up & middle':   {x:0,   y:.67, iz:true},
  'up & away':     {x:.67, y:.67, iz:true},
  'middle-in':     {x:-.67,y:0,   iz:true},
  'middle':        {x:0,   y:0,   iz:true},
  'down the middle':{x:0,  y:0,   iz:true},
  'middle-away':   {x:.67, y:0,   iz:true},
  'down & in':     {x:-.67,y:-.67,iz:true},
  'down & middle': {x:0,   y:-.67,iz:true},
  'down & away':   {x:.67, y:-.67,iz:true},
  'arm side':      {x:-.67,y:0,   iz:true},
  'glove side':    {x:.67, y:0,   iz:true},
  'backdoor':      {x:.9,  y:-.5, iz:true},
  '12-6':          {x:0,   y:-.67,iz:true},
  'inside':        {x:-1.55,y:0,  iz:false},
  'outside':       {x:1.55, y:0,  iz:false},
  'way outside':   {x:1.7,  y:0,  iz:false},
  'high':          {x:0,   y:1.65,iz:false},
  'low':           {x:0,   y:-1.65,iz:false},
  'bounce':        {x:0,   y:-2.2, iz:false},
  'low & away':    {x:1.4, y:-1.4, iz:false},
  'low & in':      {x:-1.4,y:-1.4, iz:false},
  'high & away':   {x:1.4, y:1.4,  iz:false},
};

function getLoc(label){
  if(!label) return{x:0,y:0,iz:true};
  const s=(label.includes('—')?label.split('—')[1].trim():label).toLowerCase();
  for(const[k,v] of Object.entries(ZONE_LOCS)){
    if(s.includes(k)||k.includes(s)) return v;
  }
  return{x:0,y:0,iz:true};
}

// Pitch break mid-point offset
function getBreak(type){
  const t=(type||'').toLowerCase();
  if(t.includes('curve'))   return{bx:.14,by:-.18};
  if(t.includes('slider'))  return{bx:.11,by:-.08};
  if(t.includes('cutter'))  return{bx:.06,by:-.03};
  if(t.includes('sinker')||t.includes('2-seam')) return{bx:.05,by:-.14};
  if(t.includes('changeup'))return{bx:.06,by:-.12};
  if(t.includes('splitter'))return{bx:.03,by:-.18};
  if(t.includes('knuckle')) return{bx:(Math.random()-.5)*.25,by:(Math.random()-.5)*.15};
  return{bx:0,by:.03};
}

// ── STATE ──────────────────────────────────────────────────────
let canvas, ctx;
let W=0, H=0;
// Zone rect in canvas pixels (set in layout())
let ZX=0,ZY=0,ZW=0,ZH=0;
// Count state
let COUNT={b:0,s:0,o:0};
// Ball animation
let animId=null, animT=0, animDur=700, animActive=false;
let animStartX=0,animStartY=0, animMidX=0,animMidY=0, animEndX=0,animEndY=0;
let animColor='#F2C230';
// Current result
let resultState=null; // {inZone, isCorrect, pitchType, speed}
// History dots [{x,y,color,inZone}]
let history=[];
// Trail [{x,y,a}]
let trail=[];
// Ripple [{x,y,r,a}]
let ripples=[];
// Info visible
let infoVisible=false;
let currentPitchType='';
let currentPitchSpeed='';
let currentResult='';
let currentResultClass='';

// ── LAYOUT CALCULATOR ──────────────────────────────────────────
function layout(){
  W = canvas.width  = canvas.offsetWidth  || 360;
  H = canvas.height = canvas.offsetHeight || 320;
  // Zone occupies right ~38% of canvas, vertically centered
  ZW = Math.round(W * 0.34);
  ZH = Math.round(ZW * 1.12);
  ZX = Math.round(W * 0.56);
  ZY = Math.round((H - ZH) * 0.46);
}

// ── DRAW SCENE ──────────────────────────────────────────────────
function drawScene(){
  ctx.clearRect(0,0,W,H);

  // ── Background sky gradient ──
  const sky = ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0, '#06080f');
  sky.addColorStop(.45,'#0c1222');
  sky.addColorStop(.68,'#0d1a10');
  sky.addColorStop(1,  '#050e04');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,W,H);

  // ── Stadium light glows (upper corners) ──
  drawLightGlow(W*.12, H*.08, W*.22);
  drawLightGlow(W*.88, H*.08, W*.22);

  // ── Light poles ──
  drawLightPole(W*.09, H*.04, W*.06);
  drawLightPole(W*.91, H*.04, W*.06);

  // ── Outfield wall arc ──
  ctx.beginPath();
  ctx.arc(W*.5, H*-.2, W*.72, 0, Math.PI);
  ctx.fillStyle='#0f2812';
  ctx.fill();
  // wall top edge
  ctx.beginPath();
  ctx.arc(W*.5, H*-.2, W*.72, 0, Math.PI);
  ctx.strokeStyle='rgba(40,100,50,0.6)';
  ctx.lineWidth=2;
  ctx.stroke();

  // ── Crowd / stands ──
  drawCrowd();

  // ── Outfield grass (bottom ellipse) ──
  const grassGrad = ctx.createRadialGradient(W*.5,H*.82,0, W*.5,H*.82,W*.7);
  grassGrad.addColorStop(0,'#152e10');
  grassGrad.addColorStop(1,'#071205');
  ctx.beginPath();
  ctx.ellipse(W*.5, H*.85, W*.62, H*.42, 0, 0, Math.PI*2);
  ctx.fillStyle = grassGrad;
  ctx.fill();
  // Mow stripes
  drawMowStripes();

  // ── Infield dirt ──
  const dirtGrad = ctx.createRadialGradient(W*.5,H*.95,0, W*.5,H*.95,W*.32);
  dirtGrad.addColorStop(0,'#2a1508');
  dirtGrad.addColorStop(1,'#120800');
  ctx.beginPath();
  ctx.ellipse(W*.5, H*.94, W*.3, H*.14, 0, 0, Math.PI*2);
  ctx.fillStyle = dirtGrad;
  ctx.fill();

  // ── Foul lines ──
  ctx.strokeStyle='rgba(255,255,255,0.15)';
  ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(W*.5,H*.9); ctx.lineTo(W*.02, H*.38); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W*.5,H*.9); ctx.lineTo(W*.98, H*.38); ctx.stroke();

  // ── Pitcher mound ──
  ctx.beginPath();
  ctx.ellipse(W*.5, H*.74, W*.046, H*.024, 0, 0, Math.PI*2);
  ctx.fillStyle='#1e0d04';
  ctx.fill();
  // rubber
  ctx.fillStyle='rgba(220,220,220,0.5)';
  ctx.fillRect(W*.486, H*.736, W*.028, H*.008);

  // ── Home plate ──
  drawHomePlate();

  // ── Batter's boxes ──
  drawBatterBoxes();

  // ── Batter silhouette ──
  drawBatter();

  // ── Ground zone projection ──
  drawGroundZone();

  // ── Strike zone ──
  drawStrikeZone();

  // ── History dots ──
  history.forEach(h=>drawHistoryDot(h));

  // ── Ripples ──
  ripples.forEach(r=>drawRipple(r));

  // ── Ball + trail ──
  if(animActive || resultState){
    trail.forEach((t,i)=>drawTrailDot(t,i));
    if(animActive || resultState){
      drawBall(animEndX||0, animEndY||0, animColor);
    }
  }

  // ── K-Zone label ──
  ctx.font = `bold ${Math.round(W*.028)}px 'JetBrains Mono',monospace`;
  ctx.fillStyle = CFG.kzoneBlue;
  ctx.fillText('K-ZONE', W*.025, H*.068);
  ctx.strokeStyle='rgba(79,195,247,0.3)';
  ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(W*.025, H*.076); ctx.lineTo(W*.18, H*.076); ctx.stroke();

  // ── Count dots ──
  drawCountDots();
}

function drawLightGlow(cx,cy,r){
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,'rgba(255,245,180,0.28)');
  g.addColorStop(1,'rgba(255,245,180,0)');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
}

function drawLightPole(cx,top,pw){
  // Pole
  ctx.fillStyle='#2a2a2a';
  ctx.fillRect(cx-pw*.06, top, pw*.12, H*.18);
  // Light bank
  ctx.fillStyle='#3a3a3a';
  ctx.fillRect(cx-pw*.5, top+H*.02, pw, H*.03);
  ctx.fillRect(cx-pw*.5, top+H*.06, pw, H*.02);
  // Bulbs
  const bulbW = pw/3.5;
  for(let i=0;i<3;i++){
    ctx.fillStyle='rgba(255,230,100,0.85)';
    ctx.beginPath();
    ctx.arc(cx-pw*.5+bulbW*(i+.5), top+H*.03, bulbW*.28, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawCrowd(){
  // Row tints
  const rows=[
    {y:.3,h:.04,c:'rgba(40,65,120,0.35)'},
    {y:.34,h:.035,c:'rgba(30,55,110,0.35)'},
    {y:.375,h:.03,c:'rgba(20,45,90,0.35)'},
    {y:.405,h:.025,c:'rgba(15,35,70,0.35)'},
  ];
  rows.forEach(r=>{
    ctx.fillStyle=r.c;
    ctx.fillRect(0,H*r.y,W,H*r.h);
  });
  // Crowd dots
  ctx.fillStyle='rgba(100,140,200,0.25)';
  for(let x=30;x<W;x+=22){
    ctx.beginPath();
    ctx.arc(x, H*.32+Math.sin(x*.18)*H*.015, W*.006, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawMowStripes(){
  for(let r=0;r<5;r++){
    ctx.beginPath();
    ctx.ellipse(W*.5, H*.85, W*(.22+r*.07), H*(.16+r*.05), 0, 0, Math.PI*2);
    ctx.strokeStyle=r%2?'rgba(30,80,20,0.25)':'rgba(15,50,10,0.25)';
    ctx.lineWidth=W*.04;
    ctx.stroke();
  }
}

function drawHomePlate(){
  const px=W*.5, py=H*.905, pw=W*.065, ph=H*.038;
  ctx.beginPath();
  ctx.moveTo(px-pw, py-ph*.3);
  ctx.lineTo(px+pw, py-ph*.3);
  ctx.lineTo(px+pw, py+ph*.1);
  ctx.lineTo(px,    py+ph);
  ctx.lineTo(px-pw, py+ph*.1);
  ctx.closePath();
  ctx.fillStyle='rgba(225,225,225,0.85)';
  ctx.fill();
  ctx.strokeStyle='rgba(180,180,180,0.4)';
  ctx.lineWidth=1; ctx.stroke();
}

function drawBatterBoxes(){
  ctx.strokeStyle='rgba(255,255,255,0.12)';
  ctx.lineWidth=1;
  // Left box
  ctx.strokeRect(W*.27, H*.77, W*.15, H*.15);
  // Right box (dashed)
  ctx.setLineDash([3,4]);
  ctx.strokeRect(W*.58, H*.77, W*.15, H*.15);
  ctx.setLineDash([]);
}

function drawBatter(){
  const bx=W*.28, by=H*.92;
  ctx.save();

  // Shadow
  ctx.beginPath();
  ctx.ellipse(bx+W*.04, H*.924, W*.07, H*.015, 0, 0, Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fill();

  // Back leg
  ctx.strokeStyle='#111'; ctx.lineWidth=W*.032; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(bx+W*.04,by); ctx.lineTo(bx+W*.05,by-H*.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx+W*.05,by-H*.1); ctx.lineTo(bx+W*.06,by-H*.18); ctx.stroke();
  // Front leg
  ctx.lineWidth=W*.028;
  ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx-W*.01,by-H*.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx-W*.01,by-H*.1); ctx.lineTo(bx-W*.015,by-H*.18); ctx.stroke();

  // Cleats
  ctx.fillStyle='#0a0a0a';
  ctx.fillRect(bx-W*.04,by-H*.005,W*.055,H*.012);
  ctx.fillRect(bx+W*.01,by-H*.005,W*.05,H*.012);

  // Torso (white jersey)
  ctx.beginPath();
  ctx.moveTo(bx-W*.04, by-H*.18);
  ctx.lineTo(bx-W*.032,by-H*.30);
  ctx.lineTo(bx+W*.06, by-H*.30);
  ctx.lineTo(bx+W*.07, by-H*.18);
  ctx.closePath();
  ctx.fillStyle='rgba(220,228,240,0.92)'; ctx.fill();
  // Jersey shadow
  ctx.beginPath();
  ctx.moveTo(bx-W*.04, by-H*.18);
  ctx.lineTo(bx-W*.032,by-H*.30);
  ctx.lineTo(bx-W*.005,by-H*.30);
  ctx.lineTo(bx+W*.003, by-H*.18);
  ctx.closePath();
  ctx.fillStyle='rgba(160,168,185,0.7)'; ctx.fill();
  // Stripes
  ctx.strokeStyle='rgba(200,20,20,0.5)'; ctx.lineWidth=H*.006;
  ctx.beginPath(); ctx.moveTo(bx-W*.03,by-H*.24); ctx.lineTo(bx+W*.06,by-H*.24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx-W*.03,by-H*.27); ctx.lineTo(bx+W*.06,by-H*.27); ctx.stroke();
  // Belt
  ctx.fillStyle='rgba(20,20,20,0.8)';
  ctx.fillRect(bx-W*.04,by-H*.2,W*.11,H*.014);

  // Arms & bat
  ctx.strokeStyle='rgba(180,110,60,0.9)'; ctx.lineWidth=W*.024;
  // Back arm up
  ctx.beginPath(); ctx.moveTo(bx+W*.055,by-H*.27); ctx.lineTo(bx+W*.08,by-H*.33); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx+W*.08,by-H*.33); ctx.lineTo(bx+W*.1,by-H*.38); ctx.stroke();
  // Front arm
  ctx.lineWidth=W*.02;
  ctx.beginPath(); ctx.moveTo(bx-W*.02,by-H*.26); ctx.lineTo(bx+W*.04,by-H*.32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx+W*.04,by-H*.32); ctx.lineTo(bx+W*.09,by-H*.36); ctx.stroke();
  // Grip
  ctx.beginPath(); ctx.arc(bx+W*.1,by-H*.378,W*.018,0,Math.PI*2);
  ctx.fillStyle='rgba(120,60,20,0.9)'; ctx.fill();
  // Bat
  ctx.strokeStyle='#4a2008'; ctx.lineWidth=W*.018;
  ctx.beginPath(); ctx.moveTo(bx+W*.11,by-H*.39); ctx.lineTo(bx+W*.27,by-H*.47); ctx.stroke();
  ctx.strokeStyle='rgba(140,72,28,0.5)'; ctx.lineWidth=W*.01;
  ctx.beginPath(); ctx.moveTo(bx+W*.11,by-H*.39); ctx.lineTo(bx+W*.27,by-H*.47); ctx.stroke();
  // Knob
  ctx.beginPath(); ctx.arc(bx+W*.272,by-H*.472,W*.012,0,Math.PI*2);
  ctx.fillStyle='#2a1008'; ctx.fill();

  // Helmet
  ctx.beginPath(); ctx.ellipse(bx-W*.02,by-H*.34,W*.048,H*.05,-.15,0,Math.PI*2);
  ctx.fillStyle='rgba(8,8,8,0.95)'; ctx.fill();
  // Brim
  ctx.beginPath();
  ctx.moveTo(bx-W*.065,by-H*.33);
  ctx.quadraticCurveTo(bx-W*.09,by-H*.32,bx-W*.085,by-H*.3);
  ctx.lineTo(bx-W*.06,by-H*.3);
  ctx.lineTo(bx-W*.06,by-H*.32);
  ctx.closePath();
  ctx.fillStyle='#060606'; ctx.fill();
  // Ear flap
  ctx.beginPath();
  ctx.moveTo(bx-W*.065,by-H*.33);
  ctx.quadraticCurveTo(bx-W*.08,by-H*.29,bx-W*.07,by-H*.26);
  ctx.lineTo(bx-W*.05,by-H*.265); ctx.lineTo(bx-W*.055,by-H*.32); ctx.closePath();
  ctx.fillStyle='#050505'; ctx.fill();
  // Face
  ctx.beginPath(); ctx.arc(bx-W*.01,by-H*.305,W*.025,0,Math.PI*2);
  ctx.fillStyle='rgba(185,115,65,0.88)'; ctx.fill();
  // Eye
  ctx.beginPath(); ctx.arc(bx+W*.005,by-H*.31,W*.005,0,Math.PI*2);
  ctx.fillStyle='rgba(40,30,20,0.7)'; ctx.fill();

  ctx.restore();
}

function drawGroundZone(){
  // Flat projection on dirt — shows where pitches land
  const gx = ZX + ZW*.5;  // same horizontal center as zone
  const gy = H*.885;       // on the dirt
  const gw = ZW*.95;
  const gh = H*.055;

  // Zone fill
  ctx.fillStyle='rgba(8,22,48,0.55)';
  ctx.beginPath();
  ctx.ellipse(gx,gy,gw*.5,gh*.5,0,0,Math.PI*2);
  ctx.fill();

  // Zone outline
  ctx.strokeStyle='rgba(79,195,247,0.45)';
  ctx.lineWidth=1.2;
  ctx.beginPath();
  ctx.ellipse(gx,gy,gw*.5,gh*.5,0,0,Math.PI*2);
  ctx.stroke();

  // Column dividers on ground
  ctx.strokeStyle='rgba(79,195,247,0.2)';
  ctx.lineWidth=0.8;
  for(let col=-1;col<=1;col+=1){
    const lx = gx + col*(gw*.5/3*1.4);
    ctx.beginPath();
    ctx.moveTo(lx, gy-gh*.5);
    ctx.lineTo(lx, gy+gh*.5);
    ctx.stroke();
  }

  // Glow
  const gg=ctx.createRadialGradient(gx,gy,0,gx,gy,gw*.55);
  gg.addColorStop(0,'rgba(79,195,247,0.06)');
  gg.addColorStop(1,'rgba(79,195,247,0)');
  ctx.fillStyle=gg;
  ctx.beginPath(); ctx.ellipse(gx,gy,gw*.55,gh*.7,0,0,Math.PI*2); ctx.fill();
}

function drawStrikeZone(){
  // Outer glow
  ctx.shadowColor='rgba(79,195,247,0.25)';
  ctx.shadowBlur=12;
  ctx.strokeStyle='rgba(79,195,247,0.1)';
  ctx.lineWidth=10;
  ctx.strokeRect(ZX, ZY, ZW, ZH);
  ctx.shadowBlur=0;

  // Zone fill
  ctx.fillStyle=CFG.zoneFill;
  ctx.fillRect(ZX,ZY,ZW,ZH);

  // Grid lines (3x3)
  ctx.strokeStyle=CFG.zoneGrid;
  ctx.lineWidth=0.9;
  // Vertical thirds
  ctx.beginPath(); ctx.moveTo(ZX+ZW/3,ZY); ctx.lineTo(ZX+ZW/3,ZY+ZH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ZX+ZW*2/3,ZY); ctx.lineTo(ZX+ZW*2/3,ZY+ZH); ctx.stroke();
  // Horizontal thirds
  ctx.beginPath(); ctx.moveTo(ZX,ZY+ZH/3); ctx.lineTo(ZX+ZW,ZY+ZH/3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ZX,ZY+ZH*2/3); ctx.lineTo(ZX+ZW,ZY+ZH*2/3); ctx.stroke();

  // Zone border
  ctx.strokeStyle = resultState
    ? (resultState.inZone ? 'rgba(255,255,255,0.88)' : 'rgba(239,83,80,0.7)')
    : 'rgba(255,255,255,0.88)';
  ctx.lineWidth=2.5;
  ctx.strokeRect(ZX,ZY,ZW,ZH);
}

// Convert zone-normalised loc to canvas pixels
function zoneToCanvas(xn, yn){
  const cx = ZX + ZW*.5 + xn*(ZW*.5);
  const cy = ZY + ZH*.5 - yn*(ZH*.5);
  return{x:cx,y:cy};
}

function drawHistoryDot(h){
  ctx.beginPath();
  ctx.arc(h.x, h.y, W*.014, 0, Math.PI*2);
  ctx.fillStyle = h.color.replace(')',`,${h.a||0.28})`).replace('rgb','rgba');
  // simpler:
  ctx.globalAlpha = h.a || 0.3;
  ctx.fillStyle = h.color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle='rgba(255,255,255,0.25)';
  ctx.lineWidth=0.8;
  ctx.stroke();
}

function drawTrailDot(t, i){
  ctx.globalAlpha = t.a;
  ctx.beginPath();
  ctx.arc(t.x, t.y, W*(.016-i*.003), 0, Math.PI*2);
  ctx.fillStyle = animColor;
  ctx.fill();
  ctx.globalAlpha=1;
}

function drawBall(x,y,color){
  if(x<=0&&y<=0) return;
  // Glow
  const gl=ctx.createRadialGradient(x,y,0,x,y,W*.06);
  gl.addColorStop(0,color+'80');
  gl.addColorStop(1,'transparent');
  ctx.fillStyle=gl;
  ctx.beginPath(); ctx.arc(x,y,W*.06,0,Math.PI*2); ctx.fill();
  // Ball
  const g=ctx.createRadialGradient(x-W*.008,y-W*.008,W*.002,x,y,W*.022);
  g.addColorStop(0,'white');
  g.addColorStop(.3,color);
  g.addColorStop(1,color+'aa');
  ctx.beginPath(); ctx.arc(x,y,W*.022,0,Math.PI*2);
  ctx.fillStyle=g; ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.85)';
  ctx.lineWidth=1.5; ctx.stroke();
  // Seam lines
  ctx.strokeStyle='rgba(200,60,40,0.7)';
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.arc(x,y,W*.012,-0.8,0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x,y,W*.012,Math.PI-.8,Math.PI+.8);
  ctx.stroke();
}

function drawRipple(r){
  ctx.globalAlpha=r.a;
  ctx.strokeStyle=r.color;
  ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,Math.PI*2); ctx.stroke();
  ctx.globalAlpha=1;
}

function drawCountDots(){
  const dotR = W*.018;
  const dotGroups = [
    {label:'B', count:COUNT.b, max:3, color:CFG.ballCol,   startX:W*.68, y:H*.07},
    {label:'S', count:COUNT.s, max:2, color:CFG.strikeCol, startX:W*.68, y:H*.115},
    {label:'O', count:COUNT.o, max:3, color:CFG.outCol,    startX:W*.68, y:H*.16},
  ];
  ctx.font=`${Math.round(W*.022)}px 'JetBrains Mono',monospace`;
  dotGroups.forEach(g=>{
    ctx.fillStyle='rgba(154,168,196,0.7)';
    ctx.fillText(g.label, W*.63, g.y+dotR*.5);
    for(let i=0;i<g.max;i++){
      const cx=g.startX+i*(dotR*2.5);
      ctx.beginPath(); ctx.arc(cx,g.y,dotR,0,Math.PI*2);
      if(i<g.count){
        ctx.fillStyle=g.color;
        ctx.shadowColor=g.color; ctx.shadowBlur=6;
        ctx.fill(); ctx.shadowBlur=0;
      } else {
        ctx.fillStyle='rgba(20,20,30,0.8)';
        ctx.fill();
        ctx.strokeStyle='rgba(60,60,80,0.6)'; ctx.lineWidth=1; ctx.stroke();
      }
    }
  });
}

// ── ANIMATION LOOP ──────────────────────────────────────────────
function quadBezier(t,p0,p1,p2){
  return (1-t)*(1-t)*p0 + 2*(1-t)*t*p1 + t*t*p2;
}

let lastFrame=null;
function frame(ts){
  if(!lastFrame) lastFrame=ts;
  const dt = ts-lastFrame; lastFrame=ts;

  if(animActive){
    animT = Math.min(animT+dt/animDur, 1);
    const ease = animT<.5 ? 2*animT*animT : -1+(4-2*animT)*animT;
    animEndX = quadBezier(ease, animStartX, animMidX, resultState?.px||animMidX);
    animEndY = quadBezier(ease, animStartY, animMidY, resultState?.py||animMidY);

    // Build trail
    const trailCount=5;
    trail=[];
    for(let i=1;i<=trailCount;i++){
      const tBack=Math.max(0,ease-i*.06);
      trail.push({
        x:quadBezier(tBack,animStartX,animMidX,resultState?.px||animMidX),
        y:quadBezier(tBack,animStartY,animMidY,resultState?.py||animMidY),
        a:Math.max(0,(0.5-i*.09)*ease*1.6)
      });
    }

    if(animT>=1){
      animActive=false;
      // Land: add to history, trigger ripple
      if(resultState){
        history.push({x:resultState.px,y:resultState.py,color:animColor,a:.3});
        if(history.length>8) history.shift();
        addRipple(resultState.px, resultState.py, animColor);
        // Ground ripple too
        const gx=ZX+ZW*.5, gy=H*.885;
        addRipple(gx+(resultState.xn||0)*(ZW*.45), gy, animColor);
      }
    }
  }

  // Animate ripples
  ripples.forEach(r=>{
    r.r += 1.4;
    r.a = Math.max(0, r.a-0.022);
  });
  ripples=ripples.filter(r=>r.a>0);

  drawScene();

  if(animActive || ripples.length) animId=requestAnimationFrame(frame);
  else animId=null;
}

function addRipple(x,y,color){
  ripples.push({x,y,r:W*.015,a:.65,color});
  if(!animId) animId=requestAnimationFrame(frame);
}

// ── PUBLIC API ──────────────────────────────────────────────────
function showPitchZone(label, isCorrect, pitchType, speed, balls, strikes, outs){
  if(!canvas) return;

  // Update count
  if(balls!==undefined){ COUNT={b:balls||0,s:strikes||0,o:outs||0}; }

  // Get location
  const loc = getLoc(label);
  const cp  = zoneToCanvas(loc.x, loc.y);
  const col = pitchColor(pitchType);
  const brk = getBreak(pitchType);

  // Store result state
  resultState={ inZone:loc.iz, isCorrect, px:cp.x, py:cp.y, xn:loc.x, yn:loc.y };

  // Animation start = pitcher's release point (upper center)
  animStartX = W*.5 + (loc.x*W*.04);  // slight release-point offset
  animStartY = H*.22;
  // Mid control point with pitch break
  const brkX = brk.bx * ZW;
  const brkY = brk.by * ZH;
  animMidX = cp.x*.5 + animStartX*.5 + brkX;
  animMidY = cp.y*.5 + animStartY*.5 + brkY;

  animColor = col;
  animT=0; animActive=true; trail=[]; lastFrame=null;

  // Update current pitch info
  currentPitchType  = pitchType || 'Pitch';
  currentPitchSpeed = speed ? speed+' mph' : '';
  currentResult     = isCorrect ? '✓ Correct' : (loc.iz ? '✗ Missed Spot' : '✗ Out of Zone');
  currentResultClass = isCorrect ? 'pz-result-hit' : (loc.iz ? 'pz-result-miss' : 'pz-result-ball');
  infoVisible=true;

  // Update DOM elements
  updateDOM(loc, isCorrect, pitchType, speed);

  if(!animId) animId=requestAnimationFrame(frame);
}

function updateDOM(loc, isCorrect, pitchType, speed){
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const cl=(id,cls,vis)=>{const e=document.getElementById(id);if(!e)return;e.className=cls;e.style.opacity=vis?'1':'0';};

  set('zone-status', loc.iz ? 'Strike Zone' : 'Ball — Out of Zone');
  const st=document.getElementById('zone-status');
  if(st) st.className='pitch-zone-status '+(loc.iz?'pz-status-strike':'pz-status-ball');

  const ib=document.getElementById('pz-info-bar');
  if(ib) ib.style.opacity='1';
  set('pz-pitch-type-label', pitchType||'Pitch');
  set('pz-pitch-speed-label', speed?speed+' mph':'');

  const badge=document.getElementById('pitch-result');
  if(badge){
    badge.textContent=currentResult;
    badge.className='pz-result-badge '+currentResultClass;
  }

  // B-S-O text
  set('pz-balls',   COUNT.b);
  set('pz-strikes', COUNT.s);
  set('pz-outs',    COUNT.o);
}

function resetPitchZone(){
  animActive=false; trail=[]; resultState=null; infoVisible=false;
  animEndX=0; animEndY=0;
  const st=document.getElementById('zone-status');
  const ba=document.getElementById('pitch-result');
  const ib=document.getElementById('pz-info-bar');
  if(st){st.textContent='';st.className='pitch-zone-status';}
  if(ba){ba.className='pz-result-badge';ba.textContent='';}
  if(ib) ib.style.opacity='0';
  drawScene();
}

function newAtBat(){
  history=[]; ripples=[];
  resetPitchZone();
}

// ── INIT ────────────────────────────────────────────────────────
function init(canvasId){
  canvas=document.getElementById(canvasId||'kzone-canvas');
  if(!canvas){ console.warn('[KZone2D] canvas not found:', canvasId); return; }
  ctx=canvas.getContext('2d');
  layout();
  drawScene();
  // Resize
  window.addEventListener('resize',()=>{
    layout();
    drawScene();
  });
  new ResizeObserver(()=>{
    layout();
    drawScene();
  }).observe(canvas.parentElement||canvas);
}

// Expose under both names so index and gameday both work
window.showPitchZone  = showPitchZone;
window.resetPitchZone = resetPitchZone;
window.newAtBat       = newAtBat;
window._initKZone2D   = ()=>init('kzone-canvas');
window._initGDKZone2D = ()=>init('gd-kzone-canvas');

// Auto-init on DOMContentLoaded if canvas is present
document.addEventListener('DOMContentLoaded',()=>{
  if(document.getElementById('kzone-canvas'))    init('kzone-canvas');
  if(document.getElementById('gd-kzone-canvas')) init('gd-kzone-canvas');
});

})();
