(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // DPR-aware resize + state
  const state = {
    w: 0, h: 0, dpr: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
    keys: { left: false, right: false, jump: false, shoot: false },
    groundY: 0,
    lastTime: 0,
    levelScroll: 0
  };

  function resize() {
    state.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    state.w = Math.floor(window.innerWidth);
    state.h = Math.floor(window.innerHeight);
    canvas.width = state.w * state.dpr;
    canvas.height = state.h * state.dpr;
    canvas.style.width = state.w + 'px';
    canvas.style.height = state.h + 'px';
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.groundY = Math.floor(state.h * 0.8);
  }
  window.addEventListener('resize', resize);
  resize();

  // Player
  const player = {
    x: 80, y: 0, w: 40, h: 54,
    vx: 0, vy: 0,
    speed: 220,
    jumpV: -520,
    maxVy: 900,
    onGround: false,
    facing: 1,
    shootCooldown: 0
  };

  const bullets = [];
  const GRAVITY = 1500;

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function handleInput() {
    if (state.keys.left && !state.keys.right) {
      player.vx = -player.speed; player.facing = -1;
    } else if (state.keys.right && !state.keys.left) {
      player.vx = player.speed; player.facing = 1;
    } else {
      player.vx *= 0.86; if (Math.abs(player.vx) < 5) player.vx = 0;
    }

    if (state.keys.jump && player.onGround) {
      player.vy = player.jumpV; player.onGround = false;
    }

    if (state.keys.shoot && player.shootCooldown <= 0) {
      bullets.push({
        x: player.x + player.w/2 + player.facing*22,
        y: player.y + player.h*0.45,
        r: 5, vx: 520 * player.facing, life: 1.6
      });
      player.shootCooldown = 0.22;
    }
  }

  function physics(dt) {
    player.vy += GRAVITY * dt;
    player.vy = clamp(player.vy, -2000, player.maxVy);
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    player.x = clamp(player.x, 10, state.w - player.w - 10);

    const groundTop = state.groundY - player.h;
    if (player.y >= groundTop) {
      player.y = groundTop; player.vy = 0; player.onGround = true;
    } else {
      player.onGround = false;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > state.w + 20) bullets.splice(i, 1);
    }

    state.levelScroll = clamp(state.levelScroll + player.vx * dt * 0.15, -1e9, 1e9);
    if (player.shootCooldown > 0) player.shootCooldown -= dt;
  }

  function drawBackground() {
    const w = state.w, h = state.h, gY = state.groundY;

    // mid skyline
    ctx.save();
    ctx.translate(-(state.levelScroll*0.5)%800, 0);
    drawCityStrip(0, h*0.35, 800, h*0.45, '#6aa0c9');
    ctx.restore();

    // near skyline
    ctx.save();
    ctx.translate(-(state.levelScroll*0.8)%600, 0);
    drawCityStrip(0, h*0.45, 600, h*0.55, '#4e84ac');
    ctx.restore();

    // asphalt
    ctx.fillStyle = '#3d3d3d';
    ctx.fillRect(0, gY, w, h - gY);
    ctx.strokeStyle = '#e7e7e7';
    ctx.lineWidth = 4;
    const dashW = 28, gap = 20; let offset = (-state.levelScroll*1.2) % (dashW+gap);
    ctx.setLineDash([dashW, gap]);
    ctx.beginPath(); ctx.moveTo(offset, gY + 26); ctx.lineTo(w + dashW, gY + 26); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCityStrip(x, y, stripW, stripH, color){
    const w = state.w;
    ctx.fillStyle = color;
    // deterministic PRNG to prevent flicker
    let s = 12345;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

    for (let i = -1; i < Math.ceil((w/stripW))+2; i++) {
      const baseX = x + i*stripW;
      for (let b = 0; b < 10; b++) {
        const bw = 30 + rand()*40;
        const bh = stripH*0.3 + rand()*stripH*0.5;
        const bx = baseX + b*(stripW/10) + rand()*10;
        const by = y + (stripH - bh);
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        const rows = Math.floor(bh/18), cols = Math.floor(bw/14);
        for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
          ctx.fillRect(bx + c*12, by + r*14, 4, 6);
        }
        ctx.fillStyle = color;
      }
    }
  }

  function drawPlayer(){
    const p = player;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x + p.w/2, state.groundY + 6, p.w*0.45, 6, 0, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = '#263238'; // legs
    ctx.fillRect(p.x + 10, p.y + p.h - 20, 10, 20);
    ctx.fillRect(p.x + p.w - 20, p.y + p.h - 20, 10, 20);
    ctx.fillStyle = '#1976d2'; // torso
    ctx.fillRect(p.x + 6, p.y + 18, p.w - 12, 28);
    ctx.fillStyle = '#ffddb0'; // head
    ctx.beginPath(); ctx.arc(p.x + p.w/2, p.y + 14, 12, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = '#0b2540'; // eye
    const eyeX = p.x + p.w/2 + (p.facing>0?4:-8);
    ctx.fillRect(eyeX, p.y + 10, 4, 4);

    ctx.fillStyle = '#ffddb0'; // arm
    const armX = p.x + (p.facing>0 ? p.w - 8 : 8);
    ctx.fillRect(armX - 6, p.y + 26, 12, 6);
    ctx.fillStyle = '#424242'; // gun
    ctx.fillRect(armX + (p.facing>0?2:-8), p.y + 24, 8, 10);
  }

  function drawBullets(){
    ctx.fillStyle = '#ffd54f';
    bullets.forEach(b => {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.15; ctx.fillRect(b.x - b.vx*0.03, b.y-1, b.vx*0.03, 2); ctx.globalAlpha = 1;
    });
  }

  function frame(t){
    if (!state.lastTime) state.lastTime = t;
    let dt = (t - state.lastTime) / 1000;
    state.lastTime = t;
    dt = Math.min(dt, 1/30);

    handleInput();
    physics(dt);

    ctx.clearRect(0,0,state.w,state.h);
    drawBackground();
    drawPlayer();
    drawBullets();

    requestAnimationFrame(frame);
  }

  function setKey(name, pressed){ state.keys[name] = pressed; }

  const LEFT_KEYS = new Set(['ArrowLeft','a','A','ф','Ф']);
  const RIGHT_KEYS = new Set(['ArrowRight','d','D','в','В']);

  window.addEventListener('keydown', (e) => {
    if (LEFT_KEYS.has(e.key)) { setKey('left', true); e.preventDefault(); }
    if (RIGHT_KEYS.has(e.key)) { setKey('right', true); e.preventDefault(); }
    if (e.code === 'Space') { setKey('jump', true); e.preventDefault(); }
    if (e.code === 'Enter') { setKey('shoot', true); e.preventDefault(); }
  }, { passive: false });
  window.addEventListener('keyup', (e) => {
    if (LEFT_KEYS.has(e.key)) { setKey('left', false); e.preventDefault(); }
    if (RIGHT_KEYS.has(e.key)) { setKey('right', false); e.preventDefault(); }
    if (e.code === 'Space') { setKey('jump', false); e.preventDefault(); }
    if (e.code === 'Enter') { setKey('shoot', false); e.preventDefault(); }
  }, { passive: false });

  function bindButton(id, key){
    const el = document.getElementById(id);
    const press = (ev) => { setKey(key, true); ev.preventDefault(); };
    const release = (ev) => { setKey(key, false); ev.preventDefault(); };
    ['pointerdown','touchstart','mousedown'].forEach(t => el.addEventListener(t, press, { passive:false }));
    ['pointerup','pointercancel','touchend','touchcancel','mouseup','mouseleave'].forEach(t => el.addEventListener(t, release, { passive:false }));
  }
  bindButton('leftBtn', 'left');
  bindButton('rightBtn', 'right');
  bindButton('jumpBtn', 'jump');
  bindButton('shootBtn', 'shoot');

  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
    document.getElementById('hint').style.display = 'none';

  player.y = state.groundY - player.h;
  requestAnimationFrame(frame);
})();
