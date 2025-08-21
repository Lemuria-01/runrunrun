
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ====== TUNABLES ======
  const SCROLL_SPEED = 140;      // px/s — скорость движения камеры вправо
  const PLAYER_SPEED = 230;      // скорость бега игрока
  const JUMP_V = -520;           // прыжок
  const GRAVITY = 1500;          // гравитация
  const POLICE_COUNT = 3;        // полицейских у левого края
  const LEFT_KILL_MARGIN = 28;   // на сколько можно "заезжать" за левую границу
  const BIN_MIN_GAP = 480;       // мин дистанция между баками
  const BIN_MAX_GAP = 780;       // макс дистанция между баками
  const BIN_SIZE = { w: 56, h: 36 };

  // ====== STATE ======
  const state = {
    w: 0, h: 0, dpr: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
    keys: { left: false, right: false, jump: false, shoot: false },
    groundY: 0,
    lastTime: 0,
    cameraX: 0,           // мировая координата левого края экрана
    levelScroll: 0,       // для параллакса
    gameOver: false,
    bustedTimer: 0
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

  // ====== PLAYER ======
  const player = {
    x: 120, y: 0, w: 40, h: 54,
    vx: 0, vy: 0,
    maxVy: 900,
    onGround: false,
    facing: 1,
    shootCooldown: 0
  };

  // ====== BULLETS ======
  const bullets = [];

  // ====== POLICE ======
  const police = Array.from({ length: POLICE_COUNT }, (_, i) => ({
    x: 0, y: 0, w: 38, h: 52, phase: Math.random() * Math.PI * 2, idx: i
  }));

  function updatePolicePositions() {
    const leftEdge = state.cameraX + 6;
    const spacing = 44;
    police.forEach((p, i) => {
      p.x = leftEdge + i * spacing;
      p.y = state.groundY - p.h;
      p.phase += 0.16;
    });
  }

  // ====== BINS ======
  const bins = [];
  let nextBinAt = 400;

  function trySpawnBins() {
    const needAhead = state.cameraX + state.w * 2;
    while (nextBinAt < needAhead) {
      bins.push({ x: nextBinAt, y: state.groundY - BIN_SIZE.h, w: BIN_SIZE.w, h: BIN_SIZE.h });
      const gap = BIN_MIN_GAP + Math.random() * (BIN_MAX_GAP - BIN_MIN_GAP);
      nextBinAt += gap;
    }
    while (bins.length && bins[0].x + bins[0].w < state.cameraX - 200) bins.shift();
  }

  // ====== INPUT ======
  function setKey(name, pressed){ state.keys[name] = pressed; }
  const LEFT_KEYS = new Set(['ArrowLeft','a','A','ф','Ф']);
  const RIGHT_KEYS = new Set(['ArrowRight','d','D','в','В']);

  window.addEventListener('keydown', (e) => {
    if (state.gameOver && (e.key === 'r' || e.key === 'R' || e.code === 'Space' || e.code === 'Enter')) { restart(); return; }
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

  // мобильные кнопки
  function bindButton(id, key){
    const el = document.getElementById(id);
    const press = (ev) => { 
      if (state.gameOver) { restart(); return; }
      setKey(key, true); ev.preventDefault(); 
    };
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

  // ====== HELPERS ======
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function aabb(a, b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  // ====== GAME LOOP ======
  let dtGlobal = 0;
  function frame(t){
    if (!state.lastTime) state.lastTime = t;
    dtGlobal = Math.min((t - state.lastTime) / 1000, 1/30);
    state.lastTime = t;

    if (!state.gameOver) { update(dtGlobal); render(); }
    else { render(); }

    requestAnimationFrame(frame);
  }

  function update(dt){
    state.cameraX += SCROLL_SPEED * dt;
    state.levelScroll = state.cameraX;

    if (state.keys.left && !state.keys.right) { player.vx = -PLAYER_SPEED; player.facing = -1; }
    else if (state.keys.right && !state.keys.left) { player.vx = PLAYER_SPEED; player.facing = 1; }
    else { player.vx *= 0.86; if (Math.abs(player.vx) < 5) player.vx = 0; }

    if (state.keys.jump && player.onGround) { player.vy = JUMP_V; player.onGround = false; }

    if (state.keys.shoot && player.shootCooldown <= 0) {
      bullets.push({ x: player.x + player.w/2 + player.facing*22, y: player.y + player.h*0.45, r: 5, vx: 520 * player.facing, life: 1.6 });
      player.shootCooldown = 0.22;
    }
    if (player.shootCooldown > 0) player.shootCooldown -= dt;

    player.vy += GRAVITY * dt;
    player.vy = clamp(player.vy, -2000, player.maxVy);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.onGround = false;

    const groundTop = state.groundY - player.h;
    if (player.y >= groundTop) { player.y = groundTop; player.vy = 0; player.onGround = true; }

    trySpawnBins();
    for (const bin of bins) { if (aabb(player, bin)) { player.y = bin.y - player.h; player.vy = 0; player.onGround = true; } }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.life -= dt;
      if (b.life <= 0 || b.x < state.cameraX - 200 || b.x > state.cameraX + state.w + 200) bullets.splice(i, 1);
    }

    updatePolicePositions();
    if (player.x < state.cameraX + LEFT_KILL_MARGIN) return busted();
    for (const cop of police) if (aabb(player, cop)) return busted();
  }

  function busted() { state.gameOver = true; state.bustedTimer = 0; }
  function restart() { state.gameOver = false; state.cameraX = 0; state.levelScroll = 0; state.lastTime = 0; player.x = 120; player.y = state.groundY - player.h; player.vx = 0; player.vy = 0; player.onGround = true; player.facing = 1; bullets.length = 0; bins.length = 0; nextBinAt = 400; }

  // ====== RENDER ======
  function render(){
    ctx.clearRect(0,0,state.w,state.h);
    drawBackground();

    ctx.save(); ctx.translate(-state.cameraX, 0);
    drawBins(); drawPlayer(); drawPolice(); drawBullets();
    ctx.restore();

    if (state.gameOver) drawBustedOverlay();
  }

  function drawBackground() {
    const w = state.w, h = state.h, gY = state.groundY;
    ctx.fillStyle = '#3d3d3d'; ctx.fillRect(0, gY, w, h - gY);
  }

  function drawPlayer(){ ctx.fillStyle = '#1976d2'; ctx.fillRect(player.x, player.y, player.w, player.h); }
  function drawPolice(){ police.forEach(p => { ctx.fillStyle = '#1f5b95'; ctx.fillRect(p.x, p.y, p.w, p.h); }); }
  function drawBins(){ bins.forEach(bin => { ctx.fillStyle = '#555'; ctx.fillRect(bin.x, bin.y, bin.w, bin.h); }); }
  function drawBullets(){ bullets.forEach(b => { ctx.fillStyle = '#ffd54f'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill(); }); }
  function drawBustedOverlay(){ ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0,0,state.w,state.h); ctx.fillStyle = '#ff4444'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BUSTED', state.w/2, state.h/2); ctx.font = '24px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('Press R to restart', state.w/2, state.h/2+40); }

  player.y = state.groundY - player.h;
  requestAnimationFrame(frame);
})();
