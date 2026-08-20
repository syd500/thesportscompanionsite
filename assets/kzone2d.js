// ── SSC K-Zone ESPN-Style — Canvas 2D ──────────────────────────
// Phase 1: Batter view with live K-Zone heatmap, pitch dot, count
// Phase 2: Overhead field view with animated ball trajectory
// API: showPitchZone(label, isCorrect, pitchType, speed, balls, strikes, outs)
//      resetPitchZone()  newAtBat()

(function(){
'use strict';

// ── PALETTE ────────────────────────────────────────────────────
const C = {
  bg:'#06080f', skyTop:'#0a0e1a', skyBot:'#0d1520',
  grass:'#1a4a18', grassLight:'#1e5c1c', grassDark:'#142f12',
  dirt:'#8B5E3C', dirtLight:'#A0714F', dirtDark:'#6B4530',
  sand:'#C4956A', mound:'#B8845A',
  white:'rgba(255,255,255,0.92)', muted:'rgba(200,210,220,0.7)',
  gold:'#F2C230', blue:'#4fc3f7', red:'#ef5350',
  green:'#4caf50', amber:'#ffb300',
  zoneStroke:'rgba(255,255,255,0.85)', zoneGrid:'rgba(255,255,255,0.18)',
  zoneFill:'rgba(79,195,247,0.04)', hotFill:'rgba(239,83,80,0.22)',
  warmFill:'rgba(255,152,0,0.16)', coolFill:'rgba(33,150,243,0.12)',
};

// Pitch type → colour map
const PCLR = {
  fastball:'#ef5350','4-seam':'#ef5350','2-seam':'#ff7043',
  sinker:'#ff7043', cutter:'#ffa726', curveball:'#42a5f5',
  slider:'#ab47bc', changeup:'#66bb6a', splitter:'#26c6da',
  knuckleball:'#d4e157', default:'#F2C230',
};
function pitchClr(t){
  if(!t) return PCLR.default;
  const l=t.toLowerCase();
  for(const[k,v] of Object.entries(PCLR)) if(l.includes(k)) return v;
  return PCLR.default;
}

// Zone locations — normalised x(-1..1), y(-1..1)
const ZLOCS = {
  'up & in':{x:-.67,y:.67,iz:true},'up & middle':{x:0,y:.67,iz:true},
  'up & away':{x:.67,y:.67,iz:true},'middle-in':{x:-.67,y:0,iz:true},
  'middle':{x:0,y:0,iz:true},'down the middle':{x:0,y:0,iz:true},
  'middle-away':{x:.67,y:0,iz:true},'down & in':{x:-.67,y:-.67,iz:true},
  'down & middle':{x:0,y:-.67,iz:true},'down & away':{x:.67,y:-.67,iz:true},
  'arm side':{x:-.67,y:0,iz:true},'glove side':{x:.67,y:0,iz:true},
  'up':{x:0,y:.67,iz:true},'backdoor':{x:.9,y:-.5,iz:true},
  '12-6':{x:0,y:-.67,iz:true},'inside':{x:-1.55,y:0,iz:false},
  'outside':{x:1.55,y:0,iz:false},'high':{x:0,y:1.65,iz:false},
  'low':{x:0,y:-1.65,iz:false},'bounce':{x:0,y:-2.2,iz:false},
  'low & away':{x:1.4,y:-1.4,iz:false},'low & in':{x:-1.4,y:-1.4,iz:false},
};
function getLoc(s){
  if(!s) return{x:0,y:0,iz:true};
  const q=(s.includes('—')?s.split('—')[1].trim():s).toLowerCase();
  for(const[k,v] of Object.entries(ZLOCS)) if(q.includes(k)||k.includes(q)) return v;
  return{x:0,y:0,iz:true};
}
function getBreak(t){
  const l=(t||'').toLowerCase();
  if(l.includes('curve'))    return{bx:.14,by:-.18};
  if(l.includes('slider'))   return{bx:.11,by:-.08};
  if(l.includes('cutter'))   return{bx:.06,by:-.03};
  if(l.includes('sinker')||l.includes('2-seam')) return{bx:.05,by:-.14};
  if(l.includes('change'))   return{bx:.06,by:-.12};
  if(l.includes('split'))    return{bx:.03,by:-.18};
  return{bx:0,by:.03};
}

// ── HEATMAP DATA ── Simulated pitch density per zone cell (3×3)
// Updated each pitch to show where pitches have been thrown
let heatmap = [
  [0,0,0],[0,0,0],[0,0,0],   // top row (L→R, high→low)
  [0,0,0],[0,0,0],[0,0,0],
  [0,0,0],[0,0,0],[0,0,0],
];
// Which heat cell does a location fall into? Returns [row,col]
function heatCell(nx,ny){
  const col = nx < -0.33 ? 0 : nx < 0.33 ? 1 : 2;
  const row = ny >  0.33 ? 0 : ny > -0.33 ? 1 : 2;
  return[row,col];
}
function bumpHeat(nx,ny){
  if(Math.abs(nx)<=1 && Math.abs(ny)<=1){
    const[r,c]=heatCell(nx,ny);
    heatmap[r*3+c]=(heatmap[r*3+c]||0)+1;
  }
}
function maxHeat(){ return Math.max(1,...heatmap.flat()); }

// ── STATE ──────────────────────────────────────────────────────
let canvas, ctx, W=0, H=0;
let ZX=0,ZY=0,ZW=0,ZH=0;   // K-Zone rect in pixels
let COUNT={b:0,s:0,o:0};
let history=[];              // [{nx,ny,clr,iz}]
let animId=null;
let phase='pitch';           // 'pitch' | 'flight' | 'result'
let pitchAnim={t:0,dur:520,sx:0,sy:0,mx:0,my:0,ex:0,ey:0,clr:'#fff'};
let flightAnim={t:0,dur:900,done:false};
let resultState=null;        // {loc, isCorrect, pitchType, speed, inZone}
let currentPitchType='', currentSpeed=0;
let pitchDot=null;           // {x,y,clr,r} — final dot on zone
let infoVisible=false;
let ripples=[];
let fieldResult=null;        // 'single'|'fly'|'grounder'|'strike'|'ball' etc.

// ── LAYOUT ─────────────────────────────────────────────────────
function layout(){
  W=canvas.width=canvas.offsetWidth||380;
  H=canvas.height=canvas.offsetHeight||340;
  ZW=Math.round(W*0.30); ZH=Math.round(ZW*1.14);
  ZX=Math.round(W*0.60); ZY=Math.round((H-ZH)*0.42);
}

// ── MAIN RENDER LOOP ───────────────────────────────────────────
function loop(){
  animId=requestAnimationFrame(loop);
  draw();
}

function draw(){
  ctx.clearRect(0,0,W,H);
  if(phase==='flight'||phase==='result_field'){
    drawField();
    if(phase==='flight') animFlight();
    else drawFieldResult();
  } else {
    drawPitchView();
    if(phase==='anim') animPitch();
  }
}

// ══════════════════════════════════════════════════════════════
// ── PHASE 1: BATTER / K-ZONE VIEW ─────────────────────────────
// ══════════════════════════════════════════════════════════════
function drawPitchView(){
  // Sky gradient background
  const sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#06080f'); sky.addColorStop(.4,'#0c1222');
  sky.addColorStop(.65,'#0d1a10'); sky.addColorStop(1,'#050e04');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);

  drawStadiumLights();
  drawMoundAndPlate();
  drawBatter();
  drawKZone();
  drawHeatmap();
  drawHistoryDots();
  drawCountBar();
  drawPitchTypeLabel();
  if(pitchDot) drawPitchDot();
}

function drawStadiumLights(){
  [[W*.1,H*.06],[W*.9,H*.06]].forEach(([lx,ly])=>{
    const g=ctx.createRadialGradient(lx,ly,0,lx,ly,W*.18);
    g.addColorStop(0,'rgba(255,255,220,0.12)');
    g.addColorStop(1,'rgba(255,255,220,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H*.35);
    // pole
    ctx.strokeStyle='rgba(180,180,180,0.4)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(lx,H*.28); ctx.stroke();
  });
}

function drawMoundAndPlate(){
  // Ground
  const grd=ctx.createLinearGradient(0,H*.55,0,H);
  grd.addColorStop(0,C.grassDark); grd.addColorStop(1,'#030804');
  ctx.fillStyle=grd; ctx.fillRect(0,H*.55,W,H*.45);

  // Pitcher's mound
  const mx=W*.22, my=H*.72, mr=W*.055;
  const mg=ctx.createRadialGradient(mx,my,0,mx,my,mr);
  mg.addColorStop(0,C.dirtLight); mg.addColorStop(1,C.dirtDark);
  ctx.fillStyle=mg;
  ctx.beginPath(); ctx.ellipse(mx,my,mr,mr*.45,0,0,Math.PI*2); ctx.fill();

  // Home plate
  const px=W*.2, py=H*.84, pw=W*.045, ph=pw*.6;
  ctx.fillStyle='rgba(230,230,230,0.88)';
  ctx.beginPath();
  ctx.moveTo(px,py-ph); ctx.lineTo(px+pw/2,py); ctx.lineTo(px+pw/2,py+ph*.4);
  ctx.lineTo(px-pw/2,py+ph*.4); ctx.lineTo(px-pw/2,py); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle='rgba(180,180,180,0.5)'; ctx.lineWidth=1; ctx.stroke();
}

function drawBatter(){
  // Simplified batter silhouette — right-handed
  const bx=W*.32, by=H*.62;
  ctx.fillStyle='rgba(160,180,200,0.35)';

  // Body
  ctx.beginPath();
  ctx.ellipse(bx,by+H*.08,W*.028,H*.11,-.1,0,Math.PI*2); ctx.fill();

  // Head + helmet
  ctx.fillStyle='rgba(140,160,180,0.45)';
  ctx.beginPath();
  ctx.arc(bx+W*.008,by-H*.01,W*.024,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(60,80,100,0.6)';
  ctx.beginPath();
  ctx.arc(bx+W*.008,by-H*.02,W*.022,Math.PI,Math.PI*2); ctx.fill();

  // Bat
  ctx.strokeStyle='rgba(180,140,80,0.7)'; ctx.lineWidth=3;
  ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(bx+W*.04,by+H*.04);
  ctx.lineTo(bx-W*.04,by-H*.12);
  ctx.stroke();
  ctx.lineCap='butt';

  // Legs
  ctx.strokeStyle='rgba(140,160,180,0.35)'; ctx.lineWidth=W*.018;
  ctx.beginPath();
  ctx.moveTo(bx,by+H*.17); ctx.lineTo(bx+W*.02,by+H*.26);
  ctx.moveTo(bx,by+H*.17); ctx.lineTo(bx-W*.02,by+H*.26);
  ctx.stroke();
}

function drawKZone(){
  // Heatmap cells background BEHIND the zone border
  const cw=ZW/3, ch=ZH/3;
  for(let r=0;r<3;r++) for(let c=0;c<3;c++){
    const v=heatmap[r*3+c], mx=maxHeat();
    const heat=v/mx;
    let fc;
    if(heat>.7)       fc=C.hotFill;
    else if(heat>.35) fc=C.warmFill;
    else if(heat>.0)  fc=C.coolFill;
    else              fc=C.zoneFill;
    ctx.fillStyle=fc;
    ctx.fillRect(ZX+c*cw, ZY+r*ch, cw, ch);
  }

  // Zone border grid
  ctx.strokeStyle=C.zoneGrid; ctx.lineWidth=.8;
  for(let i=1;i<3;i++){
    ctx.beginPath(); ctx.moveTo(ZX+i*cw,ZY); ctx.lineTo(ZX+i*cw,ZY+ZH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ZX,ZY+i*ch); ctx.lineTo(ZX+ZW,ZY+i*ch); ctx.stroke();
  }

  // Outer border with glow
  ctx.shadowColor=C.blue; ctx.shadowBlur=8;
  ctx.strokeStyle=C.zoneStroke; ctx.lineWidth=1.8;
  ctx.strokeRect(ZX,ZY,ZW,ZH);
  ctx.shadowBlur=0;

  // Zone label
  ctx.fillStyle=C.blue;
  ctx.font=`bold ${Math.round(W*.022)}px 'JetBrains Mono',monospace`;
  ctx.textAlign='center';
  ctx.fillText('STRIKE ZONE', ZX+ZW/2, ZY-8);

  // Plate representation below zone
  ctx.fillStyle='rgba(220,220,220,0.6)';
  const pw=ZW*.7, ph=8;
  ctx.fillRect(ZX+(ZW-pw)/2, ZY+ZH+4, pw, ph);
}

function drawHeatmap(){
  // Count label in top-right corner of zone
  const cw=ZW/3;
  for(let r=0;r<3;r++) for(let c=0;c<3;c++){
    const v=heatmap[r*3+c];
    if(v>0){
      ctx.fillStyle='rgba(255,255,255,0.55)';
      ctx.font=`${Math.round(W*.016)}px 'JetBrains Mono',monospace`;
      ctx.textAlign='center';
      ctx.fillText(v, ZX+c*cw+cw/2, ZY+r*(ZH/3)+(ZH/3)*.55);
    }
  }
}

function drawHistoryDots(){
  history.forEach(({nx,ny,clr})=>{
    const{px,py}=normToCanvas(nx,ny);
    ctx.fillStyle=clr+'99';
    ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2); ctx.fill();
  });
}

function drawPitchDot(){
  const{r,clr,x,y}=pitchDot;
  // Glow
  ctx.shadowColor=clr; ctx.shadowBlur=14;
  ctx.fillStyle=clr;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  // White core
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(x,y,r*.38,0,Math.PI*2); ctx.fill();
  // Seams
  ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.arc(x-r*.2,y,r*.55,Math.PI*.1,Math.PI*.9); ctx.stroke();
  ctx.beginPath();
  ctx.arc(x+r*.2,y,r*.55,Math.PI*1.1,Math.PI*1.9); ctx.stroke();
}

function drawCountBar(){
  const barX=W*.03, barY=H*.06, dotR=7, gap=18;
  ctx.textAlign='left';

  // BALLS
  ctx.fillStyle='rgba(200,210,220,0.7)';
  ctx.font=`bold ${Math.round(W*.025)}px 'Barlow Condensed',sans-serif`;
  ctx.fillText('BALLS', barX, barY);
  for(let i=0;i<4;i++){
    ctx.fillStyle=i<COUNT.b?C.green:'rgba(80,90,100,0.5)';
    ctx.beginPath(); ctx.arc(barX+i*(dotR*2+4), barY+14, dotR, 0, Math.PI*2); ctx.fill();
  }

  // STRIKES
  ctx.fillStyle='rgba(200,210,220,0.7)';
  ctx.fillText('STRIKES', barX, barY+44);
  for(let i=0;i<3;i++){
    ctx.fillStyle=i<COUNT.s?C.amber:'rgba(80,90,100,0.5)';
    ctx.beginPath(); ctx.arc(barX+i*(dotR*2+4), barY+58, dotR, 0, Math.PI*2); ctx.fill();
  }

  // OUTS
  ctx.fillStyle='rgba(200,210,220,0.7)';
  ctx.fillText('OUTS', barX, barY+88);
  for(let i=0;i<3;i++){
    ctx.fillStyle=i<COUNT.o?C.red:'rgba(80,90,100,0.5)';
    ctx.beginPath(); ctx.arc(barX+i*(dotR*2+4), barY+102, dotR, 0, Math.PI*2); ctx.fill();
  }
}

function drawPitchTypeLabel(){
  if(!infoVisible) return;
  ctx.textAlign='center';
  ctx.fillStyle=C.gold;
  ctx.font=`bold ${Math.round(W*.036)}px 'Barlow Condensed',sans-serif`;
  ctx.fillText(currentPitchType.toUpperCase(), W*.5, H*.9);
  ctx.fillStyle='rgba(200,210,220,0.75)';
  ctx.font=`${Math.round(W*.026)}px 'JetBrains Mono',monospace`;
  ctx.fillText(currentSpeed+' MPH', W*.5, H*.93+14);
}

// Normalised zone coords → canvas pixels
function normToCanvas(nx,ny){
  const px=ZX+ZW/2+nx*(ZW/2);
  const py=ZY+ZH/2-ny*(ZH/2);
  return{px,py};
}

// ── PITCH BALL ANIMATION ───────────────────────────────────────
function animPitch(){
  pitchAnim.t+=16;
  const t=Math.min(1,pitchAnim.t/pitchAnim.dur);
  const ease=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  const bx=(1-ease)*((1-t)*pitchAnim.sx+t*pitchAnim.mx)+ease*pitchAnim.ex;
  const by=(1-ease)*((1-t)*pitchAnim.sy+t*pitchAnim.my)+ease*pitchAnim.ey;

  // Trail
  ctx.strokeStyle=pitchAnim.clr+'44'; ctx.lineWidth=4;
  ctx.shadowColor=pitchAnim.clr; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.moveTo(pitchAnim.sx,pitchAnim.sy);
  ctx.quadraticCurveTo(pitchAnim.mx,pitchAnim.my,bx,by); ctx.stroke();
  ctx.shadowBlur=0;

  // Ball
  ctx.fillStyle=pitchAnim.clr;
  ctx.beginPath(); ctx.arc(bx,by,9,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.arc(bx,by,3.5,0,Math.PI*2); ctx.fill();

  if(t>=1) pitchLanded();
}

function pitchLanded(){
  phase='pitch';
  const rs=resultState;
  if(!rs) return;
  const{nx,ny}=rs;
  const{px,py}=normToCanvas(nx,ny);
  pitchDot={x:px,y:py,r:11,clr:rs.clr};
  history.push({nx,ny,clr:rs.clr});
  bumpHeat(nx,ny);
  infoVisible=true;
  currentPitchType=rs.pitchType;
  currentSpeed=rs.speed;

  // Ripple
  ripples.push({x:px,y:py,r:0,a:1,clr:rs.clr});

  // After short delay show field view
  setTimeout(()=>{ startFlightPhase(rs); },900);
}

// ══════════════════════════════════════════════════════════════
// ── PHASE 2: OVERHEAD FIELD VIEW + BALL TRAJECTORY ────────────
// ══════════════════════════════════════════════════════════════
let flightPath=[];   // [{x,y}] bezier control points
let ballPos={x:0,y:0};
let ballShadow={x:0,y:0,s:1};
let FIELD={cx:0,cy:0,r:0,hx:0,hy:0};  // field geometry

function drawField(){
  // Dark bg
  ctx.fillStyle='#05080d';
  ctx.fillRect(0,0,W,H);

  const cx=FIELD.cx, cy=FIELD.cy, r=FIELD.r;

  // ── Warning track (outer ring) ──
  ctx.fillStyle=C.dirtDark;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();

  // ── Grass field (foul lines angled) ──
  const foulAngleL=Math.PI*.22, foulAngleR=Math.PI*.78;
  ctx.fillStyle=C.grass;
  ctx.beginPath();
  ctx.moveTo(FIELD.hx,FIELD.hy);
  ctx.arc(cx,cy,r,foulAngleL,foulAngleR);
  ctx.closePath(); ctx.fill();

  // ── Grass alternating mow strips ──
  drawMowLines(cx,cy,r,foulAngleL,foulAngleR);

  // ── Infield dirt circle ──
  const ir=r*.34;
  ctx.fillStyle=C.dirt;
  ctx.beginPath(); ctx.arc(cx,cy,ir,0,Math.PI*2); ctx.fill();

  // ── Infield grass ──
  const igr=ir*.76;
  ctx.fillStyle=C.grass;
  ctx.beginPath(); ctx.arc(cx,cy,igr,0,Math.PI*2); ctx.fill();

  // ── Base paths ──
  const bd=ir*.78; // distance from center to base
  const bases=[
    {x:cx,    y:cy-bd}, // 2B (top)
    {x:cx+bd, y:cy},    // 1B (right)
    {x:cx,    y:cy+bd*.08,isHome:true}, // home (bottom-ish)
    {x:cx-bd, y:cy},    // 3B (left)
  ];
  ctx.strokeStyle=C.dirtLight; ctx.lineWidth=3;
  ctx.fillStyle=C.dirt;
  ctx.beginPath();
  ctx.moveTo(bases[0].x,bases[0].y);
  ctx.lineTo(bases[1].x,bases[1].y);
  ctx.lineTo(FIELD.hx, FIELD.hy+ir*.1);
  ctx.lineTo(bases[3].x,bases[3].y);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // ── Pitcher's mound ──
  ctx.fillStyle=C.mound;
  ctx.beginPath(); ctx.ellipse(cx,cy,ir*.12,ir*.09,0,0,Math.PI*2); ctx.fill();

  // ── Bases ──
  bases.forEach(({x,y,isHome})=>{
    if(isHome){
      ctx.fillStyle='rgba(230,230,230,0.9)';
      ctx.beginPath();
      ctx.moveTo(x,y-7); ctx.lineTo(x+7,y);
      ctx.lineTo(x+7,y+5); ctx.lineTo(x-7,y+5);
      ctx.lineTo(x-7,y); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle='rgba(230,230,230,0.88)';
      ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI/4);
      ctx.fillRect(-5,-5,10,10); ctx.restore();
    }
  });

  // ── Foul lines ──
  ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(FIELD.hx,FIELD.hy);
  ctx.lineTo(cx+Math.cos(foulAngleL)*r, cy+Math.sin(foulAngleL)*r);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(FIELD.hx,FIELD.hy);
  ctx.lineTo(cx+Math.cos(foulAngleR)*r, cy+Math.sin(foulAngleR)*r);
  ctx.stroke();

  // Store home and 1B/2B/3B for trajectory
  FIELD.bases=bases; FIELD.hx=FIELD.hx;
}

function drawMowLines(cx,cy,r,a1,a2){
  const strips=6;
  for(let i=0;i<strips;i++){
    const r1=r*.36+i*((r*.94-r*.36)/strips);
    const r2=r1+(r*.94-r*.36)/strips;
    if(i%2===0) ctx.fillStyle='rgba(26,74,24,0.6)';
    else         ctx.fillStyle='rgba(20,58,18,0.6)';
    ctx.beginPath();
    ctx.moveTo(FIELD.hx,FIELD.hy);
    ctx.arc(cx,cy,r2,a1,a2);
    ctx.arc(cx,cy,r1,a2,a1,true);
    ctx.closePath(); ctx.fill();
  }
}

// ── FLIGHT ANIMATION ───────────────────────────────────────────
function startFlightPhase(rs){
  phase='flight';
  flightAnim.t=0; flightAnim.done=false;

  const hx=FIELD.hx, hy=FIELD.hy;
  const cx=FIELD.cx, cy=FIELD.cy;
  const r=FIELD.r;
  const bases=FIELD.bases||[];

  // Determine where the ball goes based on result
  const inZ=rs.inZone, isOK=rs.isCorrect;
  const rtype=getResultType(rs.pitchType, rs.loc, inZ);
  fieldResult=rtype;

  // Update info bar
  const badge=document.getElementById('pitch-result');
  if(badge){
    badge.textContent=rtype.replace(/_/g,' ').toUpperCase();
    badge.className='pz-result-badge '+(isOK?'correct':'wrong');
  }

  // Ball start = pitcher's mound
  const sx=cx, sy=cy;
  let ex,ey,mx_ctrl,my_ctrl,arcH;

  if(rtype==='strikeout'||rtype==='ball'){
    // Ball goes to catcher (home plate)
    ex=hx; ey=hy+8;
    mx_ctrl=cx; my_ctrl=cy+(hy-cy)*.5;
    arcH=0;
  } else if(rtype==='single'){
    // Line drive into outfield center or right
    const ang=-Math.PI*.5+((Math.random()-.5)*.4);
    ex=cx+Math.cos(ang)*r*.72; ey=cy+Math.sin(ang)*r*.72;
    mx_ctrl=cx+Math.cos(ang)*r*.35; my_ctrl=cy+Math.sin(ang)*r*.35-H*.06;
    arcH=1;
  } else if(rtype==='fly_out'){
    const ang=-Math.PI*.5+((Math.random()-.5)*.6);
    ex=cx+Math.cos(ang)*r*.78; ey=cy+Math.sin(ang)*r*.78;
    mx_ctrl=cx+Math.cos(ang)*r*.4; my_ctrl=cy+Math.sin(ang)*r*.4-H*.12;
    arcH=2;
  } else if(rtype==='home_run'){
    const ang=-Math.PI*.5+((Math.random()-.5)*.5);
    ex=cx+Math.cos(ang)*(r+30); ey=cy+Math.sin(ang)*(r+30);
    mx_ctrl=cx+Math.cos(ang)*r*.5; my_ctrl=cy+Math.sin(ang)*r*.5-H*.18;
    arcH=3;
  } else { // grounder
    const ang=-Math.PI*.5+((Math.random()-.5)*.5);
    ex=cx+Math.cos(ang)*r*.55; ey=cy+Math.sin(ang)*r*.55;
    mx_ctrl=cx+Math.cos(ang)*r*.28; my_ctrl=cy+Math.sin(ang)*r*.28;
    arcH=0;
  }

  flightPath={sx,sy,mx:mx_ctrl,my:my_ctrl,ex,ey,arcH,rtype};
  flightAnim.clr=pitchClr(rs.pitchType);
}

function animFlight(){
  flightAnim.t+=14;
  const raw=flightAnim.t/flightAnim.dur;
  if(raw>=1){ flightAnim.done=true; phase='result_field'; return; }
  const t=raw<.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2;
  const{sx,sy,mx,my,ex,ey,arcH}=flightPath;

  // Quadratic bezier
  const bx=(1-t)*(1-t)*sx+2*(1-t)*t*mx+t*t*ex;
  const by=(1-t)*(1-t)*sy+2*(1-t)*t*my+t*t*ey;

  // Vertical arc for fly balls (up then down)
  const arcOff=arcH>0?Math.sin(t*Math.PI)*H*(.04*arcH):0;
  const ballY=by; // field is overhead, Y is field position not height

  // Shadow (smaller ahead of ball for fly balls)
  const shadowScale=arcH>0?(0.4+0.6*Math.abs(t-.5)*2):1;
  ctx.fillStyle='rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(bx,ballY+6,8*shadowScale,4*shadowScale,0,0,Math.PI*2); ctx.fill();

  // Trail
  if(raw>.05){
    const t0=Math.max(0,raw-.15);
    const bx0=(1-t0)*(1-t0)*sx+2*(1-t0)*t0*mx+t0*t0*ex;
    const by0=(1-t0)*(1-t0)*sy+2*(1-t0)*t0*my+t0*t0*ey;
    const trl=ctx.createLinearGradient(bx0,by0,bx,ballY);
    trl.addColorStop(0,'transparent');
    trl.addColorStop(1,flightPath.rtype==='home_run'?C.gold+'cc':C.blue+'99');
    ctx.strokeStyle=trl; ctx.lineWidth=3;
    ctx.shadowColor=flightPath.rtype==='home_run'?C.gold:C.blue;
    ctx.shadowBlur=8;
    ctx.beginPath(); ctx.moveTo(bx0,by0); ctx.lineTo(bx,ballY); ctx.stroke();
    ctx.shadowBlur=0;
  }

  // Ball size changes with arc (bigger when closer/lower)
  const ballR=arcH>0?(7+arcH*3*Math.sin(t*Math.PI)):8;
  ctx.fillStyle='rgba(245,245,245,0.95)';
  ctx.shadowColor='rgba(255,255,255,0.6)'; ctx.shadowBlur=arcH>0?6:2;
  ctx.beginPath(); ctx.arc(bx,ballY,ballR,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  // Seams
  ctx.strokeStyle='rgba(200,60,60,0.7)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(bx-ballR*.2,ballY,ballR*.55,Math.PI*.1,Math.PI*.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx+ballR*.2,ballY,ballR*.55,Math.PI*1.1,Math.PI*1.9); ctx.stroke();
}

function drawFieldResult(){
  const{ex,ey,rtype}=flightPath;
  // Draw the landing spot
  if(rtype==='home_run'){
    // HR firework burst
    const now=Date.now()%800/800;
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2, d=20+now*35;
      ctx.fillStyle=`hsl(${i*30},100%,65%,${1-now})`;
      ctx.beginPath(); ctx.arc(ex+Math.cos(a)*d,ey+Math.sin(a)*d,3,0,Math.PI*2); ctx.fill();
    }
    ctx.fillStyle=C.gold;
    ctx.font=`bold ${Math.round(W*.04)}px 'Barlow Condensed',sans-serif`;
    ctx.textAlign='center';
    ctx.fillText('HOME RUN!', W/2, H*.12);
  } else {
    // Ball at rest
    ctx.fillStyle='rgba(245,245,245,0.9)';
    ctx.beginPath(); ctx.arc(ex,ey,7,0,Math.PI*2); ctx.fill();
    // Ripple ring
    const rr=(Date.now()%600)/600*20;
    ctx.strokeStyle=`rgba(255,255,255,${0.6*(1-rr/20)})`;
    ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(ex,ey,7+rr,0,Math.PI*2); ctx.stroke();
  }

  // Result label
  ctx.fillStyle=rtype==='strikeout'?C.amber:rtype==='home_run'?C.gold:rtype==='ball'?C.green:C.white;
  ctx.font=`bold ${Math.round(W*.038)}px 'Barlow Condensed',sans-serif`;
  ctx.textAlign='center';
  ctx.fillText(rtype.replace(/_/g,' ').toUpperCase(), W/2, H*.92);
}

function getResultType(pitchType, loc, inZone){
  const l=(loc||'').toLowerCase();
  if(!inZone) return Math.random()<.8?'ball':'foul_ball';
  // Strike zone — result depends on pitch type tendency
  const r=Math.random();
  const t=(pitchType||'').toLowerCase();
  if(t.includes('fastball')||t.includes('sinker')){
    if(r<.12) return 'home_run';
    if(r<.32) return 'single';
    if(r<.52) return 'fly_out';
    if(r<.68) return 'grounder';
    return 'strikeout';
  }
  if(t.includes('curve')||t.includes('change')||t.includes('split')){
    if(r<.08) return 'single';
    if(r<.22) return 'grounder';
    if(r<.38) return 'fly_out';
    return 'strikeout';
  }
  // Slider/cutter
  if(r<.10) return 'single';
  if(r<.28) return 'fly_out';
  if(r<.44) return 'grounder';
  return 'strikeout';
}

// ══════════════════════════════════════════════════════════════
// ── PUBLIC API ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function showPitchZone(locLabel, isCorrect, pitchType, speed, balls, strikes, outs){
  if(!canvas||!ctx) _bootKZone();
  COUNT={b:balls,s:strikes,o:outs};
  infoVisible=false; pitchDot=null; phase='anim';

  const loc=getLoc(locLabel);
  const brk=getBreak(pitchType);
  const clr=pitchClr(pitchType);
  const{px:ex,py:ey}=normToCanvas(loc.x,loc.y);

  resultState={nx:loc.x,ny:loc.y,clr,isCorrect,pitchType,speed,loc:locLabel,inZone:loc.iz};

  // Start from mound position
  const sx=W*.22, sy=H*.68;
  const mx=sx+(ex-sx)*.5+brk.bx*ZW;
  const my=sy+(ey-sy)*.5+brk.by*ZH;

  pitchAnim={t:0,dur:480,sx,sy,mx,my,ex,ey,clr};
  flightAnim.dur=rtype_dur(pitchType);
}

function rtype_dur(t){
  const l=(t||'').toLowerCase();
  if(l.includes('knuckle')) return 1200;
  if(l.includes('curve'))   return 1000;
  if(l.includes('change'))  return 950;
  if(l.includes('fastball')) return 780;
  return 880;
}

function resetPitchZone(){
  phase='pitch'; pitchDot=null; infoVisible=false; ripples=[];
  flightAnim.done=false; fieldResult=null;
  if(canvas&&ctx){ layout(); }
}

function newAtBat(){
  heatmap=new Array(9).fill(0).map(()=>0);
  history=[]; COUNT={b:0,s:0,o:0};
  resetPitchZone();
}

// ── BOOT ──────────────────────────────────────────────────────
function _bootKZone(){
  canvas=document.getElementById('kzone-canvas');
  if(!canvas){ window._kzoneBooted=false; return; }
  ctx=canvas.getContext('2d');
  layout();

  // Compute field geometry based on canvas size
  FIELD.r=Math.min(W,H)*.42;
  FIELD.cx=W*.5;
  FIELD.cy=H*.52;
  FIELD.hx=W*.5;
  FIELD.hy=H*.88;

  window.addEventListener('resize',()=>{ layout(); FIELD.r=Math.min(W,H)*.42; FIELD.cx=W*.5; FIELD.cy=H*.52; FIELD.hx=W*.5; FIELD.hy=H*.88; });
  window._kzoneBooted=true;
  if(animId) cancelAnimationFrame(animId);
  loop();
}

// Expose API
window.showPitchZone=showPitchZone;
window.resetPitchZone=resetPitchZone;
window.newAtBat=newAtBat;
window._bootKZone=_bootKZone;

// Auto-boot if canvas already in DOM
if(document.getElementById('kzone-canvas')) _bootKZone();
else document.addEventListener('DOMContentLoaded',()=>{
  if(document.getElementById('kzone-canvas')) _bootKZone();
});

})();
