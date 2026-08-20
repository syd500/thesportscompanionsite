// ── SSC K-Zone ESPN-Style v3 ────────────────────────────────────
// Phase 1: Light bg, detailed batter silhouette, heatmap K-Zone
// Phase 2: Isometric 3D field view with arc ball trajectory
(function(){
'use strict';

// ── PALETTE ────────────────────────────────────────────────────
const C = {
  // Phase 1 — light background like ESPN
  bg1:       '#f0f2f5',
  bgGrad1:   '#e8eaed',
  grass1:    '#4a7c3f',
  grass1l:   '#5a9a4d',
  dirt1:     '#c8956b',
  batter:    '#9fb3c8',
  batterDark:'#6b8399',
  bat:       '#c8a06b',
  plate:     '#e8e8e8',
  zoneStroke:'#333',
  zoneGrid:  'rgba(0,0,0,0.15)',
  zoneBg:    'rgba(255,255,255,0.6)',
  // Heatmap
  hot:       'rgba(220,60,40,0.55)',
  warm:      'rgba(235,150,40,0.45)',
  cool:      'rgba(70,140,210,0.35)',
  cold:      'rgba(255,255,255,0.0)',
  // Count dots
  ballClr:   '#4caf50',
  strikeClr: '#ef5350',
  outClr:    '#ef5350',
  emptyDot:  '#d0d5db',
  // Text
  textDark:  '#1a1a2e',
  textMid:   '#555',
  textLight: '#888',
  // Phase 2 — field
  sky2:      '#f5f7fa',
  grass2:    '#5a8c4e',
  grass2l:   '#6aab5c',
  grass2s:   '#4e7a44',
  infield:   '#c8956b',
  infieldl:  '#d9a87a',
  track:     '#b8855e',
  baseLine:  '#c0a070',
  white:     '#ffffff',
  gold:      '#F2C230',
  blue:      '#1565C0',
};

// Pitch type colours (ESPN-style: red=FB, blue=CB, purple=SL, green=CH)
const PCLR = {
  fastball:'#e53935','4-seam':'#e53935','2-seam':'#e57373',
  sinker:'#ef6c00', cutter:'#f9a825', curveball:'#1565c0',
  slider:'#6a1b9a', changeup:'#2e7d32', splitter:'#00838f',
  knuckleball:'#558b2f', default:'#555',
};
function pitchClr(t){
  if(!t) return PCLR.default;
  const l=t.toLowerCase();
  for(const[k,v] of Object.entries(PCLR)) if(l.includes(k)) return v;
  return PCLR.default;
}

// Zone locations
const ZLOCS = {
  'up & in':{x:-.67,y:.67,iz:true},'up & middle':{x:0,y:.67,iz:true},
  'up & away':{x:.67,y:.67,iz:true},'middle-in':{x:-.67,y:0,iz:true},
  'middle':{x:0,y:0,iz:true},'down the middle':{x:0,y:0,iz:true},
  'middle-away':{x:.67,y:0,iz:true},'down & in':{x:-.67,y:-.67,iz:true},
  'down & middle':{x:0,y:-.67,iz:true},'down & away':{x:.67,y:-.67,iz:true},
  'arm side':{x:-.67,y:0,iz:true},'glove side':{x:.67,y:0,iz:true},
  'up':{x:0,y:.67,iz:true},'backdoor':{x:.9,y:-.5,iz:true},
  '12-6':{x:0,y:-.67,iz:true},'inside':{x:-1.6,y:0,iz:false},
  'outside':{x:1.6,y:0,iz:false},'high':{x:0,y:1.7,iz:false},
  'low':{x:0,y:-1.7,iz:false},'bounce':{x:0,y:-2.3,iz:false},
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
  if(l.includes('curve'))    return{bx:.16,by:-.22};
  if(l.includes('slider'))   return{bx:.13,by:-.09};
  if(l.includes('cutter'))   return{bx:.07,by:-.04};
  if(l.includes('sinker')||l.includes('2-seam')) return{bx:.06,by:-.16};
  if(l.includes('change'))   return{bx:.07,by:-.14};
  if(l.includes('split'))    return{bx:.04,by:-.20};
  return{bx:0,by:.04};
}

// Heatmap — 9 cells (3×3 grid)
let heatmap=new Array(9).fill(0);
function heatCell(nx,ny){
  const col=nx<-0.33?0:nx<0.33?1:2;
  const row=ny>0.33?0:ny>-0.33?1:2;
  return row*3+col;
}
function bumpHeat(nx,ny){ if(Math.abs(nx)<=1&&Math.abs(ny)<=1) heatmap[heatCell(nx,ny)]++; }
function maxHeat(){ return Math.max(1,...heatmap); }

// ── STATE ──────────────────────────────────────────────────────
let canvas,ctx,W=680,H=360;
let ZX=0,ZY=0,ZW=0,ZH=0;
let COUNT={b:0,s:0,o:0};
let history=[];
let phase='idle'; // idle|anim|pitch|flight|result_field
let pitchAnim={t:0,dur:480};
let pitchDot=null;
let resultState=null;
let infoVisible=false;
let flightAnim={t:0,dur:900};
let flightPath=null;
let animId=null;
let FIELD={};

// ── MAIN LOOP ──────────────────────────────────────────────────
function loop(){
  animId=requestAnimationFrame(loop);
  ctx.clearRect(0,0,W,H);
  if(phase==='flight'||phase==='result_field') drawFieldView();
  else drawPitchView();
}

// ══════════════════════════════════════════════════════════════
// PHASE 1 — BATTER + K-ZONE (light background, ESPN style)
// ══════════════════════════════════════════════════════════════
function drawPitchView(){
  // Light grey gradient background
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#eef0f3'); bg.addColorStop(1,'#e2e5ea');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Ground strip
  const gnd=ctx.createLinearGradient(0,H*.58,0,H);
  gnd.addColorStop(0,C.grass1); gnd.addColorStop(1,'#3a6232');
  ctx.fillStyle=gnd; ctx.fillRect(0,H*.58,W,H*.42);

  // Grass mow stripes
  for(let i=0;i<6;i++){
    const y1=H*.58+i*(H*.42/6), y2=y1+H*.42/6;
    ctx.fillStyle=i%2===0?'rgba(0,0,0,0.04)':'rgba(255,255,255,0.04)';
    ctx.fillRect(0,y1,W,y2-y1);
  }

  // Home plate area — dirt circle
  const px=W*.24, py=H*.78;
  ctx.fillStyle=C.dirt1;
  ctx.beginPath(); ctx.ellipse(px,py,W*.11,H*.11,0,0,Math.PI*2); ctx.fill();

  // Home plate pentagon
  drawHomePlate(px, py+H*.04);

  // Batter silhouette — ESPN style (light grey, facing right/toward zone)
  drawESPNBatter(W*.25, H*.64);

  // K-Zone with heatmap
  drawESPNKZone();

  // History dots on zone
  history.forEach(({nx,ny,clr,num})=>{
    const{px,py}=normToCanvas(nx,ny);
    // Shadow
    ctx.fillStyle='rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.arc(px+1,py+1,11,0,Math.PI*2); ctx.fill();
    // Dot
    ctx.fillStyle=clr;
    ctx.beginPath(); ctx.arc(px,py,11,0,Math.PI*2); ctx.fill();
    // Number
    ctx.fillStyle='#fff';
    ctx.font=`bold ${Math.round(W*.022)}px Arial,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(num,px,py);
    ctx.textBaseline='alphabetic';
  });

  // Active pitch dot
  if(pitchDot&&phase==='pitch'){
    const{x,y,clr,num}=pitchDot;
    ctx.fillStyle='rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.arc(x+1,y+1,13,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=clr;
    ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='#fff';
    ctx.font=`bold ${Math.round(W*.024)}px Arial,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(num,x,y);
    ctx.textBaseline='alphabetic';
  }

  // Count bar — ESPN style top strip
  drawESPNCountBar();

  // On base display — bottom
  drawOnBase();

  // Pitch animation
  if(phase==='anim') animatePitch();
}

function drawHomePlate(cx,cy){
  const w=W*.038, h=w*.7;
  ctx.fillStyle='rgba(240,240,240,0.9)';
  ctx.strokeStyle='rgba(150,150,150,0.6)'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(cx,cy-h); ctx.lineTo(cx+w,cy);
  ctx.lineTo(cx+w,cy+h*.5); ctx.lineTo(cx-w,cy+h*.5); ctx.lineTo(cx-w,cy);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function drawESPNBatter(cx,cy){
  // Clean light-grey batter silhouette, right-handed stance facing the zone
  const s=Math.min(W,H)*.01; // scale unit

  ctx.save();
  ctx.fillStyle='#9fb3c8';
  ctx.strokeStyle='#8aa0b5';
  ctx.lineWidth=1;

  // Head (helmet)
  ctx.beginPath();
  ctx.arc(cx+s*1.5, cy-s*8.5, s*3.5, 0, Math.PI*2);
  ctx.fill();
  // Helmet brim
  ctx.beginPath();
  ctx.ellipse(cx+s*3.2, cy-s*7.5, s*2.5, s*1.2, 0.3, 0, Math.PI*2);
  ctx.fill();

  // Torso
  ctx.beginPath();
  ctx.moveTo(cx-s*1.5, cy-s*5);
  ctx.lineTo(cx+s*3,   cy-s*5);
  ctx.lineTo(cx+s*3.5, cy+s*2);
  ctx.lineTo(cx-s*1,   cy+s*2);
  ctx.closePath(); ctx.fill();

  // Back arm (left, back)
  ctx.fillStyle='#8aa0b5';
  ctx.beginPath();
  ctx.moveTo(cx-s*1.5, cy-s*4);
  ctx.quadraticCurveTo(cx-s*5, cy-s*7, cx-s*3.5, cy-s*10);
  ctx.quadraticCurveTo(cx-s*2, cy-s*10.5, cx-s*1, cy-s*10);
  ctx.quadraticCurveTo(cx-s*2.5, cy-s*7, cx+s*.5, cy-s*4.5);
  ctx.closePath(); ctx.fill();

  // Front arm (right)
  ctx.fillStyle='#9fb3c8';
  ctx.beginPath();
  ctx.moveTo(cx+s*3, cy-s*4);
  ctx.quadraticCurveTo(cx+s*5, cy-s*7, cx+s*3, cy-s*10);
  ctx.quadraticCurveTo(cx+s*2, cy-s*10.5, cx+s*.5, cy-s*10);
  ctx.quadraticCurveTo(cx+s*2, cy-s*7, cx+s*1.5, cy-s*4.5);
  ctx.closePath(); ctx.fill();

  // Bat — angled up-left
  ctx.strokeStyle=C.bat; ctx.lineWidth=s*1.4; ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(cx+s*2, cy-s*9.5);
  ctx.lineTo(cx-s*5, cy-s*18);
  ctx.stroke();
  // Bat barrel
  ctx.lineWidth=s*2.2;
  ctx.beginPath();
  ctx.moveTo(cx-s*3.8, cy-s*16.5);
  ctx.lineTo(cx-s*5.5, cy-s*19);
  ctx.stroke();
  ctx.lineCap='butt';

  // Front leg
  ctx.fillStyle='#9fb3c8'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(cx+s*1, cy+s*2);
  ctx.quadraticCurveTo(cx+s*2, cy+s*6, cx+s*3, cy+s*11);
  ctx.quadraticCurveTo(cx+s*3.5, cy+s*11.5, cx+s*5, cy+s*11.5);
  ctx.quadraticCurveTo(cx+s*5.5, cy+s*11, cx+s*4, cy+s*10.5);
  ctx.quadraticCurveTo(cx+s*2.5, cy+s*5.5, cx+s*2.5, cy+s*2);
  ctx.closePath(); ctx.fill();

  // Back leg
  ctx.fillStyle='#8aa0b5';
  ctx.beginPath();
  ctx.moveTo(cx-s*1, cy+s*2);
  ctx.quadraticCurveTo(cx-s*1.5, cy+s*6, cx-s*2, cy+s*11);
  ctx.quadraticCurveTo(cx-s*2.5, cy+s*11.5, cx-s*.5, cy+s*11.5);
  ctx.quadraticCurveTo(cx+s*1, cy+s*11, cx+s*.5, cy+s*5.5);
  ctx.quadraticCurveTo(cx+s*1, cy+s*2.5, cx+s*.5, cy+s*2);
  ctx.closePath(); ctx.fill();

  // Cleats
  ctx.fillStyle='#6b8399';
  ctx.beginPath(); ctx.ellipse(cx+s*4.5,cy+s*11.5,s*2,s*1,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx-s*1,cy+s*11.5,s*2,s*1,0,0,Math.PI*2); ctx.fill();

  ctx.restore();
}

function drawESPNKZone(){
  const cw=ZW/3, ch=ZH/3;

  // Zone background
  ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillRect(ZX,ZY,ZW,ZH);

  // Heatmap cells
  const mx=maxHeat();
  for(let r=0;r<3;r++){
    for(let c=0;c<3;c++){
      const v=heatmap[r*3+c]/mx;
      let fc;
      if(v>.65)       fc=C.hot;
      else if(v>.35)  fc=C.warm;
      else if(v>.0)   fc=C.cool;
      else            fc=C.cold;
      if(v>0){
        ctx.fillStyle=fc;
        ctx.fillRect(ZX+c*cw+1, ZY+r*ch+1, cw-2, ch-2);
      }
    }
  }

  // Grid lines
  ctx.strokeStyle=C.zoneGrid; ctx.lineWidth=1;
  for(let i=1;i<3;i++){
    ctx.beginPath(); ctx.moveTo(ZX+i*cw,ZY); ctx.lineTo(ZX+i*cw,ZY+ZH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ZX,ZY+i*ch); ctx.lineTo(ZX+ZW,ZY+i*ch); ctx.stroke();
  }

  // Outer zone border — thick dark like ESPN
  ctx.strokeStyle='rgba(50,50,60,0.85)'; ctx.lineWidth=2.5;
  ctx.strokeRect(ZX,ZY,ZW,ZH);

  // Inner strike zone highlight (white box inside)
  ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1.5;
  ctx.strokeRect(ZX+3,ZY+3,ZW-6,ZH-6);

  // Plate representation below zone
  ctx.fillStyle='rgba(200,200,200,0.7)';
  const pw=ZW*.75;
  ctx.beginPath();
  ctx.moveTo(ZX+(ZW-pw)/2, ZY+ZH+2);
  ctx.lineTo(ZX+(ZW-pw)/2+pw, ZY+ZH+2);
  ctx.lineTo(ZX+(ZW-pw)/2+pw+4, ZY+ZH+10);
  ctx.lineTo(ZX+(ZW-pw)/2-4, ZY+ZH+10);
  ctx.closePath(); ctx.fill();
}

function drawESPNCountBar(){
  // ESPN style: BALLS ●○○○  STRIKES ●●○  OUTS ●●○
  // Positioned in top portion, white background strip
  const bx=W*.03, by=H*.04;
  ctx.font=`bold ${Math.round(W*.022)}px 'Arial',sans-serif`;
  ctx.textAlign='left';

  const sections=[
    {label:'BALLS',   count:COUNT.b, max:4, clr:C.ballClr},
    {label:'STRIKES', count:COUNT.s, max:3, clr:C.strikeClr},
    {label:'OUTS',    count:COUNT.o, max:3, clr:C.outClr},
  ];

  let x=bx;
  sections.forEach(({label,count,max,clr})=>{
    // Label
    ctx.fillStyle=C.textMid;
    ctx.font=`bold ${Math.round(W*.022)}px Arial,sans-serif`;
    ctx.fillText(label, x, by+H*.03);

    // Dots
    const dotR=6, gap=16;
    for(let i=0;i<max;i++){
      ctx.fillStyle=i<count?clr:C.emptyDot;
      ctx.beginPath();
      ctx.arc(x+i*gap, by+H*.065, dotR, 0, Math.PI*2);
      ctx.fill();
    }
    x+=Math.max(max*gap+40, label.length*14+40);
  });
}

function drawOnBase(){
  // Bottom strip: ON BASE: 1B: ○  2B: ○  3B: ○
  const y=H*.93;
  ctx.fillStyle='rgba(0,0,0,0.12)';
  ctx.fillRect(0,H*.88,W*.55,H*.12);

  ctx.fillStyle=C.textDark;
  ctx.font=`${Math.round(W*.018)}px Arial,sans-serif`;
  ctx.textAlign='left';
  ctx.fillText('ON BASE:', W*.03, y);

  const bases=['1B','2B','3B'];
  bases.forEach((b,i)=>{
    const bx=W*(.14+i*.12);
    ctx.fillStyle=C.textMid;
    ctx.fillText(b+':', bx, y);
    // Diamond shape
    ctx.strokeStyle=C.textMid; ctx.lineWidth=1.5;
    ctx.save(); ctx.translate(bx+W*.06, y-H*.012);
    ctx.rotate(Math.PI/4);
    ctx.strokeRect(-5,-5,10,10);
    ctx.restore();
  });
}

// Normalize zone coords to canvas pixels
function normToCanvas(nx,ny){
  const px=ZX+ZW/2+nx*(ZW/2.2);
  const py=ZY+ZH/2-ny*(ZH/2.2);
  return{px,py};
}

// ── PITCH ANIMATION ────────────────────────────────────────────
function animatePitch(){
  pitchAnim.t+=16;
  const t=Math.min(1,pitchAnim.t/pitchAnim.dur);
  const ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;

  const{sx,sy,mx,my,ex,ey,clr}=pitchAnim;
  const bx=(1-ease)*((1-t)*sx+t*mx)+ease*ex;
  const by=(1-ease)*((1-t)*sy+t*my)+ease*ey;

  // Trail
  if(t>.05){
    const t0=Math.max(0,t-.2);
    const bx0=(1-t0)*sx+t0*mx;
    const by0=(1-t0)*sy+t0*my;
    const grad=ctx.createLinearGradient(bx0,by0,bx,by);
    grad.addColorStop(0,'rgba(0,0,0,0)');
    grad.addColorStop(1,clr+'88');
    ctx.strokeStyle=grad; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(bx0,by0); ctx.lineTo(bx,by); ctx.stroke();
  }

  // Ball — white with coloured stroke
  ctx.fillStyle='rgba(255,255,255,0.95)';
  ctx.strokeStyle=clr; ctx.lineWidth=2.5;
  ctx.shadowColor=clr+'66'; ctx.shadowBlur=8;
  ctx.beginPath(); ctx.arc(bx,by,9,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur=0;
  // Seam lines
  ctx.strokeStyle='rgba(180,60,60,0.5)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(bx-3,by,6,Math.PI*.1,Math.PI*.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx+3,by,6,Math.PI*1.1,Math.PI*1.9); ctx.stroke();

  if(t>=1) pitchLanded();
}

function pitchLanded(){
  phase='pitch';
  const rs=resultState;
  if(!rs) return;
  const{px,py}=normToCanvas(rs.nx,rs.ny);
  const num=history.length+1;
  pitchDot={x:px,y:py,clr:rs.clr,num};
  history.push({nx:rs.nx,ny:rs.ny,clr:rs.clr,num});
  bumpHeat(rs.nx,rs.ny);
  infoVisible=true;
  setTimeout(()=>startFlightPhase(rs), 1000);
}

// ══════════════════════════════════════════════════════════════
// PHASE 2 — ISOMETRIC FIELD VIEW (ESPN perspective)
// ══════════════════════════════════════════════════════════════

// Isometric projection: world (x,y) → canvas (px,py)
// x = left-right on field, y = depth (0=home, 1=outfield)
function iso(wx,wy){
  // Field is a rhombus in perspective
  const F=FIELD;
  const px=F.cx + wx*F.hw - wy*F.hw*0.6;
  const py=F.cy - wy*F.hd + wx*F.hd*0.15;
  return{px,py};
}

function drawFieldView(){
  // Light background
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#f0f2f5'); bg.addColorStop(1,'#e2e5ea');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  drawIsoField();

  if(phase==='flight') animFlightIso();
  else drawFlightResult();
}

function drawIsoField(){
  const F=FIELD;

  // ── Outfield grass (behind infield) ──
  // Draw as a trapezoid
  const olf=iso(-1,1), orf=iso(1,1), orc=iso(0.6,0), olc=iso(-0.6,0);
  // Outfield warning track
  ctx.fillStyle=C.track;
  ctx.beginPath();
  ctx.moveTo(iso(-1.12,1.02).px, iso(-1.12,1.02).py);
  ctx.lineTo(iso(0,1.18).px,     iso(0,1.18).py);
  ctx.lineTo(iso(1.12,1.02).px,  iso(1.12,1.02).py);
  ctx.lineTo(iso(0.65,-0.02).px, iso(0.65,-0.02).py);
  ctx.lineTo(iso(-0.65,-0.02).px,iso(-0.65,-0.02).py);
  ctx.closePath(); ctx.fill();

  // Outfield grass
  ctx.fillStyle=C.grass2;
  ctx.beginPath();
  ctx.moveTo(iso(-1.0,1.0).px, iso(-1.0,1.0).py);
  ctx.lineTo(iso(0,1.12).px,   iso(0,1.12).py);
  ctx.lineTo(iso(1.0,1.0).px,  iso(1.0,1.0).py);
  ctx.lineTo(iso(0.6,0).px,    iso(0.6,0).py);
  ctx.lineTo(iso(-0.6,0).px,   iso(-0.6,0).py);
  ctx.closePath(); ctx.fill();

  // Outfield mow stripes
  for(let i=0;i<5;i++){
    const d=0.1+i*0.18;
    const left=iso(-0.6-d*.4,d), right=iso(0.6+d*.4,d);
    ctx.strokeStyle=i%2===0?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.06)';
    ctx.lineWidth=12;
    ctx.beginPath(); ctx.moveTo(left.px,left.py); ctx.lineTo(right.px,right.py); ctx.stroke();
  }

  // ── Infield dirt ──
  const bases=[
    iso(0,   0.55),  // 2B
    iso(0.52,0.28),  // 1B
    iso(0,   0.02),  // Home
    iso(-0.52,0.28), // 3B
  ];

  ctx.fillStyle=C.infield;
  ctx.beginPath();
  ctx.moveTo(bases[0].px,bases[0].py);
  ctx.lineTo(bases[1].px,bases[1].py);
  ctx.lineTo(bases[2].px,bases[2].py);
  ctx.lineTo(bases[3].px,bases[3].py);
  ctx.closePath(); ctx.fill();

  // Infield grass (inner diamond)
  const ig=[
    iso(0,    0.52),
    iso(0.48, 0.27),
    iso(0,    0.04),
    iso(-0.48, 0.27),
  ];
  ctx.fillStyle=C.grass2l;
  ctx.beginPath();
  ctx.moveTo(ig[0].px,ig[0].py);
  ctx.lineTo(ig[1].px,ig[1].py);
  ctx.lineTo(ig[2].px,ig[2].py);
  ctx.lineTo(ig[3].px,ig[3].py);
  ctx.closePath(); ctx.fill();

  // Infield mow stripes
  for(let i=0;i<4;i++){
    const d=0.08+i*0.12;
    const l=iso(-0.45+d*.1,0.05+d*.9), r=iso(0.45-d*.1,0.05+d*.9);
    ctx.strokeStyle=i%2===0?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.06)';
    ctx.lineWidth=8;
    ctx.beginPath(); ctx.moveTo(l.px,l.py); ctx.lineTo(r.px,r.py); ctx.stroke();
  }

  // Pitcher's mound
  const pm=iso(0,0.29);
  ctx.fillStyle=C.infieldl;
  ctx.beginPath(); ctx.ellipse(pm.px,pm.py,W*.04,H*.03,0,0,Math.PI*2); ctx.fill();

  // Foul lines
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(bases[2].px,bases[2].py);
  ctx.lineTo(iso(-1.05,1.0).px, iso(-1.05,1.0).py);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bases[2].px,bases[2].py);
  ctx.lineTo(iso(1.05,1.0).px, iso(1.05,1.0).py);
  ctx.stroke();

  // Base lines
  ctx.strokeStyle=C.baseLine; ctx.lineWidth=2;
  for(let i=0;i<4;i++){
    const next=bases[(i+1)%4];
    ctx.beginPath(); ctx.moveTo(bases[i].px,bases[i].py); ctx.lineTo(next.px,next.py); ctx.stroke();
  }

  // Bases
  bases.forEach((b,i)=>{
    if(i===2){ // home plate
      ctx.fillStyle='rgba(240,240,240,0.95)';
      ctx.beginPath();
      ctx.moveTo(b.px,b.py-8); ctx.lineTo(b.px+7,b.py);
      ctx.lineTo(b.px+7,b.py+5); ctx.lineTo(b.px-7,b.py+5); ctx.lineTo(b.px-7,b.py);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle='rgba(240,240,240,0.95)';
      ctx.save(); ctx.translate(b.px,b.py); ctx.rotate(Math.PI/5);
      ctx.fillRect(-5,-5,10,10); ctx.restore();
    }
  });

  // Store base positions for trajectory
  FIELD.bases=bases;
}

// ── ISOMETRIC FLIGHT ANIMATION ─────────────────────────────────
function animFlightIso(){
  flightAnim.t+=14;
  const raw=Math.min(1,flightAnim.t/flightAnim.dur);
  if(raw>=1){ phase='result_field'; return; }

  const ease=raw<.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2;
  const{swx,swy,ewx,ewy,arcH,clr}=flightPath;

  // Interpolate world coords
  const wx=(1-ease)*swx+ease*ewx;
  const wy=(1-ease)*swy+ease*ewy;
  const{px,py}=iso(wx,wy);

  // Arc height (vertical lift above field plane)
  const arc=Math.sin(raw*Math.PI)*H*(.05+arcH*.08);

  // Shadow (on field plane, no arc)
  const sha=iso(wx,wy);
  const shadowScale=Math.max(0.3, 1-arc/80);
  ctx.fillStyle=`rgba(0,0,0,${0.15*shadowScale})`;
  ctx.beginPath(); ctx.ellipse(sha.px,sha.py+4,10*shadowScale,5*shadowScale,0,0,Math.PI*2); ctx.fill();

  // Trail — dotted line from start to current (ESPN style)
  if(raw>.06){
    const steps=Math.floor(raw*12);
    for(let i=0;i<steps;i++){
      const tr=i/12;
      const te=tr<.5?4*tr*tr*tr:1-Math.pow(-2*tr+2,3)/2;
      const twx=(1-te)*swx+te*ewx;
      const twy=(1-te)*swy+te*ewy;
      const{px:tpx,py:tpy}=iso(twx,twy);
      const tarc=Math.sin(tr*Math.PI)*H*(.05+arcH*.08);
      ctx.fillStyle=`rgba(30,30,30,${0.3*(1-i/steps)})`;
      ctx.beginPath(); ctx.arc(tpx,tpy-tarc,2,0,Math.PI*2); ctx.fill();
    }
  }

  // Ball — white with coloured ring, size varies with height
  const ballR=7+arc/20;
  ctx.fillStyle='rgba(255,255,255,0.95)';
  ctx.strokeStyle=clr; ctx.lineWidth=2;
  ctx.shadowColor=clr+'44'; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.arc(px,py-arc,ballR,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(180,60,60,0.5)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(px-2,py-arc,ballR*.6,Math.PI*.1,Math.PI*.9); ctx.stroke();
}

function drawFlightResult(){
  if(!flightPath) return;
  const{ewx,ewy,clr,rtype}=flightPath;
  const{px,py}=iso(ewx,ewy);

  // Draw complete dotted trajectory from home to landing
  const{swx,swy,arcH}=flightPath;
  const steps=16;
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    const te=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    const wx=(1-te)*swx+te*ewx;
    const wy=(1-te)*swy+te*ewy;
    const{px:tp,py:tyy}=iso(wx,wy);
    const arc=Math.sin(t*Math.PI)*H*(.05+arcH*.08);
    ctx.fillStyle=`rgba(30,30,30,${0.4*(1-Math.abs(t-.5)*1.2)})`;
    ctx.beginPath(); ctx.arc(tp,tyy-arc,2.5,0,Math.PI*2); ctx.fill();
  }

  // Landing circle — ESPN shows a teal/blue target circle
  ctx.strokeStyle='#00bcd4'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(px,py,14,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='rgba(0,188,212,0.2)';
  ctx.beginPath(); ctx.arc(px,py,14,0,Math.PI*2); ctx.fill();

  // Ball at landing
  ctx.fillStyle='rgba(255,255,255,0.95)';
  ctx.strokeStyle=clr; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(px,py,7,0,Math.PI*2); ctx.fill(); ctx.stroke();

  // Result label
  const label=rtype.replace(/_/g,' ').toUpperCase();
  ctx.fillStyle=rtype==='home_run'?'#F2C230':C.textDark;
  ctx.font=`bold ${Math.round(W*.036)}px 'Barlow Condensed',Arial,sans-serif`;
  ctx.textAlign='center';
  ctx.fillText(label, W/2, H*.1);
  if(rtype==='home_run'){
    ctx.fillStyle='#F2C230';
    ctx.font=`${Math.round(W*.022)}px Arial,sans-serif`;
    ctx.fillText('🎉 Gone!', W/2, H*.14);
  }
}

function getResultType(pitchType,loc,inZone){
  if(!inZone) return Math.random()<.78?'ball':'foul_ball';
  const r=Math.random(), t=(pitchType||'').toLowerCase();
  if(t.includes('fastball')||t.includes('sinker')){
    if(r<.10) return 'home_run';
    if(r<.28) return 'single';
    if(r<.48) return 'fly_out';
    if(r<.62) return 'grounder';
    return 'strikeout';
  }
  if(t.includes('curve')||t.includes('change')||t.includes('split')){
    if(r<.06) return 'single';
    if(r<.18) return 'grounder';
    if(r<.32) return 'fly_out';
    return 'strikeout';
  }
  if(r<.08) return 'single'; if(r<.22) return 'fly_out';
  if(r<.36) return 'grounder'; return 'strikeout';
}

function startFlightPhase(rs){
  phase='flight';
  flightAnim.t=0;

  const rtype=getResultType(rs.pitchType,rs.loc,rs.inZone);
  const clr=rs.clr;

  // Start at home plate in world coords
  const swx=0, swy=0.02;
  let ewx, ewy, arcH;

  if(rtype==='strikeout'||rtype==='ball'||rtype==='foul_ball'){
    // Ball caught by catcher — short pop back
    ewx=(Math.random()-.5)*.1; ewy=-0.05; arcH=0.2;
  } else if(rtype==='home_run'){
    ewx=(Math.random()-.5)*.3; ewy=1.15; arcH=4;
  } else if(rtype==='single'){
    ewx=(Math.random()-.5)*.5; ewy=0.75+Math.random()*.15; arcH=1.5;
  } else if(rtype==='fly_out'){
    ewx=(Math.random()-.5)*.6; ewy=0.8+Math.random()*.15; arcH=2.5;
  } else { // grounder
    ewx=(Math.random()-.5)*.4; ewy=0.45+Math.random()*.2; arcH=0.3;
  }

  flightPath={swx,swy,ewx,ewy,arcH,clr,rtype};

  // Update result UI elements
  const badge=document.getElementById('pitch-result');
  if(badge){
    badge.textContent=rtype.replace(/_/g,' ').toUpperCase();
    badge.className='pz-result-badge '+(rs.isCorrect?'correct':'wrong');
  }
  const ov=document.getElementById('result-overlay');
  if(ov){
    ov.style.display='flex';
    const hl=document.getElementById('result-headline');
    const sl=document.getElementById('result-subline');
    if(hl) hl.textContent=rtype.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    if(sl) sl.textContent=`${rs.pitchType} · ${rs.speed} MPH · ${rs.inZone?'Strike zone':'Ball'}`;
  }
  const pl=document.getElementById('phase-label');
  if(pl){pl.textContent='FIELD VIEW';pl.style.color='#2e7d32';}
}

// ── LAYOUT + BOOT ──────────────────────────────────────────────
function layout(){
  const rect=canvas.getBoundingClientRect();
  W=canvas.width=Math.round(rect.width||canvas.offsetWidth||680);
  H=canvas.height=Math.round(rect.height||canvas.offsetHeight||360);

  // K-Zone layout
  ZW=Math.round(W*0.27); ZH=Math.round(ZW*1.2);
  ZX=Math.round(W*0.58); ZY=Math.round((H-ZH)*0.38);

  // Field geometry
  FIELD.cx=W*.5; FIELD.cy=H*.78;
  FIELD.hw=W*.38; FIELD.hd=H*.72;
}

function _bootKZone(){
  canvas=document.getElementById('kzone-canvas');
  if(!canvas){window._kzoneBooted=false;return;}
  ctx=canvas.getContext('2d');
  layout();
  if(window.ResizeObserver) new ResizeObserver(()=>layout()).observe(canvas);
  else window.addEventListener('resize',layout);
  window._kzoneBooted=true;
  if(animId) cancelAnimationFrame(animId);
  loop();
}

function showPitchZone(locLabel,isCorrect,pitchType,speed,balls,strikes,outs){
  if(!canvas||!ctx) _bootKZone();
  COUNT={b:balls,s:strikes,o:outs};
  infoVisible=false; pitchDot=null; phase='anim';
  pitchAnim.t=0;

  const loc=getLoc(locLabel);
  const brk=getBreak(pitchType);
  const clr=pitchClr(pitchType);
  const{px:ex,py:ey}=normToCanvas(loc.x,loc.y);
  resultState={nx:loc.x,ny:loc.y,clr,isCorrect,pitchType,speed,loc:locLabel,inZone:loc.iz};

  // Start from mound position
  const sx=W*.24,sy=H*.58;
  const mx=sx+(ex-sx)*.45+brk.bx*ZW;
  const my=sy+(ey-sy)*.45+brk.by*ZH;
  pitchAnim={t:0,dur:500,sx,sy,mx,my,ex,ey,clr};

  const pl=document.getElementById('phase-label');
  if(pl){pl.textContent='K-ZONE LIVE';pl.style.color='#1565c0';}
  const ov=document.getElementById('result-overlay');
  if(ov) ov.style.display='none';
}

function resetPitchZone(){
  phase='idle'; pitchDot=null; infoVisible=false; flightPath=null;
  const pl=document.getElementById('phase-label');
  if(pl){pl.textContent='K-ZONE LIVE';pl.style.color='#1565c0';}
  const ov=document.getElementById('result-overlay');
  if(ov) ov.style.display='none';
}

function newAtBat(){
  heatmap=new Array(9).fill(0);
  history=[]; COUNT={b:0,s:0,o:0};
  resetPitchZone();
}

// Expose
window.showPitchZone=showPitchZone;
window.resetPitchZone=resetPitchZone;
window.newAtBat=newAtBat;
window._bootKZone=_bootKZone;

// Boot when tab opens (not on DOMContentLoaded — canvas is hidden)
document.addEventListener('DOMContentLoaded',()=>{
  const cv=document.getElementById('kzone-canvas');
  if(cv){canvas=cv;ctx=cv.getContext('2d');}
});

})();
