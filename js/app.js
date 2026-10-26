'use strict';

/* =========================================================
   Config
   ========================================================= */

// Your muscle names -> muscle names used in the exercise database
const MUSCLE_GROUPS = {
  chest: ['chest'],
  back: ['lats', 'middle back', 'lower back', 'traps'],
  shoulders: ['shoulders'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  quads: ['quadriceps'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes', 'abductors'],
  calves: ['calves'],
  core: ['abdominals'],
};

// Your equipment names -> equipment names used in the database
const EQUIPMENT = {
  dumbbell: { label: 'Dumbbell', db: ['dumbbell'] },
  barbell: { label: 'Barbell', db: ['barbell', 'e-z curl bar'] },
  machine: { label: 'Machine', db: ['machine'] },
  cable: { label: 'Cable', db: ['cable'] },
  body: { label: 'Body only', db: ['body only'] },
};

// Only these exercise types are used when generating (no stretches, cardio, etc.)
const GEN_CATEGORIES = ['strength', 'powerlifting'];
const DEFAULT_SETS = 3;
const MAX_PER_MUSCLE = 4;

const MSG = {
  idle: [
    "Ready when you are!", "Let's get stronger today!", "Pick some muscles and let's go!",
    "I believe in you!", "Today's a great day to train!",
  ],
  active: [
    "You've got this!", "One set at a time!", "Focus on good form!", "Let's crush it!",
  ],
  cheer: [
    "Nice set!", "You're on fire! 🔥", "Great job!", "So strong!", "Keep it up!",
    "That looked easy!", "Wow, impressive!", "Breathe… then go again!", "Yes! Just like that!",
    "Proud of you!", "Look at those gains!", "Unstoppable!",
  ],
  celebrate: [
    "You did amazing today!", "Workout done! Time to rest and refuel!",
    "Another session in the books! 🎉", "I'm so proud of you!", "Champion! See you next time!",
  ],
};

/* =========================================================
   Helpers
   ========================================================= */

const $ = (sel) => document.querySelector(sel);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// localStorage wrapped in try/catch (private browsing can block it)
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const imgUrl = (path) => 'exercises/' + encodeURI(path);

function groupOf(ex) {
  for (const m of ex.primaryMuscles) {
    for (const [g, list] of Object.entries(MUSCLE_GROUPS)) if (list.includes(m)) return g;
  }
  return 'other';
}

function equipKeyOf(ex) {
  for (const [k, v] of Object.entries(EQUIPMENT)) if (v.db.includes(ex.equipment)) return k;
  return 'other';
}

function fmtDuration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
}

const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };

/* =========================================================
   State
   ========================================================= */

let DB = [];
const byId = {};

const settings = Object.assign(
  { muscles: [], equipment: Object.keys(EQUIPMENT), rest: 90, unit: 'kg', theme: 'auto' },
  store.get('wt.settings', {})
);
let workout = store.get('wt.workout', null); // { startedAt, items: [{ uid, id, group, sets: [{ w, r, done }] }] }
let history = store.get('wt.history', []);   // newest first

const saveSettings = () => store.set('wt.settings', settings);
const saveWorkout = () => store.set('wt.workout', workout);
const saveHistory = () => store.set('wt.history', history);

/* =========================================================
   Theme
   ========================================================= */

const THEME_ICONS = { auto: '🌓', light: '☀️', dark: '🌙' };
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  $('#themeBtn').textContent = THEME_ICONS[settings.theme];
  $('#themeBtn').title = 'Theme: ' + settings.theme;
}
$('#themeBtn').addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
  saveSettings();
  applyTheme();
});

/* =========================================================
   Mascot – reads whatever images are in the mascot/ folder
   ========================================================= */

const mascots = { idle: [], cheer: [], celebrate: [], other: [] };

// Names checked when the server can't list the folder (e.g. GitHub Pages)
// A single "mascot" image is used for every mood
const MASCOT_NAMES = ['mascot', 'idle', 'cheer1', 'cheer2', 'cheer3', 'cheer4', 'celebrate'];
const MASCOT_EXTS = ['png', 'webp'];

// Some servers (python, nginx) can list the folder: then any file name works
async function listMascotFolder() {
  try {
    const res = await fetch('mascot/', { cache: 'no-store' });
    if (!res.ok) return [];
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const files = new Set();
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href').split(/[?#]/)[0];
      const name = href.split('/').pop();
      if (/\.(png|webp|jpe?g|gif|avif)$/i.test(name)) files.add(name);
    });
    return [...files];
  } catch { return []; }
}

// Otherwise, try each fixed name and keep the ones that load
function probeMascotNames() {
  const tries = MASCOT_NAMES.flatMap((n) => MASCOT_EXTS.map((ext) => `${n}.${ext}`));
  return Promise.all(tries.map((f) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(f);
    img.onerror = () => resolve(null);
    img.src = 'mascot/' + f;
  }))).then((found) => found.filter(Boolean));
}

async function loadMascots() {
  let files = await listMascotFolder();
  if (!files.length) files = await probeMascotNames();
  for (const f of files) {
    const lower = decodeURIComponent(f).toLowerCase();
    const url = 'mascot/' + f;
    if (/idle|happy|wave|default/.test(lower)) mascots.idle.push(url);
    else if (/celebrat|party|victory|win|done/.test(lower)) mascots.celebrate.push(url);
    else if (/cheer|yay|go|fight|thumb/.test(lower)) mascots.cheer.push(url);
    else mascots.other.push(url);
  }
  // No images found: the built-in seal (DEFAULT_MASCOT) is used
}

// Built-in seal, used when the mascot/ folder has no images
const DEFAULT_MASCOT = 'img/default-mascot.png';

function mascotImage(mood) {
  if (mascots[mood].length) return pick(mascots[mood]);
  const any = [...mascots.other, ...mascots.idle, ...mascots.cheer, ...mascots.celebrate];
  if (any.length) return pick(any);
  return DEFAULT_MASCOT;
}

function setMascot(mood, msg) {
  $('#mascotImg').src = mascotImage(mood);
  $('#mascotSay').textContent = msg;
}

let toastTimer;
function cheer() {
  const msg = pick(MSG.cheer);
  $('#toastImg').src = mascotImage('cheer');
  $('#toastMsg').textContent = msg;
  const t = $('#toast');
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  setMascot('cheer', msg);
}
$('#toast').addEventListener('click', () => { $('#toast').hidden = true; });

/* =========================================================
   Tabs
   ========================================================= */

document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
function showTab(name) {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}

// Flip all exercise photos once a second
setInterval(() => document.body.classList.toggle('frame-b'), 1000);

/* =========================================================
   Planner chips
   ========================================================= */

function renderChips() {
  $('#muscleChips').innerHTML = Object.keys(MUSCLE_GROUPS).map((m) =>
    `<button class="chip" data-muscle="${m}" aria-pressed="${settings.muscles.includes(m)}">${cap(m)}</button>`).join('');
  $('#equipChips').innerHTML = Object.entries(EQUIPMENT).map(([k, v]) =>
    `<button class="chip" data-equip="${k}" aria-pressed="${settings.equipment.includes(k)}">${v.label}</button>`).join('');
  $('#generateBtn').disabled = !settings.muscles.length || !settings.equipment.length;
}

function toggleIn(list, value) {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1); else list.push(value);
}

$('#muscleChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-muscle]'); if (!b) return;
  toggleIn(settings.muscles, b.dataset.muscle); saveSettings(); renderChips();
});
$('#equipChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-equip]'); if (!b) return;
  toggleIn(settings.equipment, b.dataset.equip); saveSettings(); renderChips();
});

/* =========================================================
   Workout generation
   ========================================================= */

function allowedEquipment() {
  return new Set(settings.equipment.flatMap((k) => EQUIPMENT[k].db));
}

// Fewer muscles -> more exercises each (1 muscle = 4, 3 = 3, 5 = 2, 7+ = 1)
function perMuscle(n) {
  return Math.max(1, Math.min(MAX_PER_MUSCLE, Math.round(10 / n)));
}

// Ordered list of candidate exercises for a muscle group
function candidates(group, exclude, muscleList) {
  const muscles = muscleList || MUSCLE_GROUPS[group];
  const equip = allowedEquipment();
  const ok = (e) => GEN_CATEGORIES.includes(e.category) && equip.has(e.equipment) &&
    e.images.length >= 2 && !exclude.has(e.id);
  const primary = DB.filter((e) => ok(e) && e.primaryMuscles.some((m) => muscles.includes(m)));
  const secondary = DB.filter((e) => ok(e) && !primary.includes(e) &&
    e.secondaryMuscles.some((m) => muscles.includes(m)));
  const easyFirst = (list) => [
    ...shuffle(list.filter((e) => e.level !== 'expert')),
    ...shuffle(list.filter((e) => e.level === 'expert')),
  ];
  const list = [...easyFirst(primary), ...easyFirst(secondary)];
  // Start each muscle with a compound (multi-joint) lift when possible
  const ci = list.findIndex((e) => e.mechanic === 'compound' && primary.includes(e));
  if (ci > 0) list.unshift(list.splice(ci, 1)[0]);
  return list;
}

function newItem(id, group) {
  return { uid: uid(), id, group, sets: Array.from({ length: DEFAULT_SETS }, () => ({ w: '', r: '', done: false })) };
}

function generate() {
  if (workout && workout.items.some((it) => it.sets.some((s) => s.done)) &&
      !confirm('Replace your current workout? Logged sets will be lost.')) return;
  const n = perMuscle(settings.muscles.length);
  const used = new Set();
  const items = [];
  const missing = [];
  for (const g of settings.muscles) {
    const chosen = candidates(g, used).slice(0, n);
    if (!chosen.length) missing.push(g);
    chosen.forEach((e) => { used.add(e.id); items.push(newItem(e.id, g)); });
  }
  workout = { startedAt: Date.now(), items };
  saveWorkout();
  $('#planner').open = false;
  renderWorkout();
  setMascot('idle', missing.length
    ? `No exercises found for ${missing.join(', ')} with your equipment.`
    : pick(MSG.active));
}
$('#generateBtn').addEventListener('click', generate);

/* =========================================================
   Workout rendering & actions
   ========================================================= */

function lastPerformance(id) {
  for (const s of history) {
    const it = s.items.find((x) => x.id === id);
    if (it && it.sets.length) {
      return it.sets.map((st) => (st.w ? `${st.w}×${st.r}` : `${st.r} reps`)).join(', ') + (s.unit ? ' ' + s.unit : '');
    }
  }
  return '';
}

function exerciseMedia(ex) {
  return `
    <div class="flip">
      <img src="${imgUrl(ex.images[0])}" alt="${esc(ex.name)} start" loading="lazy">
      <img src="${imgUrl(ex.images[1] || ex.images[0])}" alt="${esc(ex.name)} end" loading="lazy">
    </div>
    <details class="instructions">
      <summary>Instructions</summary>
      <ol>${ex.instructions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </details>`;
}

function renderWorkout() {
  const area = $('#workoutArea');
  if (!workout || !workout.items.length) {
    area.innerHTML = `<div class="card empty muted">
      No exercises yet. Pick muscles above and tap <b>Generate workout</b>, or add exercises from the <b>Library</b>.
    </div>`;
    return;
  }
  const restBtns = [60, 90, 120].map((s) =>
    `<button data-rest="${s}" aria-pressed="${settings.rest === s}">${s === 120 ? '2 min' : s + 's'}</button>`).join('');
  const unitBtns = ['kg', 'lb'].map((u) =>
    `<button data-unit="${u}" aria-pressed="${settings.unit === u}">${u}</button>`).join('');

  area.innerHTML = `
    <div class="workout-head">
      <h2>Today · ${workout.items.length} exercises</h2>
      <div class="row" style="margin:0">
        <div class="seg" title="Rest time">${restBtns}</div>
        <div class="seg" title="Weight unit">${unitBtns}</div>
      </div>
    </div>
    ${workout.items.map((it) => {
      const ex = byId[it.id];
      if (!ex) return '';
      const last = lastPerformance(it.id);
      return `
      <article class="card ex" data-uid="${it.uid}">
        <div class="ex-head">
          <div>
            <span class="tag">${esc(cap(it.group))}</span>
            <h3>${esc(ex.name)}</h3>
            ${last ? `<p class="last">Last time: ${esc(last)}</p>` : ''}
          </div>
        </div>
        ${exerciseMedia(ex)}
        <table class="sets">
          <thead><tr><th>Set</th><th>Weight (${settings.unit})</th><th>Reps</th><th></th></tr></thead>
          <tbody>
          ${it.sets.map((s, i) => `
            <tr class="${s.done ? 'done' : ''}" data-set="${i}">
              <td>${i + 1}</td>
              <td><input inputmode="decimal" data-field="w" value="${esc(s.w)}" placeholder="0"></td>
              <td><input inputmode="numeric" data-field="r" value="${esc(s.r)}" placeholder="10"></td>
              <td><button class="log-btn" data-action="log" aria-label="Log set ${i + 1}">✓</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="ex-actions">
          <button class="btn small" data-action="addset">+ Set</button>
          <button class="btn small" data-action="delset">− Set</button>
          <button class="btn small" data-action="swap">⇄ Swap</button>
          <button class="btn small danger" data-action="remove">✕ Remove</button>
        </div>
      </article>`;
    }).join('')}
    <div class="finish-row">
      <button class="btn danger" data-action="discard">Discard</button>
      <button class="btn primary" data-action="finish">Finish session</button>
    </div>`;
}

function findItem(el) {
  const card = el.closest('[data-uid]');
  return card ? workout.items.find((it) => it.uid === card.dataset.uid) : null;
}

// Typing in weight/reps saves immediately
$('#workoutArea').addEventListener('input', (e) => {
  const input = e.target.closest('input[data-field]'); if (!input) return;
  const it = findItem(input);
  const set = it.sets[+input.closest('tr').dataset.set];
  set[input.dataset.field] = input.value.trim();
  saveWorkout();
});

$('#workoutArea').addEventListener('click', (e) => {
  const seg = e.target.closest('[data-rest],[data-unit]');
  if (seg) {
    if (seg.dataset.rest) settings.rest = +seg.dataset.rest;
    if (seg.dataset.unit) settings.unit = seg.dataset.unit;
    saveSettings(); renderWorkout(); return;
  }
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'finish') return finishSession();
  if (action === 'discard') {
    if (confirm('Discard this workout? Nothing will be saved.')) {
      workout = null; saveWorkout(); stopRest(); renderWorkout();
      $('#planner').open = true;
      setMascot('idle', pick(MSG.idle));
    }
    return;
  }
  const it = findItem(btn); if (!it) return;

  if (action === 'log') {
    const row = btn.closest('tr');
    const set = it.sets[+row.dataset.set];
    if (set.done) { // tap again to un-log
      set.done = false; row.classList.remove('done'); saveWorkout(); return;
    }
    const repsInput = row.querySelector('[data-field="r"]');
    if (!num(repsInput.value)) {
      repsInput.classList.remove('shake'); void repsInput.offsetWidth; repsInput.classList.add('shake');
      repsInput.focus(); return;
    }
    set.w = row.querySelector('[data-field="w"]').value.trim();
    set.r = repsInput.value.trim();
    set.done = true;
    if (!workout.firstLogAt) workout.firstLogAt = Date.now();
    row.classList.add('done');
    // Pre-fill the next empty set with the same numbers
    const next = it.sets.find((s) => !s.done && !s.w && !s.r);
    if (next) {
      next.w = set.w; next.r = set.r;
      const nextRow = row.parentElement.children[it.sets.indexOf(next)];
      nextRow.querySelector('[data-field="w"]').value = set.w;
      nextRow.querySelector('[data-field="r"]').value = set.r;
    }
    saveWorkout();
    unlockAudio();
    startRest(settings.rest);
    cheer();
    return;
  }
  if (action === 'addset') {
    const prev = it.sets[it.sets.length - 1] || { w: '', r: '' };
    it.sets.push({ w: prev.w, r: prev.r, done: false });
  }
  if (action === 'delset') {
    if (it.sets.length <= 1) return;
    it.sets.pop();
  }
  if (action === 'remove') {
    workout.items = workout.items.filter((x) => x !== it);
  }
  if (action === 'swap') {
    if (it.sets.some((s) => s.done) && !confirm('This exercise has logged sets. Swap anyway?')) return;
    const ex = byId[it.id];
    const exclude = new Set(workout.items.map((x) => x.id));
    const muscles = it.group === 'other' ? ex.primaryMuscles : null;
    const next = candidates(it.group, exclude, muscles)[0];
    if (!next) { alert('No other exercise found for this muscle with your equipment.'); return; }
    Object.assign(it, newItem(next.id, it.group), { uid: it.uid });
  }
  saveWorkout();
  renderWorkout();
});

/* =========================================================
   Rest timer
   ========================================================= */

let restEnd = 0, restTotal = 0, restTick = null, audioCtx = null;

function unlockAudio() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    audioCtx = audioCtx || new C();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}

function beep() {
  if (!audioCtx) return;
  try {
    [0, 0.3].forEach((offset) => {
      const t = audioCtx.currentTime + offset;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.25);
    });
  } catch { /* ignore */ }
}

function startRest(seconds) {
  restTotal = seconds * 1000;
  restEnd = Date.now() + restTotal;
  const bar = $('#restBar');
  bar.hidden = false; bar.classList.remove('over');
  clearInterval(restTick);
  restTick = setInterval(updateRest, 250);
  updateRest();
}

function updateRest() {
  const left = restEnd - Date.now();
  if (left <= 0) {
    clearInterval(restTick);
    $('#restTime').textContent = 'Go!';
    $('#restFill').style.width = '0%';
    $('#restBar').classList.add('over');
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    beep();
    setTimeout(() => { if (Date.now() >= restEnd) stopRest(); }, 4000);
    return;
  }
  const s = Math.ceil(left / 1000);
  $('#restTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('#restFill').style.width = (left / restTotal * 100) + '%';
}

function stopRest() {
  clearInterval(restTick);
  restEnd = 0;
  $('#restBar').hidden = true;
}

$('#restSkip').addEventListener('click', stopRest);
$('#restAdd').addEventListener('click', () => {
  if (!restEnd) return;
  restEnd = Math.max(restEnd, Date.now()) + 15000;
  restTotal += 15000;
  $('#restBar').classList.remove('over');
  clearInterval(restTick);
  restTick = setInterval(updateRest, 250);
  updateRest();
});

/* =========================================================
   Finish session & celebration
   ========================================================= */

function sessionStats(s) {
  const sets = s.items.reduce((n, it) => n + it.sets.length, 0);
  const volume = s.items.reduce((v, it) => v + it.sets.reduce((a, st) => a + num(st.w) * num(st.r), 0), 0);
  return { exercises: s.items.length, sets, volume: Math.round(volume), duration: s.endedAt - s.startedAt };
}

function statsHtml(st, unit) {
  return `
    <div class="stat"><b>${st.exercises}</b><span>exercises</span></div>
    <div class="stat"><b>${st.sets}</b><span>sets</span></div>
    <div class="stat"><b>${st.volume.toLocaleString()}</b><span>${unit} lifted</span></div>
    <div class="stat"><b>${fmtDuration(st.duration)}</b><span>time</span></div>`;
}

function finishSession() {
  const items = workout.items
    .map((it) => ({
      id: it.id,
      name: byId[it.id] ? byId[it.id].name : it.id,
      group: it.group,
      sets: it.sets.filter((s) => s.done).map((s) => ({ w: s.w, r: s.r })),
    }))
    .filter((it) => it.sets.length);
  if (!items.length) {
    alert('Log at least one set (tap ✓) before finishing. Use "Discard" to throw the workout away.');
    return;
  }
  if (workout.items.some((it) => it.sets.some((s) => !s.done)) &&
      !confirm('Some sets are not logged. Finish anyway? Only logged sets are saved.')) return;

  const session = {
    id: uid(),
    startedAt: workout.firstLogAt || workout.startedAt,
    endedAt: Date.now(),
    unit: settings.unit,
    items,
  };
  history.unshift(session);
  saveHistory();
  workout = null;
  saveWorkout();
  stopRest();
  renderWorkout();
  $('#planner').open = true;
  setMascot('idle', pick(MSG.idle));
  showCelebration(session);
}

function showCelebration(session) {
  $('#celebrateImg').src = mascotImage('celebrate');
  $('#celebrateMsg').textContent = pick(MSG.celebrate);
  $('#celebrateStats').innerHTML = statsHtml(sessionStats(session), session.unit);
  const colors = ['#e2457a', '#ffb703', '#43c98a', '#4d96ff', '#b388ff'];
  $('.confetti').innerHTML = Array.from({ length: 40 }, () =>
    `<i style="left:${Math.random() * 100}%;background:${pick(colors)};animation-delay:${Math.random() * 0.8}s"></i>`).join('');
  $('#celebrate').hidden = false;
  if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
}
$('#celebrateClose').addEventListener('click', () => { $('#celebrate').hidden = true; });

/* =========================================================
   History
   ========================================================= */

function renderHistory() {
  const list = $('#historyList');
  if (!history.length) {
    list.innerHTML = '<div class="card empty muted">No sessions yet. Finish a workout to see it here.</div>';
    return;
  }
  list.innerHTML = history.map((s) => {
    const d = new Date(s.endedAt);
    const st = sessionStats(s);
    return `
    <article class="card session" data-id="${s.id}">
      <h3><span>${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <button class="btn small danger" data-del="${s.id}" aria-label="Delete session">Delete</button></h3>
      <p class="muted small" style="margin:2px 0 0">${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
      <div class="stats">${statsHtml(st, s.unit)}</div>
      <ul>${s.items.map((it) => `<li><b>${esc(it.name)}</b>: ${it.sets.map((x) =>
        esc(x.w ? `${x.w}×${x.r}` : `${x.r} reps`)).join(', ')}</li>`).join('')}</ul>
    </article>`;
  }).join('');
}

$('#historyList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (!confirm('Delete this session from history?')) return;
  history = history.filter((s) => s.id !== b.dataset.del);
  saveHistory();
  renderHistory();
});

/* =========================================================
   Library
   ========================================================= */

function setupLibraryFilters() {
  $('#libMuscle').innerHTML = '<option value="">All muscles</option>' +
    Object.keys(MUSCLE_GROUPS).map((m) => `<option value="${m}">${cap(m)}</option>`).join('') +
    '<option value="other">Other</option>';
  $('#libEquip').innerHTML = '<option value="">All equipment</option>' +
    Object.entries(EQUIPMENT).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('') +
    '<option value="other">Other</option>';
  ['#libSearch', '#libMuscle', '#libEquip'].forEach((s) => $(s).addEventListener('input', renderLibrary));
}

function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const m = $('#libMuscle').value;
  const eq = $('#libEquip').value;
  const results = DB.filter((e) =>
    (!q || e.name.toLowerCase().includes(q)) &&
    (!m || e._group === m) &&
    (!eq || e._equip === eq));
  $('#libCount').textContent = `${results.length} exercise${results.length === 1 ? '' : 's'}`;
  $('#libList').innerHTML = results.map((e) => `
    <article class="card lib-item" data-id="${esc(e.id)}">
      <div class="lib-row" data-action="toggle">
        ${e.images.length ? `<img src="${imgUrl(e.images[0])}" alt="" loading="lazy">` : '<img alt="">'}
        <div class="info">
          <div class="name">${esc(e.name)}</div>
          <div class="meta">${esc(e.primaryMuscles.join(', '))} · ${esc(e.equipment || 'none')} · ${esc(e.level)}</div>
        </div>
        <button class="btn small primary" data-action="add">+ Add</button>
      </div>
      <div class="lib-detail"></div>
    </article>`).join('');
}

$('#libList').addEventListener('click', (e) => {
  const card = e.target.closest('.lib-item'); if (!card) return;
  const ex = byId[card.dataset.id];
  const btn = e.target.closest('[data-action]');
  if (btn && btn.dataset.action === 'add') {
    if (!workout) workout = { startedAt: Date.now(), items: [] };
    workout.items.push(newItem(ex.id, ex._group));
    saveWorkout();
    renderWorkout();
    $('#planner').open = false;
    btn.textContent = '✓ Added';
    setTimeout(() => { btn.textContent = '+ Add'; }, 1500);
    return;
  }
  // Tap the row to show photos + instructions (loaded only when opened)
  const detail = card.querySelector('.lib-detail');
  if (!detail.innerHTML && ex.images.length) detail.innerHTML = exerciseMedia(ex);
  else if (!detail.innerHTML) detail.innerHTML = `<ol>${ex.instructions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  card.classList.toggle('open');
});

/* =========================================================
   Start up
   ========================================================= */

async function init() {
  applyTheme();
  renderChips();
  setupLibraryFilters();
  setMascot('idle', pick(MSG.idle)); // built-in seal first, mascot/ images once loaded
  try {
    const res = await fetch('data/exercises.json');
    DB = await res.json();
  } catch {
    $('#workoutArea').innerHTML = '<div class="card empty">Could not load exercises. Is the app served by a web server?</div>';
    return;
  }
  DB.sort((a, b) => a.name.localeCompare(b.name));
  DB.forEach((e) => { byId[e.id] = e; e._group = groupOf(e); e._equip = equipKeyOf(e); });
  if (workout) workout.items = workout.items.filter((it) => byId[it.id]);
  renderWorkout();
  renderLibrary();
  if (workout && workout.items.length) $('#planner').open = false;
  await loadMascots();
  setMascot('idle', workout && workout.items.length ? pick(MSG.active) : pick(MSG.idle));
}

init();
