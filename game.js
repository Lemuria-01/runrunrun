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

  // ====== BULLETS (оставим, пригодится позже) ======
  const bullets = [];

  // ====== POLICE ======
  const police = Array.from({ length: POLICE_COUNT }, (_, i) => ({
    // позицию по x держим около левого края камеры
    x: 0, y: 0, w: 38, h: 52, phase: Math.random() * Math.PI * 2, idx: i
  }));

  function updatePolicePositions() {
    const leftEdge = state.cameraX + 6; // чуть внутри экрана
    const spacing = 44;                 // расстояние между полицейскими
    police.forEach((p, i) => {
      p.x = leftEdge + i * spacing;
      p.y = state.groundY - p.h;
      p.phase += 0.16; // для "шага"
    });
  }

  // ====== BINS (препятствия) ======
  const bins = [];
  let nextBinAt = 400; // первая цель по x (в мировых координатах)

  function trySpawnBins() {
    const needAhead = state.cameraX + state.w * 2; // держим запас впереди
    while (nextBinAt < needAhead) {
      bins.push({
        x: nextBinAt,
        y: state.groundY - BIN_SIZE.h,
        w: BIN_SIZE.w,
        h: BIN_SIZE.h
      });
      const gap = BIN_MIN_GAP + Math.random() * (BIN_MAX_GAP - BIN_MIN_GAP);
      nextBinAt += gap;
    }
    // удаляем те, что далеко позади
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

  function aabb(a, b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function resolveSolidCollision(subject, solid){
    // грубая, но достаточная для платформеров резолв-коллизия
    const prevY = subject.y - subject.vy * dtGlobal; // приблизим предыдущую позицию
    const prevX = subject.x - subject.vx * dtGlobal;

    const fromTop    = prevY + subject.h <= solid.y;
    const fromBottom = prevY >= solid.y + solid.h;
    const fromLeft   = prevX + subject.w <= solid.x;
    const fromRight  = prevX >= solid.x + solid.w;

    // приоритет по вертикали (обычно падаем сверху)
    if (fromTop && subject.vy >= 0) {
      subject.y = solid.y - subject.h;
      subject.vy = 0;
      if (subject === player) player.onGround = true;
      return;
    }
    if (fromBottom && subject.vy < 0) {
      subject.y = solid.y + solid.h;
      subject.vy = 0;
      return;
    }
    // горизонтальные
    if (fromLeft && subject.vx > 0) {
      subject.x = solid.x - subject.w;
      subject.vx = 0;
      return;
    }
    if (fromRight && subject.vx < 0) {
      subject.x = solid.x + solid.w;
      subject.vx = 0;
      return;
    }
  }

  // ====== GAME LOOP ======
  let dtGlobal = 0;
  function frame(t){
    if (!state.lastTime) state.lastTime = t;
    dtGlobal = Math.min((t - state.lastTime) / 1000, 1/30);
    state.lastTime = t;

    if (!state.gameOver) {
      update(dtGlobal);
      render();
    } else {
      render(); // рисуем остановившуюся сцену + оверлей
    }

    requestAnimationFrame(frame);
  }

  function update(dt){
    // камера едет вправо всегда
    state.cameraX += SCROLL_SPEED * dt;
    state.levelScroll = state.cameraX;

    // ввод
    if (state.keys.left && !state.keys.right) {
      player.vx = -PLAYER_SPEED; player.facing = -1;
    } else if (state.keys.right && !state.keys.left) {
      player.vx = PLAYER_SPEED; player.facing = 1;
    } else {
      player.vx *= 0.86; if (Math.abs(player.vx) < 5) player.vx = 0;
    }
    if (state.keys.jump && player.onGround) {
      player.vy = JUMP_V; player.onGround = false;
    }
    if (state.keys.shoot && player.shootCooldown <= 0) {
      bullets.push({
        x: player.x + player.w/2 + player.facing*22,
        y: player.y + player.h*0.45,
        r: 5, vx: 520 * player.facing, life: 1.6
      });
      player.shootCooldown = 0.22;
    }
    if (player.shootCooldown > 0) player.shootCooldown -= dt;

    // физика игрока
    player.vy += GRAVITY * dt;
    player.vy = clamp(player.vy, -2000, player.maxVy);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.onGround = false;

    // столкновение с землёй
    const groundTop = state.groundY - player.h;
    if (player.y >= groundTop) { player.y = groundTop; player.vy = 0; player.onGround = true; }

    // препятствия
    trySpawnBins();
    for (const bin of bins) {
      if (aabb(player, bin)) resolveSolidCollision(player, bin);
    }

    // пули
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.life -= dt;
      if (b.life <= 0 || b.x < state.cameraX - 200 || b.x > state.cameraX + state.w + 200) bullets.splice(i, 1);
    }

    // полицаи у левого края
    updatePolicePositions();

    // проверка «экран догнал слева»
    const leftScreenX = state.cameraX;
    if (player.x < leftScreenX + LEFT_KILL_MARGIN) return busted();

    // (опционально) физконтакт с полицией, если игрок совсем близко к краю
    for (const cop of police) {
      if (aabb(player, cop)) return busted();
    }
  }

  function busted() {
    state.gameOver = true;
    state.bustedTimer = 0;
  }

  function restart() {
    state.gameOver = false;
    state.cameraX = 0;
    state.levelScroll = 0;
    state.lastTime = 0;
    player.x = 120; player.y = state.groundY - player.h;
    player.vx = 0; player.vy = 0; player.onGround = true; player.facing = 1;
    bullets.length = 0;
    bins.length = 0; nextBinAt = 400;
  }

  // ====== RENDER ======
  function render(){
    ctx.clearRect(0,0,state.w,state.h);
    drawBackground();

    // мир в мировых координатах
    ctx.save();
    ctx.translate(-state.cameraX, 0);

    // препятствия
    drawBins();

    // игрок и тени
    drawPlayer();

    // полиция
    drawPolice();

    // пули
    drawBullets();

    ctx.restore();

    if (state.gameOver) drawBustedOverlay();
  }

  function drawBackground() {
    const w = state.w, h = state.h, gY = state.groundY;

    // mid skyline (параллакс)
    ctx.save();
    ctx.translate(-(state.levelScroll*0.5) % 800, 0);
    drawCityStrip(0, h*0.35, 800, h*0.45, '#6aa0c9');
    ctx.restore();

    // near skyline
    ctx.save();
    ctx.translate(-(state.levelScroll*0.8) % 600, 0);
    drawCityStrip(0, h*0.45, 600, h*0.55, '#4e84ac');
    ctx.restore();

    // асфальт
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
    const w = state.w; ctx.fillStyle = color;
    // детерминированный «рандом» (чтобы дома не дрожали)
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
    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x + p.w/2, state.groundY + 6, p.w*0.45, 6, 0, 0, Math.PI*2); ctx.fill();
    // ноги
    ctx.fillStyle = '#263238';
    ctx.fillRect(p.x + 10, p.y + p.h - 20, 10, 20);
    ctx.fillRect(p.x + p.w - 20, p.y + p.h - 20, 10, 20);
    // торс
    ctx.fillStyle = '#1976d2';
    ctx.fillRect(p.x + 6, p.y + 18, p.w - 12, 28);
    // голова
    ctx.fillStyle = '#ffddb0';
    ctx.beginPath(); ctx.arc(p.x + p.w/2, p.y + 14, 12, 0, Math.PI*2); ctx.fill();
    // глаз
    ctx.fillStyle = '#0b2540';
    const eyeX = p.x + p.w/2 + (p.vx >= 0 ? 4 : -8);
    ctx.fillRect(eyeX, p.y + 10, 4, 4);
    // рука и «пистолет»
    ctx.fillStyle = '#ffddb0';
    const armX = p.x + (p.vx >= 0 ? p.w - 8 : 8);
    ctx.fillRect(armX - 6, p.y + 26, 12, 6);
    ctx.fillStyle = '#424242';
    ctx.fillRect(armX + (p.vx >= 0 ? 2 : -8), p.y + 24, 8, 10);
  }

  function drawBullets(){
    ctx.fillStyle = '#ffd54f';
    bullets.forEach(b => {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.15; ctx.fillRect(b.x - b.vx*0.03, b.y-1, b.vx*0.03, 2); ctx.globalAlpha = 1;
    });
  }

  function drawPolice(){
    police.forEach((p, i) => {
      // простая анимация шага
      const leg = Math.sin(p.phase + i) * 3;
      // тень
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(p.x + p.w/2, state.groundY + 6, p.w*0.42, 6, 0, 0, Math.PI*2); ctx.fill();

      // ноги
      ctx.fillStyle = '#303030';
      ctx.fillRect(p.x + 10 + leg, p.y + p.h - 20, 9, 20);
      ctx.fillRect(p.x + p.w - 20 - leg, p.y + p.h - 20, 9, 20);
      // форма
      ctx.fillStyle = '#1f5b95';
      ctx.fillRect(p.x + 6, p.y + 18, p.w - 12, 28);
      // голова/кепка
      ctx.fillStyle = '#ffd4a3';
      ctx.beginPath(); ctx.arc(p.x + p.w/2, p.y + 14, 12, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#163f66';
      ctx.fillRect(p.x + p.w/2 - 12, p.y + 2, 24, 6);
      // дубинка :)
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(p.x + p.w - 6, p.y + 26, 14, 4);
    });
  }

  function drawBins(){
    ctx.fillStyle = '#6b6b6b';
    bins.forEach(bin => {
      // корпус бака
      ctx.fillRect(bin.x, bin.y, bin.w, bin.h);
      // крышка, "перевёрнутая" набок
      ctx.fillStyle = '#545454';
      ctx.fillRect(bin.x - 6, bin.y + 4, bin.w + 12, 6);
      ctx.fillStyle = '#6b6b6b';
    });
  }

  function drawBustedOverlay(){
    state.bustedTimer += dtGlobal;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, state.w, state.h);
    ctx.fillStyle = '#ff5050';
    ctx.font = 'bold 64px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED', state.w/2, state.h/2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 16px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText('Нажми R / Space / Enter или тапни для рестарта', state.w/2, state.h/2 + 40);
  }

  // стартовые значения
  player.y = state.groundY - player.h;
  requestAnimationFrame(frame);
})();
