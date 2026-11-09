(function () {
  'use strict';

  var cfg = window.APP_CONFIG || {};
  var app = document.getElementById('app');
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/ВАШ|ВСТАВЬТЕ/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
  if (!configured || !window.supabase) {
    app.innerHTML = '<div class="wrap"><div class="card" style="margin-top:40px"><h1 class="h2">Сайт почти готов</h1><p class="muted">Откройте файл <b>config.js</b> и вставьте адрес и ключ проекта Supabase — подробности в инструкции.</p></div></div>';
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // ---------------------------------------------------------------- state
  var S = { session: null, me: null, teacherId: null, students: [], invites: [], studentId: localStorage.getItem('studentId') || null };
  var ui = { hwEdit: null, wordEdit: null, matEdit: null, hwTab: 'todo', folderId: null, matFilter: 'all', matAdd: false, loginMode: 'login', period: 'weeks', notes: null, train: null, lastPath: null };

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#'; }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('?');
    return { path: parts[0] || 'home', params: new URLSearchParams(parts[1] || '') };
  }
  function go(path) { location.hash = '#/' + path; }
  function isT() { return !!(S.me && S.me.role === 'teacher'); }
  function sid() { return isT() ? S.studentId : (S.me && S.me.id); }
  function studentName(id) {
    var s = S.students.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : 'ученица';
  }
  function curStudent() { return S.students.filter(function (x) { return x.id === S.studentId; })[0] || null; }
  function codeFor(id) { var i = S.invites.filter(function (x) { return x.profile_id === id; })[0]; return i ? i.code : ''; }
  function newCode() {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = 'B1-';
    var rnd = new Uint32Array(5); crypto.getRandomValues(rnd);
    for (var i = 0; i < 5; i++) code += abc[rnd[i] % abc.length];
    return code;
  }
  async function q(p) {
    var r = await p;
    if (r.error) { console.error(r.error); toast('Ошибка: ' + (r.error.message || r.error)); throw r.error; }
    return r.data;
  }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b;
    return c;
  }
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var DAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayMonth(d) { return d.getDate() + ' ' + MON[d.getMonth()]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function lessonWhen(d) { return cap(DAYS[d.getDay()]) + ', ' + dayMonth(d) + ', ' + hhmm(d); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dueText(s) { if (!s) return 'БЕЗ СРОКА'; var d = parseDate(s); return 'СРОК: ' + DAYS_SHORT[d.getDay()].toUpperCase() + ', ' + dayMonth(d).toUpperCase(); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function extOf(name) { var m = /\.([a-z0-9]{1,6})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function extTag(name) {
    var e = extOf(name).toUpperCase() || 'FILE';
    var cls = e === 'PDF' ? 'pdf' : (e === 'DOC' || e === 'DOCX') ? 'doc' : '';
    return '<span class="ext ' + cls + '">' + esc(e) + '</span>';
  }
  function fmtSize(b) { if (!b) return ''; if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' КБ'; return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ'; }
  var MAX_FILE = 20 * 1024 * 1024;
  async function upload(file, prefix) {
    if (file.size > MAX_FILE) { toast('Файл «' + file.name + '» больше 20 МБ'); throw new Error('too big'); }
    var e = extOf(file.name);
    var path = prefix + '/' + crypto.randomUUID() + (e ? '.' + e : '');
    var r = await sb.storage.from('files').upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (r.error) { toast('Не удалось загрузить файл: ' + r.error.message); throw r.error; }
    return path;
  }
  function fileChip(f, cls) {
    return '<button type="button" class="file ' + (cls || '') + '" data-act="open-file" data-path="' + esc(f.path) + '">' + extTag(f.name) + '<span>' + esc(f.name) + (f.size ? ' · ' + fmtSize(f.size) : '') + '</span></button>';
  }
  function say(text) {
    if (!('speechSynthesis' in window)) { toast('Браузер не умеет озвучивать текст'); return; }
    var u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = 0.9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  var SPEAK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  var XICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  var UPLOAD = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

  function svgI(inner) { return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; }
  var ICON = {
    bow: svgI('<path d="M24 22c-5-7-15-10-15-3s10 6 15 3z"/><path d="M24 22c5-7 15-10 15-3s-10 6-15 3z"/><circle cx="24" cy="22" r="2.2"/><path d="M22.5 24c-2 6-6 12-9 16M25.5 24c1 7 4 12 8 16"/>'),
    clip: svgI('<rect x="10" y="22" width="28" height="16" rx="2"/><path d="M16 22v-6a8 8 0 0 1 16 0v6"/><circle cx="24" cy="15" r="2"/><path d="M14 30h20"/>'),
    lens: svgI('<circle cx="20" cy="20" r="11"/><circle cx="20" cy="20" r="7.5" stroke-dasharray="2 3"/><path d="M28 28l12 12"/><path d="M38 38l3 3"/>'),
    key: svgI('<circle cx="15" cy="33" r="7"/><circle cx="15" cy="33" r="2.5"/><path d="M20 28L38 10"/><path d="M33 15l4 4M29 19l3 3"/><path d="M8 26c3-2 6-2 8 0"/>')
  };
  function stamp() {
    return '<div class="stamp" aria-hidden="true"><div class="stamp-in"><b>EN</b>' + ICON.key + '<i>' + String(new Date().getFullYear()).slice(2) + '</i></div></div>';
  }
  var ENVELOPE = '<svg class="envelope" viewBox="0 0 200 140" aria-hidden="true"><rect x="4" y="4" width="192" height="132" rx="4" fill="#FFFDF9" stroke="#E2D8CC"/><path d="M4 8l96 70 96-70" fill="#F6F1EA" stroke="#E2D8CC"/><circle cx="100" cy="76" r="15" fill="#A8C5E6"/><circle cx="100" cy="76" r="9" fill="none" stroke="#7FA3CF" stroke-width="2"/></svg>';
  var BOOK = '<svg viewBox="0 0 400 260" fill="none" stroke="#4B2A1C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M40 200c40-14 90-14 140 4V60C130 42 80 42 40 56z"/><path d="M180 204c50-18 100-18 140-4V56c-40-14-90-14-140 4"/><path d="M70 90c25-6 55-6 80 2M70 120c25-6 55-6 80 2M70 150c25-6 55-6 80 2M210 92c25-8 55-8 80-2M210 122c25-8 55-8 80-2"/></svg>';
  function collage(word, caption) {
    return '<div class="collage" aria-hidden="true">' + ENVELOPE + '<div class="polaroid"><div class="shot">' + BOOK + '<span>' + esc(word) + '</span></div><div class="cap">' + esc(caption) + '</div></div>' + stamp() + '</div>';
  }
  function fcard(href, color, tab, title, text, meta, icon, sheet) {
    return '<a class="fcard" href="' + href + '"><div class="sheet">' + sheet + '</div><div class="fbody" style="--c:' + color + '"><span class="tab">(' + tab.toUpperCase() + ')</span><h3>' + title + '</h3><p>' + text + '</p><span class="meta">' + meta + '</span><span class="ico">' + icon + '</span></div></a>';
  }
  function pageHead(tab, title, notes) {
    return '<header class="page-head"><div><span class="eyebrow">(' + tab + ')</span><h1 class="display l">' + title + '</h1></div>' + (notes ? '<div class="notes">' + notes + '</div>' : '') + '</header>';
  }

  // ---------------------------------------------------------------- data
  async function loadMe() {
    if (!S.session) { S.me = null; return; }
    if (!S.me || S.me.id !== S.session.user.id) {
      S.me = await q(sb.from('profiles').select('*').eq('id', S.session.user.id).maybeSingle());
      var t = await q(sb.from('profiles').select('id,name').eq('role', 'teacher').maybeSingle());
      S.teacherId = t ? t.id : null;
    }
    if (isT()) {
      S.students = await q(sb.from('profiles').select('*').eq('role', 'student').order('created_at'));
      S.invites = await q(sb.from('invites').select('*').is('used_by', null).order('created_at'));
      if (!S.students.some(function (s) { return s.id === S.studentId; })) S.studentId = S.students[0] ? S.students[0].id : null;
      if (S.studentId) localStorage.setItem('studentId', S.studentId);
    }
  }

  // folders and words visible for a given user (owner of progress)
  async function loadVocab(userId) {
    var folders = await q(sb.from('folders').select('*').order('created_at'));
    folders = folders.filter(function (f) { return f.owner_id === S.teacherId || (userId && f.owner_id === userId); });
    var ids = folders.map(function (f) { return f.id; });
    var words = ids.length ? await q(sb.from('words').select('*').in('folder_id', ids).order('created_at', { ascending: false })) : [];
    var prog = userId ? await q(sb.from('word_progress').select('*').eq('user_id', userId)) : [];
    var pm = new Map(prog.map(function (p) { return [p.word_id, p]; }));
    return { folders: folders, words: words, pm: pm };
  }
  async function loadGoals(st) { return st ? await q(sb.from('word_goals').select('*').eq('student_id', st).order('created_at')) : []; }
  function goalStats(g, v) {
    var words = g.folder_id ? v.words.filter(function (w) { return w.folder_id === g.folder_id; }) : v.words;
    var learned = words.filter(function (w) { var p = v.pm.get(w.id); return p && p.status === 'learned'; }).length;
    var due = words.filter(function (w) { return isDue(w, v.pm); }).length;
    var f = g.folder_id ? v.folders.filter(function (x) { return x.id === g.folder_id; })[0] : null;
    return { learned: Math.min(learned, g.target), target: g.target, due: due, pct: Math.min(100, Math.round(learned / g.target * 100)), scope: f ? '«' + f.name + '»' : 'из всех папок', done: learned >= g.target };
  }
  function goalTitle(g, gs) {
    return 'Выучить ' + g.target + ' ' + plural(g.target, 'слово', 'слова', 'слов') + ' ' + gs.scope + (g.due_date ? ' до ' + dayMonth(parseDate(g.due_date)) : '');
  }
  function isDue(w, pm) { var p = pm.get(w.id); return !p || new Date(p.due_at) <= new Date(); }
  function isFresh(w) { return w.added_by && w.added_by !== S.teacherId && (Date.now() - new Date(w.created_at)) < 7 * 864e5; }

  // ---------------------------------------------------------------- shell
  function footer() { return '<footer class="foot"><span>English</span><span>English · ' + new Date().getFullYear() + ' · keep talking</span></footer>'; }
  function shell(path, inner) {
    var links = [['home', 'HOME'], ['homework', 'HOMEWORK'], ['vocabulary', 'VOCABULARY'], ['materials', 'MATERIALS'], ['progress', 'PROGRESS']];
    var nav = links.map(function (l) {
      return '<a href="#/' + l[0] + '"' + (path === l[0] ? ' class="active" aria-current="page"' : '') + '>' + l[1] + '</a>';
    }).join('');
    var pick = '';
    if (isT() && S.students.length) {
      pick = '<label><span class="sr">Ученица</span><select class="student-pick" data-change="student">' +
        S.students.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === S.studentId ? ' selected' : '') + '>' + esc(s.name) + (s.pending ? ' (ждёт регистрации)' : '') + '</option>'; }).join('') +
        '</select></label>';
    }
    var name = esc(S.me.name) + (isT() ? ' · учитель' : '');
    return '<header class="topbar"><div class="topbar-in"><a class="logo" href="#/home">English</a><nav class="nav-links" aria-label="Разделы сайта">' + nav + '</nav>' +
      '<div class="acct">' + pick + '<span class="avatar" aria-hidden="true">' + esc((S.me.name || '?').charAt(0).toUpperCase()) + '</span>' +
      '<span class="acct-name">' + name + '</span><button type="button" class="linkbtn" data-act="logout">ВЫЙТИ</button></div></div></header>' +
      '<div class="wrap">' + pendingBanner() + inner + footer() + '</div>';
  }
  function pendingBanner() {
    var c = isT() && curStudent();
    if (!c || !c.pending) return '';
    var code = codeFor(c.id);
    return '<div class="notice"><span>' + esc(c.name).toUpperCase() + ' ЕЩЁ НЕ ЗАРЕГИСТРИРОВАЛАСЬ — ВСЁ, ЧТО ВЫ ПОДГОТОВИТЕ, ОНА УВИДИТ ПОСЛЕ РЕГИСТРАЦИИ' + (code ? ' ПО КОДУ ' + esc(code) : '') + '</span>' +
      (code ? '<button type="button" class="btn sm" data-act="invite-copy" data-code="' + esc(code) + '">СКОПИРОВАТЬ ССЫЛКУ</button>' : '') + '</div>';
  }
  function noStudent() {
    return '<div class="card bluefill" style="margin-top:20px"><h2 class="h2">Пока нет учеников</h2><p class="muted">Добавьте ученицу на главной странице (блок «Ученицы»). Сразу после этого можно готовить для неё уроки, домашку и оценки, а код приглашения отправить, когда будете готовы.</p><a class="btn" href="#/home">НА ГЛАВНУЮ</a></div>';
  }

  // ---------------------------------------------------------------- render loop
  var seq = 0;
  async function render() {
    var my = ++seq;
    var r = route();
    var changed = ui.lastPath !== r.path;
    ui.lastPath = r.path;
    var y = window.scrollY;
    if (r.path === 'reset') { app.innerHTML = resetPage(); return; }
    if (!S.session) { await renderLogin(r); return; }
    try { await loadMe(); } catch (e) { app.innerHTML = '<div class="wrap"><p class="err" style="margin-top:40px">Не удалось загрузить профиль. Обновите страницу.</p></div>'; return; }
    if (!S.me) {
      app.innerHTML = '<div class="wrap"><div class="card" style="margin-top:40px"><p class="err">Профиль не найден.</p><button class="btn" data-act="logout">ВЫЙТИ</button></div></div>';
      return;
    }
    if (r.path === 'login') { go('home'); return; }
    var pages = { home: pageHome, homework: pageHomework, vocabulary: pageVocab, materials: pageMaterials, progress: pageProgress, train: pageTrain };
    var fn = pages[r.path] || pageHome;
    if (changed) app.innerHTML = shell(r.path, '<p class="loading">Загрузка…</p>');
    try {
      var html = await fn(r);
      if (my !== seq) return;
      app.innerHTML = shell(r.path, html);
      if (changed) window.scrollTo(0, 0); else window.scrollTo(0, y);
    } catch (e) {
      console.error(e);
      if (my === seq) app.innerHTML = shell(r.path, '<p class="err">Не удалось загрузить страницу: ' + esc(e.message || e) + '</p>');
    }
  }
  function refresh() { return render(); }

  // ---------------------------------------------------------------- auth pages
  async function renderLogin(r) {
    var invite = r.params.get('invite') || '';
    if (invite) ui.loginMode = 'register';
    var teacherExists = true, connErr = '';
    try {
      var tr = await sb.rpc('teacher_exists');
      if (tr.error) connErr = 'База ответила ошибкой: ' + (tr.error.message || tr.error.code || '') + '. Проверьте, что schema.sql запущен в Supabase.';
      else teacherExists = !!tr.data;
    } catch (e) { connErr = 'Не удаётся связаться с базой Supabase. Проверьте адрес в config.js и интернет-соединение.'; }
    var reg = ui.loginMode === 'register';
    var form;
    if (!reg) {
      form = '<form class="form" data-form="login" novalidate>' +
        '<label class="field full">EMAIL<input name="email" type="email" autocomplete="email" required></label>' +
        '<label class="field full">ПАРОЛЬ<input name="password" type="password" autocomplete="current-password" required></label>' +
        '<p class="err" hidden></p>' +
        '<button class="btn block" type="submit">Войти</button>' +
        '<button type="button" class="linkbtn" style="align-self:flex-end" data-act="forgot">Забыли пароль?</button>' +
        '<p class="muted" style="margin:0;font-size:13px;text-align:center">Нет аккаунта? <button type="button" class="linkbtn" data-act="mode" data-mode="register">Зарегистрируйся по приглашению</button></p>' +
        '</form>';
    } else {
      form = '<form class="form" data-form="register" novalidate>' +
        (teacherExists
          ? '<p class="muted" style="margin:0;line-height:1.5">Регистрация только по коду приглашения от учителя.</p>'
          : '<p class="notice" style="margin:0">Первая настройка: регистрация учителя. Используйте email, указанный в настройках базы.</p>') +
        '<label class="field full">ИМЯ<input name="name" autocomplete="name" required></label>' +
        '<label class="field full">EMAIL<input name="email" type="email" autocomplete="email" required></label>' +
        '<label class="field full">ПАРОЛЬ<input name="password" type="password" autocomplete="new-password" minlength="8" required><span class="muted" style="font-size:12px">минимум 8 символов</span></label>' +
        (teacherExists ? '<label class="field full">КОД ПРИГЛАШЕНИЯ<input name="code" value="' + esc(invite) + '" required style="letter-spacing:.06em;font-weight:800"></label>' : '') +
        '<p class="err" hidden></p><p class="ok" hidden></p>' +
        '<button class="btn block" type="submit">Зарегистрироваться</button>' +
        '<p class="muted" style="margin:0;font-size:13px;text-align:center">Уже есть аккаунт? <button type="button" class="linkbtn" data-act="mode" data-mode="login">Войти</button></p>' +
        '</form>';
    }
    app.innerHTML = '<header class="topbar"><div class="topbar-in"><span class="logo">English</span><span class="acct-name">' + (reg ? 'регистрация' : 'вход') + '</span></div></header>' +
      '<div class="wrap"><div class="auth"><div><span class="eyebrow">(' + (reg ? 'по приглашению учителя' : 'с возвращением') + ')</span>' +
      '<h1 class="display xl">' + (reg ? 'Welcome <em>to class</em>' : 'Hello <em>again</em>') + '</h1>' +
      collage(reg ? 'welcome!' : 'hello!', 'keep talking') + '</div>' +
      '<div class="auth-card">' +
      '<div class="pills" style="margin-bottom:22px"><button type="button" class="pill' + (!reg ? ' on' : '') + '" data-act="mode" data-mode="login">Вход</button><button type="button" class="pill' + (reg ? ' on' : '') + '" data-act="mode" data-mode="register">Регистрация</button></div>' +
      (connErr ? '<p class="err" style="margin-bottom:12px">' + esc(connErr) + '</p>' : '') + form + '</div></div>' + footer() + '</div>';
  }
  function showErr(form, msg) { var e = form.querySelector('.err'); if (e) { e.textContent = msg; e.hidden = !msg; } }
  function showOk(form, msg) { var e = form.querySelector('.ok'); if (e) { e.textContent = msg; e.hidden = !msg; } }

  function resetPage() {
    return '<div class="wrap"><div class="card" style="margin:60px auto 0;max-width:460px;width:100%"><h1 class="h2" style="margin-bottom:16px">Новый пароль</h1>' +
      '<form class="form" data-form="reset"><label class="field full">НОВЫЙ ПАРОЛЬ<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>' +
      '<p class="err" hidden></p><button class="btn block" type="submit">СОХРАНИТЬ</button></form></div></div>';
  }

  // ---------------------------------------------------------------- HOME
  function routeHtml(lessons) {
    if (!lessons.length) return '<p class="muted" style="margin:0">Уроки пока не назначены.</p>';
    var now = Date.now(), nextDone = false;
    var start = Math.max(0, lessons.length - 10);
    var items = lessons.slice(start).map(function (l, i) {
      var d = new Date(l.starts_at), past = d.getTime() < now, cls = '', small;
      if (past) { small = 'пройден'; }
      else if (!nextDone) { cls = 'next'; nextDone = true; small = DAYS_SHORT[d.getDay()] + ', ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()]; }
      else { cls = 'future'; small = d.getDate() + ' ' + MON_SHORT[d.getMonth()]; }
      return '<div class="stop"><span class="ln' + (past ? '' : ' dash') + '"></span><span class="num ' + cls + '">' + (start + i + 1) + '</span><b>' + esc(l.topic || 'урок') + '</b><small>' + small + '</small></div>';
    }).join('');
    return '<div style="overflow-x:auto"><div class="route" style="--n:' + Math.min(lessons.length, 10) + '">' + items + '</div></div>';
  }

  async function pageHome() {
    var st = sid(), t = isT(), now = new Date();
    var res = await Promise.all([
      st ? q(sb.from('lessons').select('*').eq('student_id', st).order('starts_at')) : [],
      st ? q(sb.from('homework').select('id,title,status,due_date,lesson_label').eq('student_id', st).order('created_at', { ascending: false })) : [],
      loadVocab(st),
      [],
      q(sb.from('materials').select('id,title,group_name,url,file_name,added_by').order('created_at', { ascending: false }).limit(4)),
      loadGoals(st)
    ]);
    var goals = res[5], g0 = goals[0] ? goalStats(goals[0], res[2]) : null;
    var lessons = res[0], hw = res[1], v = res[2], invites = res[3], mats = res[4];
    var nextIdx = -1;
    for (var i = 0; i < lessons.length; i++) { if (new Date(lessons[i].starts_at).getTime() > now.getTime() - 3600e3) { nextIdx = i; break; } }
    var next = nextIdx >= 0 ? lessons[nextIdx] : null;
    var pastCount = lessons.filter(function (l) { return new Date(l.starts_at) <= now; }).length;
    var todo = hw.filter(function (h) { return h.status === 'todo'; });
    var nearest = todo.filter(function (h) { return h.due_date; }).sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; })[0] || todo[0];
    var waiting = hw.filter(function (h) { return h.status === 'done'; }).length;
    var doneAll = hw.filter(function (h) { return h.status !== 'todo'; }).length;
    var due = st ? v.words.filter(function (w) { return isDue(w, v.pm); }).length : 0;
    var learned = 0; v.pm.forEach(function (p) { if (p.status === 'learned') learned++; });
    var fresh = v.words.filter(function (w) { return st && w.added_by === st && isFresh(w); }).length;
    var topics = v.folders.filter(function (f) { return f.owner_id === S.teacherId; }).length;
    var own = v.folders.length - topics;

    var clues = [];
    if (g0) clues.push('цель: ' + goalTitle(goals[0], g0).toLowerCase() + ' — выучено ' + g0.learned + ' из ' + g0.target);
    if (nearest) clues.push((nearest.due_date ? 'до ' + dayMonth(parseDate(nearest.due_date)) + ' — ' : 'домашка — ') + esc(nearest.title));
    if (next) { var nd0 = new Date(next.starts_at); clues.push(DAYS[nd0.getDay()] + ', ' + hhmm(nd0) + ' — урок ' + (nextIdx + 1) + (next.topic ? ': ' + esc(next.topic) : '')); }

    // --- hero
    var hero = '<section class="hero2"><div>' +
      '<span class="eyebrow">(' + (t ? 'кабинет учителя' : 'твой английский: уроки, слова, домашка') + ')</span>' +
      '<h1 class="display xl">English <em>you’re killing it, girl</em></h1>' +
      '<p class="lead">Каждый урок — ещё одна улика. Слова, домашка и материалы собраны в одной папке.</p>' +
      '<div class="hero-btns"><a class="btn" href="#/train">Repeat vocabulary</a><a class="btn outline" href="#/homework">Домашка</a></div>' +
      (clues.length ? '<ul class="clues">' + clues.map(function (c) { return '<li>' + c + '</li>'; }).join('') + '</ul>' : '') +
      '</div>' + collage('let’s talk!', next ? DAYS_EN[new Date(next.starts_at).getDay()].toLowerCase() + ', ' + hhmm(new Date(next.starts_at)) : 'see you soon') + '</section>';

    var marquee = '<div class="marquee bleed" aria-hidden="true"><div class="marquee-track">' +
      new Array(12).join('x').split('x').map(function (_, i) { return '<span>' + ['You’re killing it, girl', 'Keep talking', 'Practice makes progress'][i % 3] + '</span>'; }).join('') + '</div></div>';

    // --- folders
    var nextHw = todo[0];
    var folders = '<section class="col" style="gap:8px"><div class="section-title"><span class="eyebrow">(всё по папкам)</span><h2 class="display m">Мои <em>разделы</em></h2></div><div class="folders">' +
      fcard('#/homework', 'var(--beige)', 'домашка', 'Home<em>work</em>', 'Задания с фото, PDF и DOCX, отметки «сделано» и комментарии', 'осталось ' + todo.length + ' · сдано ' + doneAll, ICON.bow,
        nextHw ? '<b>' + esc(nextHw.title) + '</b><small>' + esc(dueText(nextHw.due_date).toLowerCase()) + '</small>' : '<b>Всё сдано</b><small>новых заданий пока нет</small>') +
      fcard('#/vocabulary', 'var(--tan)', 'слова', 'Vocab<em>ulary</em>', 'Слова по топикам' + (t ? ' и папки учениц' : ' и свои папки'), v.words.length + ' ' + plural(v.words.length, 'слово', 'слова', 'слов') + ' · ' + topics + ' ' + plural(topics, 'топик', 'топика', 'топиков') + (own ? ' · ' + own + ' ' + plural(own, 'папка', 'папки', 'папок') : ''), ICON.clip,
        v.words.length ? v.words.slice(0, 2).map(function (w) { return '<b>' + esc(w.en) + '</b><small>' + esc(w.ru) + '</small>'; }).join('<i></i>') : '<b>Слов пока нет</b>') +
      fcard('#/materials', 'var(--sky2)', 'материалы', 'Mate<em>rials</em>', 'Шпаргалки, подкасты, видео и файлы', mats.length ? 'новое: ' + esc(mats[0].group_name) : 'пока пусто', ICON.key,
        mats.length ? mats.slice(0, 2).map(function (m) { return '<b>' + esc(m.title) + '</b><small>' + esc(m.group_name) + '</small>'; }).join('<i></i>') : '<b>Материалов пока нет</b>') +
      fcard('#/progress', 'var(--blue-paper)', 'прогресс', 'Pro<em>gress</em>', 'Цели, уроки и оценки навыков', g0 ? 'цель: ' + g0.learned + ' из ' + g0.target + ' слов' : pastCount + ' ' + plural(pastCount, 'урок пройден', 'урока пройдено', 'уроков пройдено'), ICON.lens,
        '<b>' + pastCount + ' ' + plural(pastCount, 'урок', 'урока', 'уроков') + '</b><small>уже позади</small>') +
      '</div></section>';

    // --- dark band: stickies
    var notes = [];
    if (st) notes.push(['#/train', ICON.clip, g0 ? 'выучено ' + g0.learned + ' из ' + g0.target + ' ' + plural(g0.target, 'слова', 'слов', 'слов') : 'потренировать слова', g0 ? 'цель' : 'тренировка']);
    notes.push(['#/homework', ICON.bow, nearest ? esc(nearest.title) : 'вся домашка сдана', nearest && nearest.due_date ? 'до ' + dayMonth(parseDate(nearest.due_date)) : 'домашка']);
    notes.push(['#/home', ICON.lens, next ? 'урок: ' + esc(next.topic || 'без темы') : 'урок скоро назначат', next ? DAYS_SHORT[new Date(next.starts_at).getDay()] + ', ' + hhmm(new Date(next.starts_at)) : 'следующий урок']);
    if (t && st) notes.push(['#/homework', ICON.key, waiting + ' ' + plural(waiting, 'работа ждёт', 'работы ждут', 'работ ждут') + ' проверки', '+' + fresh + ' ' + plural(fresh, 'слово', 'слова', 'слов') + ' от ученицы']);
    else notes.push(['#/materials', ICON.key, mats.length ? esc(mats[0].title) : 'полезные материалы', 'материалы']);
    var dark = '<section class="darkband bleed"><span class="eyebrow">(улики на сегодня)</span><h2 class="display m">Что <em>в планах</em>…</h2><div class="stickies">' +
      notes.map(function (n) { return '<a class="sticky" href="' + n[0] + '">' + n[1] + '<span>' + n[2] + '</span><small>' + n[3] + '</small></a>'; }).join('') +
      '</div><a class="btn sky" href="#/train" style="min-width:240px">Repeat vocabulary</a></section>';

    // --- stripes: next lesson stamp + teacher lesson form
    var stampInner;
    if (next) {
      var d = new Date(next.starts_at);
      stampInner = '<span class="eyebrow" style="margin:0">(следующий урок)</span><h2 class="display m">Next lesson is <em>' + DAYS_EN[d.getDay()] + '</em></h2>' +
        '<p class="lead">' + esc(lessonWhen(d)) + '<br><em style="font-family:var(--display);font-size:20px">' + esc(next.topic || 'без темы') + '</em></p>' +
        (next.call_link ? '<a class="btn" href="' + esc(safeUrl(next.call_link)) + '" target="_blank" rel="noopener">Подключиться к уроку</a>' : '<a class="btn" href="#/vocabulary">Подготовиться к уроку</a>');
    } else {
      stampInner = '<span class="eyebrow" style="margin:0">(следующий урок)</span><h2 class="display m">Next lesson is <em>soon</em></h2><p class="lead">' + (t ? (st ? 'Назначьте урок ниже' : 'Сначала добавьте ученицу') : 'Учитель скоро назначит урок') + '</p>';
    }
    var lessonPanel = '';
    if (t && st) {
      var upcoming = lessons.filter(function (l) { return new Date(l.starts_at).getTime() > now.getTime() - 3600e3; });
      lessonPanel = '<div class="teacher-panel"><form class="form" data-form="lesson">' +
        '<span class="label">Назначить урок для: ' + esc(studentName(st)) + '</span>' +
        '<div class="fields"><label class="field">ДАТА<input type="date" name="date" required value="' + dayKey(new Date(Date.now() + 864e5)) + '"></label>' +
        '<label class="field" style="flex-basis:110px">ВРЕМЯ<input type="time" name="time" required value="19:00"></label>' +
        '<label class="field wide">ТЕМА<input name="topic" placeholder="Talking about plans"></label>' +
        '<label class="field wide">ССЫЛКА НА ЗВОНОК<input name="link" type="url" placeholder="https://"></label>' +
        '<button class="btn" type="submit">Сохранить</button></div><p class="err" hidden></p></form>' +
        (upcoming.length ? '<div class="lesson-list">' + upcoming.map(function (l) {
          var ld = new Date(l.starts_at);
          return '<div class="lesson-item"><span>' + esc(lessonWhen(ld)) + ' · ' + esc(l.topic) + '</span><button type="button" class="iconbtn" aria-label="Удалить урок" data-act="lesson-del" data-id="' + esc(l.id) + '">' + XICON + '</button></div>';
        }).join('') + '</div>' : '') + '</div>';
    }
    var stripes = '<section class="stripeband stripes bleed"><div class="bigstamp"><div class="bigstamp-in">' + stampInner + '</div>' + stamp() + '</div>' + lessonPanel + '</section>';

    // --- teacher: class
    var klass = '';
    if (t) {
      klass = '<section class="col" style="gap:18px"><div class="section-title"><span class="eyebrow">(кабинет учителя)</span><h2 class="display m">Мой <em>класс</em></h2>' +
        '<p class="muted" style="margin:0;max-width:520px">Добавьте ученицу заранее и готовьте для неё уроки и домашку. Код приглашения отправьте, когда будете готовы.</p></div>' +
        '<div class="class-grid">' + S.students.map(function (s2) {
          var code = codeFor(s2.id);
          return '<div class="index-card' + (s2.pending ? ' pending' : '') + '"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="h3">' + esc(s2.name) + '</span>' +
            (s2.pending ? '<button type="button" class="iconbtn" aria-label="Удалить ученицу" data-act="student-del" data-id="' + esc(s2.id) + '">' + XICON + '</button>' : '<span class="badge b-learned">В КЛАССЕ</span>') + '</div>' +
            (s2.pending ? '<span class="label pk">ждёт регистрации</span><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="code">' + esc(code || '—') + '</span>' +
              (code ? '<button type="button" class="btn sm" data-act="invite-copy" data-code="' + esc(code) + '">Ссылка</button>' : '<button type="button" class="btn sm" data-act="invite-new" data-id="' + esc(s2.id) + '">Создать код</button>') + '</div>' : '<span class="muted" style="font-size:13px">зарегистрирована</span>') +
            '</div>';
        }).join('') +
        '<form class="index-card form" data-form="student-new" style="gap:10px;border-top-color:var(--ink)"><label class="field full">НОВАЯ УЧЕНИЦА<input name="name" required placeholder="Имя"></label><button class="btn outline sm" type="submit">+ Добавить</button><p class="err" hidden></p></form>' +
        '</div></section>';
    }

    // --- trail
    var trail = '<section class="trail bleed"><div class="section-title"><span class="eyebrow">(маршрут курса)</span><h2 class="display m">You are <em>here</em></h2>' +
      '<p class="muted" style="margin:0">' + pastCount + ' ' + plural(pastCount, 'урок пройден', 'урока пройдено', 'уроков пройдено') + (g0 ? ' · цель: ' + g0.learned + ' из ' + g0.target + ' слов' : '') + ' · ' + doneAll + ' из ' + hw.length + ' домашек сдано</p></div>' +
      '<div class="card">' + routeHtml(lessons) + '</div><div style="display:flex;justify-content:center"><a class="btn outline" href="#/progress">Смотреть прогресс</a></div></section>';

    return hero + marquee + folders + dark + stripes + klass + trail;
  }

  // ---------------------------------------------------------------- HOMEWORK
  async function pageHomework() {
    var st = sid(), t = isT();
    if (!st) return noStudent();
    var hw = await q(sb.from('homework').select('*').eq('student_id', st).order('created_at', { ascending: false }));
    var files = hw.length ? await q(sb.from('homework_files').select('*').in('homework_id', hw.map(function (h) { return h.id; })).order('created_at')) : [];
    var todo = hw.filter(function (h) { return h.status === 'todo'; }).sort(function (a, b) { return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1; });
    var done = hw.filter(function (h) { return h.status !== 'todo'; }).sort(function (a, b) { return (b.done_at || b.created_at) > (a.done_at || a.created_at) ? 1 : -1; });
    var list = ui.hwTab === 'todo' ? todo : done;

    var form = '';
    if (t) {
      form = '<section class="paper pinkp"><form class="form" data-form="hw-new">' +
        '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline"><h2 class="display s">Новое <em>задание</em></h2><span class="label">//ДЛЯ: ' + esc(studentName(st)).toUpperCase() + '</span></div>' +
        '<div class="fields"><label class="field wide">НАЗВАНИЕ<input name="title" required placeholder="Например: письмо другу о планах"></label>' +
        '<label class="field">К УРОКУ<input name="label" placeholder="Урок 6 · говорение"></label>' +
        '<label class="field" style="flex-basis:160px">СРОК<input name="due" type="date"></label></div>' +
        '<label class="field full">ОПИСАНИЕ<textarea name="desc" rows="3"></textarea></label>' +
        '<label class="drop">' + UPLOAD + '<span>ПЕРЕТАЩИ ФАЙЛЫ СЮДА ИЛИ НАЖМИ, ЧТОБЫ ВЫБРАТЬ</span><small data-files>Фото (JPG, PNG), PDF, DOCX · до 20 МБ каждый</small><input type="file" name="files" multiple accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,audio/*" data-change="show-files"></label>' +
        '<p class="err" hidden></p><button class="btn" type="submit" style="align-self:flex-start">ОПУБЛИКОВАТЬ ДЛЯ УЧЕНИЦЫ</button></form></section>';
    }

    var cards = list.map(function (h) {
      var tf = files.filter(function (f) { return f.homework_id === h.id && f.kind === 'task'; });
      var af = files.filter(function (f) { return f.homework_id === h.id && f.kind === 'answer'; });
      if (t && ui.hwEdit === h.id) {
        return '<article class="card hw"><form class="form hw-main" data-form="hw-edit" data-id="' + esc(h.id) + '"><span class="label pk">редактирование задания</span>' +
          '<div class="fields"><label class="field wide">НАЗВАНИЕ<input name="title" required value="' + esc(h.title) + '"></label>' +
          '<label class="field">К УРОКУ<input name="label" value="' + esc(h.lesson_label) + '"></label>' +
          '<label class="field" style="flex-basis:160px">СРОК<input name="due" type="date" value="' + esc(h.due_date || '') + '"></label></div>' +
          '<label class="field full">ОПИСАНИЕ<textarea name="desc" rows="4">' + esc(h.description) + '</textarea></label>' +
          (tf.length ? '<div class="files">' + tf.map(function (f) {
            return '<span class="file" style="cursor:default">' + extTag(f.name) + '<span>' + esc(f.name) + '</span><button type="button" class="iconbtn" style="width:28px;height:28px" aria-label="Удалить файл ' + esc(f.name) + '" data-act="hwfile-del" data-id="' + esc(f.id) + '" data-path="' + esc(f.path) + '">' + XICON + '</button></span>';
          }).join('') + '</div>' : '') +
          '<label class="drop">' + UPLOAD + '<span>ДОБАВИТЬ ФАЙЛЫ</span><small data-files>Фото, PDF, DOCX · до 20 МБ</small><input type="file" name="files" multiple accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,audio/*" data-change="show-files"></label>' +
          '<p class="err" hidden></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit">Сохранить</button><button type="button" class="btn outline" data-act="hw-edit" data-id="">Отмена</button></div></form></article>';
      }
      var badge = h.status === 'todo' ? '<span class="badge b-todo">ОСТАЛОСЬ</span>' : h.status === 'done' ? '<span class="badge b-done">ЖДЁТ ПРОВЕРКИ</span>' : '<span class="badge b-checked">ПРОВЕРЕНО</span>';
      var side = '<span class="label">' + (h.status === 'todo' ? esc(dueText(h.due_date)) : h.status === 'done' ? 'СДАНО' + (h.done_at ? ': ' + dayMonth(new Date(h.done_at)).toUpperCase() : '') : 'ПРОВЕРЕНО' + (h.checked_at ? ': ' + dayMonth(new Date(h.checked_at)).toUpperCase() : '')) + '</span>';
      if (!t && h.status === 'todo') {
        side += '<label class="drop" style="padding:14px">ПРИКРЕПИТЬ ОТВЕТ<small>фото, PDF или DOCX</small><input type="file" multiple accept="image/*,.pdf,.doc,.docx,audio/*,.txt" data-change="answer-upload" data-id="' + esc(h.id) + '"></label>' +
          '<button type="button" class="btn" data-act="hw-status" data-id="' + esc(h.id) + '" data-status="done">✓ ОТМЕТИТЬ СДЕЛАННЫМ</button>';
      }
      if (!t && h.status === 'done') {
        side += '<span class="muted" style="font-size:13px">Учитель увидит работу у себя</span><button type="button" class="btn outline" data-act="hw-status" data-id="' + esc(h.id) + '" data-status="todo">ВЕРНУТЬ В ОСТАВШИЕСЯ</button>';
      }
      if (t && h.status !== 'todo') {
        side += '<form class="form" data-form="hw-check" data-id="' + esc(h.id) + '" style="gap:10px"><label class="field full">КОММЕНТАРИЙ<textarea name="comment" rows="3">' + esc(h.teacher_comment) + '</textarea></label>' +
          '<label class="field full">ОЦЕНКА<input name="grade" value="' + esc(h.grade) + '" placeholder="отлично!"></label>' +
          '<button class="btn pink" type="submit">' + (h.status === 'checked' ? 'ОБНОВИТЬ КОММЕНТАРИЙ' : 'ОТМЕТИТЬ ПРОВЕРЕННЫМ') + '</button></form>';
      }
      if (t) side += '<div style="display:flex;gap:16px;flex-wrap:wrap"><button type="button" class="linkbtn" data-act="hw-edit" data-id="' + esc(h.id) + '">редактировать</button><button type="button" class="linkbtn" data-act="hw-del" data-id="' + esc(h.id) + '">удалить задание</button></div>';
      return '<article class="card hw"><div class="hw-main"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' + (h.lesson_label ? '<span class="label">//' + esc(h.lesson_label).toUpperCase() + '</span>' : '') + badge + '</div>' +
        '<h2 class="h3">' + esc(h.title) + '</h2>' + (h.description ? '<p class="desc">' + esc(h.description) + '</p>' : '') +
        (tf.length ? '<div class="files">' + tf.map(function (f) { return fileChip(f); }).join('') + '</div>' : '') +
        (af.length ? '<div class="files" style="align-items:center"><span class="label">ОТВЕТ:</span>' + af.map(function (f) { return fileChip(f, 'answer'); }).join('') + '</div>' : '') +
        (h.status === 'checked' && (h.teacher_comment || h.grade) ? '<div class="comment">' + (h.grade ? '<span class="script">' + esc(h.grade) + '</span>' : '') + (h.teacher_comment ? '<p>' + esc(h.teacher_comment) + '</p>' : '') + '</div>' : '') +
        '</div><div class="hw-side">' + side + '</div></article>';
    }).join('');

    return pageHead('домашка', 'Home<em>work</em>', '<div><span class="pk">— осталось:</span> ' + todo.length + '</div><div><span class="pk">— сделано:</span> ' + done.length + '</div>') +
      form +
      '<div class="pills tabs"><button type="button" class="pill' + (ui.hwTab === 'todo' ? ' on' : '') + '" data-act="hw-tab" data-tab="todo">ОСТАЛОСЬ · ' + todo.length + '</button><button type="button" class="pill' + (ui.hwTab === 'done' ? ' on' : '') + '" data-act="hw-tab" data-tab="done">СДЕЛАНО · ' + done.length + '</button></div>' +
      '<div class="col" style="gap:18px">' + (cards || '<p class="empty">' + (ui.hwTab === 'todo' ? 'всё сделано!' : 'пока пусто') + '</p>') + '</div>';
  }

  // ---------------------------------------------------------------- VOCABULARY
  async function pageVocab() {
    var st = sid(), t = isT();
    var v = await loadVocab(st);
    var ffAll = v.folders.length ? await q(sb.from('folder_files').select('*').in('folder_id', v.folders.map(function (f) { return f.id; })).order('created_at')) : [];
    var topics = v.folders.filter(function (f) { return f.owner_id === S.teacherId; });
    var mine = v.folders.filter(function (f) { return f.owner_id !== S.teacherId; });
    if (!v.folders.some(function (f) { return f.id === ui.folderId; })) ui.folderId = v.folders[0] ? v.folders[0].id : null;
    var folder = v.folders.filter(function (f) { return f.id === ui.folderId; })[0];
    var counts = {}; v.words.forEach(function (w) { counts[w.folder_id] = (counts[w.folder_id] || 0) + 1; });
    ffAll.forEach(function (x) { counts[x.folder_id] = (counts[x.folder_id] || 0) + 1; });
    function fbtn(f) {
      var hasNew = t && v.words.some(function (w) { return w.folder_id === f.id && isFresh(w); });
      return '<button type="button" class="folder' + (f.id === ui.folderId ? ' on' : '') + '" data-act="folder" data-id="' + esc(f.id) + '"><span>' + esc(f.name) + (hasNew ? '<span class="dot" aria-label="есть новые слова"></span>' : '') + '</span><span style="font-size:12px;font-weight:800">' + (counts[f.id] || 0) + '</span></button>';
    }
    var freshTotal = t ? v.words.filter(function (w) { return w.added_by === st && isFresh(w); }).length : 0;
    var firstFreshFolder = t ? (v.words.filter(function (w) { return w.added_by === st && isFresh(w); })[0] || {}).folder_id : null;

    var main;
    if (!folder) {
      main = '<p class="hint">' + (t ? 'Создайте первый топик слева — например, «Travel plans».' : 'Пока нет ни одной папки. Слова от учителя появятся здесь, а свою папку можно создать слева.') + '</p>';
    } else {
      var own = folder.owner_id === S.me.id;
      var isTopic = folder.owner_id === S.teacherId;
      var words = v.words.filter(function (w) { return w.folder_id === folder.id; });
      var STAT = { 'new': ['НОВОЕ', 'b-new'], learning: ['УЧУ', 'b-learning'], learned: ['ЗНАЮ', 'b-learned'] };
      main = '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px"><div class="col" style="gap:6px"><span class="badge ' + (isTopic ? 'b-checked' : 'b-todo') + '" style="align-self:flex-start">' + (isTopic ? 'ТОПИК УЧИТЕЛЯ' : (t ? 'ПАПКА УЧЕНИЦЫ' : 'МОЯ ПАПКА')) + '</span><h2 class="h2" style="font-size:34px">' + esc(folder.name) + '</h2></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><label><span class="sr">Найти слово</span><input class="input" type="search" placeholder="Найти слово" data-input="vsearch" style="min-height:42px;width:170px"></label>' +
        (words.length ? '<a class="btn" href="#/train?folder=' + encodeURIComponent(folder.id) + '">ТРЕНИРОВАТЬ ПАПКУ</a>' : '') +
        (own ? '<button type="button" class="linkbtn" data-act="folder-del" data-id="' + esc(folder.id) + '">удалить папку</button>' : '') + '</div></div>';
      if (own) {
        main += '<form class="card bluefill form" data-form="word-new" data-id="' + esc(folder.id) + '" style="padding:16px"><div class="fields">' +
          '<label class="field">ENGLISH<input name="en" required placeholder="to binge-watch" style="border-color:transparent"></label>' +
          '<label class="field">ПЕРЕВОД<input name="ru" placeholder="смотреть запоем" style="border-color:transparent"></label>' +
          '<label class="field wide">ПРИМЕР<input name="ex" placeholder="Необязательно" style="border-color:transparent"></label>' +
          '<button class="btn" type="submit">+ ДОБАВИТЬ</button></div><p class="err" hidden></p></form>';
      } else {
        main += '<p class="hint">' + (t ? 'Это папка ученицы — вы видите её слова, а добавляет их она. Новые за неделю отмечены розовым.' : 'Слова в топики добавляет учитель. Своё слово можно добавить в «Мои папки».') + '</p>';
      }
      var ff = ffAll.filter(function (x) { return x.folder_id === folder.id; });
      if (ff.length || own) {
        main += '<section class="card col" style="gap:12px;padding:18px"><span class="label">Файлы и ссылки</span>' +
          (ff.length ? '<div class="files">' + ff.map(function (x) {
            var chip = x.file_path
              ? '<button type="button" class="file" data-act="open-file" data-path="' + esc(x.file_path) + '">' + extTag(x.file_name) + '<span>' + esc(x.title) + '</span></button>'
              : '<a class="file" href="' + esc(safeUrl(x.url)) + '" target="_blank" rel="noopener" style="text-decoration:none"><span class="ext">ССЫЛКА</span><span>' + esc(x.title) + '</span></a>';
            return '<span style="display:inline-flex;align-items:center;gap:2px">' + chip + ((own || t) ? '<button type="button" class="iconbtn" style="width:30px;height:30px" aria-label="Удалить ' + esc(x.title) + '" data-act="ff-del" data-id="' + esc(x.id) + '" data-path="' + esc(x.file_path) + '">' + XICON + '</button>' : '') + '</span>';
          }).join('') + '</div>' : '<span class="muted" style="font-size:13px">Сюда можно положить список слов файлом (PDF, DOCX, фото) или ссылкой.</span>') +
          (own ? '<form class="form" data-form="ff-new" data-id="' + esc(folder.id) + '" style="gap:10px"><div class="fields">' +
            '<label class="field wide">НАЗВАНИЕ<input name="title" required placeholder="Например: слова урока 5"></label>' +
            '<label class="field wide">ССЫЛКА<input name="url" type="url" placeholder="https://"></label>' +
            '<label class="drop" style="flex:1 1 200px;padding:12px">ИЛИ ФАЙЛ<small data-files>PDF, DOCX, фото · до 20 МБ</small><input type="file" name="file" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,audio/*" data-change="show-files"></label>' +
            '<button class="btn" type="submit">+ Добавить</button></div><p class="err" hidden></p></form>' : '') +
          '</section>';
      }
      main += '<div class="grid" data-words>' + (words.map(function (w) {
        var p = v.pm.get(w.id), s = STAT[p ? p.status : 'new'];
        var fr = t && isFresh(w);
        if (own && ui.wordEdit === w.id) {
          return '<form class="word form" data-form="word-save" data-id="' + esc(w.id) + '" style="gap:8px">' +
            '<label class="field full">ENGLISH<input name="en" required value="' + esc(w.en) + '"></label>' +
            '<label class="field full">ПЕРЕВОД<input name="ru" value="' + esc(w.ru) + '"></label>' +
            '<label class="field full">ПРИМЕР<input name="ex" value="' + esc(w.example) + '"></label>' +
            '<p class="err" hidden></p><div style="display:flex;gap:8px"><button class="btn sm" type="submit">Сохранить</button><button type="button" class="btn sm outline" data-act="word-edit" data-id="">Отмена</button></div></form>';
        }
        return '<div class="word' + (fr ? ' fresh' : '') + '" data-text="' + esc((w.en + ' ' + w.ru).toLowerCase()) + '"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><span class="en">' + esc(w.en) + '</span><span style="display:flex;gap:4px"><button type="button" class="iconbtn" aria-label="Послушать" data-act="say" data-text="' + esc(w.en) + '">' + SPEAK + '</button>' +
          (own ? '<button type="button" class="iconbtn" aria-label="Редактировать слово" data-act="word-edit" data-id="' + esc(w.id) + '">' + PENCIL + '</button><button type="button" class="iconbtn" aria-label="Удалить слово" data-act="word-del" data-id="' + esc(w.id) + '">' + XICON + '</button>' : '') + '</span></div>' +
          '<span class="ru">' + esc(w.ru) + '</span>' + (w.example ? '<span class="ex">' + esc(w.example) + '</span>' : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' + (st ? '<span class="badge ' + s[1] + '">' + s[0] + '</span>' : '') + (fr ? '<span class="badge b-fresh">НОВОЕ ОТ УЧЕНИЦЫ</span>' : '') + '</div></div>';
      }).join('') || '<p class="muted">В папке пока нет слов.</p>') + '</div>';
    }

    return pageHead('слова', 'Vocab<em>ulary</em>', '<div><span class="pk">— топики:</span> добавляет учитель</div><div><span class="pk">— мои папки:</span> добавляет ученица,<br>учитель тоже их видит</div>') +
      (freshTotal ? '<div class="notice"><span>УЧЕНИЦА ДОБАВИЛА ' + freshTotal + ' ' + plural(freshTotal, 'НОВОЕ СЛОВО', 'НОВЫХ СЛОВА', 'НОВЫХ СЛОВ') + ' ЗА НЕДЕЛЮ</span><button type="button" class="btn sm" data-act="folder" data-id="' + esc(firstFreshFolder) + '">ПОСМОТРЕТЬ</button></div>' : '') +
      '<div class="vocab"><aside><div class="col" style="gap:8px"><span class="label">ТОПИКИ ОТ УЧИТЕЛЯ</span>' + (topics.map(fbtn).join('') || '<span class="muted" style="font-size:13px">пока нет</span>') + '</div>' +
      ((!t || st) ? '<div class="col" style="gap:8px"><span class="label">' + (t ? 'ПАПКИ УЧЕНИЦЫ (ВИДНЫ ВАМ)' : 'МОИ ПАПКИ') + '</span>' + (mine.map(fbtn).join('') || '<span class="muted" style="font-size:13px">пока нет</span>') + '</div>' : '') +
      '<form class="form" data-form="folder-new" style="gap:8px;border-top:1.5px dashed var(--blue);padding-top:16px"><label class="field full">' + (t ? 'НОВЫЙ ТОПИК' : 'НОВАЯ ПАПКА') + '<input name="name" required placeholder="' + (t ? 'Например: Phrasal verbs' : 'Например: Сериалы') + '"></label><button class="btn outline" type="submit">+ СОЗДАТЬ ПАПКУ</button></form></aside>' +
      '<main>' + main + '</main></div>';
  }

  // ---------------------------------------------------------------- TRAIN
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  async function pageTrain(r) {
    var v = await loadVocab(S.me.id);
    var folderId = r.params.get('folder');
    var folder = folderId ? v.folders.filter(function (f) { return f.id === folderId; })[0] : null;
    var list;
    if (folder) {
      list = v.words.filter(function (w) { return w.folder_id === folder.id; });
      list = shuffle(list).sort(function (a, b) { return (isDue(b, v.pm) ? 1 : 0) - (isDue(a, v.pm) ? 1 : 0); }).slice(0, 40);
    } else {
      var due = v.words.filter(function (w) { return v.pm.has(w.id) && isDue(w, v.pm); });
      var fresh = v.words.filter(function (w) { return !v.pm.has(w.id); });
      list = shuffle(due).slice(0, 25).concat(shuffle(fresh).slice(0, 10));
    }
    ui.train = { words: list, i: 0, flipped: false, again: 0, hard: 0, good: 0, pm: v.pm, title: folder ? folder.name : 'Повторение на сегодня', requeued: {} };
    return '<div class="train" id="train">' + trainInner() + '</div>';
  }
  function trainInner() {
    var tr = ui.train, total = tr.words.length;
    var head = '<div style="display:flex;align-items:center;gap:12px"><a href="#/vocabulary" class="iconbtn" aria-label="Закрыть тренировку" style="width:44px;height:44px;background:var(--white)">' + XICON + '</a>' +
      '<div class="bar" style="flex:1"><div style="width:' + (total ? Math.round(Math.min(tr.i, total) / total * 100) : 100) + '%"></div></div><span class="label">' + Math.min(tr.i, total) + ' / ' + total + '</span></div>' +
      '<h1 class="h2" style="text-align:center">' + esc(tr.title) + '</h1>';
    if (!total) return head + '<div class="card center"><span class="script" style="font-size:48px">all done!</span><p class="muted">На сегодня повторять нечего. Загляни завтра или потренируй любую папку.</p><a class="btn" href="#/vocabulary">К СЛОВАМ</a></div>';
    if (tr.i >= total) {
      return head + '<div class="card center"><span class="script" style="font-size:56px">well done!</span><p class="lead">Помню: ' + tr.good + ' · Сложно: ' + tr.hard + ' · Не помню: ' + tr.again + '</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/home">НА ГЛАВНУЮ</a><a class="btn outline" href="#/vocabulary">К СЛОВАМ</a></div></div>';
    }
    var w = tr.words[tr.i];
    return head + '<button type="button" class="flash" data-act="flip" aria-label="Перевернуть карточку">' +
      '<span class="en">' + esc(w.en) + '</span>' +
      (tr.flipped ? '<span class="ru">' + esc(w.ru) + '</span>' + (w.example ? '<span class="ex">' + esc(w.example) + '</span>' : '') : '<span class="muted" style="font-size:13px">нажми или пробел — показать перевод</span>') +
      '</button>' +
      '<div style="display:flex;justify-content:center"><button type="button" class="btn outline sm" data-act="say" data-text="' + esc(w.en) + '">' + SPEAK + ' ПОСЛУШАТЬ</button></div>' +
      (tr.flipped
        ? '<div class="answers"><button type="button" class="a-again" data-act="answer" data-r="again">Не помню<small>клавиша 1</small></button><button type="button" class="a-hard" data-act="answer" data-r="hard">Сложно<small>клавиша 2</small></button><button type="button" class="a-good" data-act="answer" data-r="good">Помню<small>клавиша 3</small></button></div>'
        : '<button type="button" class="btn block" data-act="flip" style="min-height:60px">ПОКАЗАТЬ ПЕРЕВОД</button>');
  }
  function redrawTrain() { var el = document.getElementById('train'); if (el) el.innerHTML = trainInner(); }
  var IV = [1, 3, 7, 16, 35, 60];
  function nextProgress(p, r) {
    var now = Date.now(), streak = p ? p.streak : 0, status, due;
    if (r === 'again') { streak = 0; status = 'learning'; due = now + 10 * 60e3; }
    else if (r === 'hard') { status = p && p.status === 'learned' ? 'learned' : 'learning'; due = now + 864e5; }
    else { streak += 1; due = now + IV[Math.min(streak - 1, IV.length - 1)] * 864e5; status = streak >= 3 ? 'learned' : 'learning'; }
    return {
      user_id: S.me.id, status: status, streak: streak, due_at: new Date(due).toISOString(),
      learned_at: status === 'learned' ? ((p && p.learned_at) || new Date().toISOString()) : null,
      updated_at: new Date().toISOString()
    };
  }
  var answering = false;
  async function answer(r) {
    var tr = ui.train; if (!tr || answering || !tr.flipped || tr.i >= tr.words.length) return;
    answering = true;
    var w = tr.words[tr.i];
    var np = nextProgress(tr.pm.get(w.id), r); np.word_id = w.id;
    tr.pm.set(w.id, np);
    tr[r] += 1;
    if (r === 'again' && !tr.requeued[w.id]) { tr.requeued[w.id] = true; tr.words.push(w); }
    tr.i += 1; tr.flipped = false;
    redrawTrain();
    try {
      await q(sb.from('word_progress').upsert(np, { onConflict: 'user_id,word_id' }));
      await q(sb.from('review_log').insert({ user_id: S.me.id, word_id: w.id, result: r }));
    } catch (e) { /* toast already shown */ }
    answering = false;
  }
  document.addEventListener('keydown', function (e) {
    if (route().path !== 'train' || !ui.train) return;
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ui.train.flipped = !ui.train.flipped; redrawTrain(); }
    if (ui.train.flipped && (e.key === '1' || e.key === '2' || e.key === '3')) answer(['again', 'hard', 'good'][+e.key - 1]);
  });

  // ---------------------------------------------------------------- MATERIALS
  function isVideo(u) { return /youtu\.?be|rutube|vk\.com\/video|vkvideo|vimeo/i.test(u || ''); }
  async function pageMaterials() {
    var st = sid(), t = isT();
    var mats = await q(sb.from('materials').select('*').order('created_at'));
    if (t) mats = mats.filter(function (m) { return m.added_by === S.teacherId || m.added_by === st; });
    var groups = [];
    mats.forEach(function (m) { if (groups.indexOf(m.group_name) < 0) groups.push(m.group_name); });
    if (ui.matFilter !== 'all' && ui.matFilter !== 'student' && groups.indexOf(ui.matFilter) < 0) ui.matFilter = 'all';
    var shown = mats.filter(function (m) {
      if (ui.matFilter === 'all') return true;
      if (ui.matFilter === 'student') return m.added_by !== S.teacherId;
      return m.group_name === ui.matFilter;
    });
    var filters = [['all', 'ВСЕ']].concat(groups.map(function (g) { return [g, g.toUpperCase()]; }));
    if (mats.some(function (m) { return m.added_by !== S.teacherId; })) filters.push(['student', t ? 'ДОБАВЛЕНО УЧЕНИЦЕЙ' : 'ДОБАВЛЕНО МНОЙ']);

    var addPanel = '';
    if (ui.matAdd) {
      addPanel = '<section class="paper bluep"><form class="form" data-form="mat-new"><h2 class="display s">Новый <em>материал</em></h2>' +
        '<div class="fields"><label class="field wide">НАЗВАНИЕ<input name="title" required placeholder="Например: подкаст про путешествия"></label>' +
        '<label class="field">ГРУППА<select name="group">' + groups.map(function (g) { return '<option>' + esc(g) + '</option>'; }).join('') + '<option value="">— новая группа —</option></select></label>' +
        '<label class="field">ИЛИ НОВАЯ ГРУППА<input name="newgroup" placeholder="Название группы"></label></div>' +
        '<label class="field full">КОММЕНТАРИЙ<input name="note" placeholder="Например: послушать до урока 6"></label>' +
        '<div class="fields"><label class="field wide">ССЫЛКА<input name="url" type="url" placeholder="https://"></label>' +
        '<label class="drop" style="flex:1 1 260px">ИЛИ ФАЙЛ<small data-files>PDF, DOCX, фото, аудио · до 20 МБ</small><input type="file" name="file" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,audio/*" data-change="show-files"></label></div>' +
        '<p class="err" hidden></p><button class="btn" type="submit" style="align-self:flex-start">ДОБАВИТЬ</button></form></section>';
    }

    var showGroups = groups.filter(function (g) { return shown.some(function (m) { return m.group_name === g; }); });
    var body = showGroups.map(function (g) {
      var its = shown.filter(function (m) { return m.group_name === g; });
      return '<section class="col" style="gap:16px"><div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap"><h2 class="display s"><em>' + esc(g) + '</em></h2><span class="label">//' + its.length + ' ' + plural(its.length, 'МАТЕРИАЛ', 'МАТЕРИАЛА', 'МАТЕРИАЛОВ') + '</span></div><div class="grid">' +
        its.map(function (m) {
          var fromStudent = m.added_by !== S.teacherId;
          var type = m.file_path ? extTag(m.file_name) : '<span class="ext' + (isVideo(m.url) ? ' doc' : '') + '">' + (isVideo(m.url) ? 'ВИДЕО' : 'ССЫЛКА') + '</span>';
          var open = m.file_path
            ? '<button type="button" class="btn sm outline" data-act="open-file" data-path="' + esc(m.file_path) + '">ОТКРЫТЬ ФАЙЛ</button>'
            : '<a class="btn sm outline" href="' + esc(safeUrl(m.url)) + '" target="_blank" rel="noopener">ОТКРЫТЬ</a>';
          var canDel = t || m.added_by === S.me.id;
          if (canDel && ui.matEdit === m.id) {
            return '<form class="card form" data-form="mat-save" data-id="' + esc(m.id) + '" style="padding:18px;gap:10px">' +
              '<label class="field full">НАЗВАНИЕ<input name="title" required value="' + esc(m.title) + '"></label>' +
              '<label class="field full">ГРУППА<input name="group" required list="mat-groups" value="' + esc(m.group_name) + '"></label>' +
              '<label class="field full">КОММЕНТАРИЙ<input name="note" value="' + esc(m.note) + '"></label>' +
              (m.file_path ? '<label class="drop" style="padding:12px">ЗАМЕНИТЬ ФАЙЛ<small data-files>сейчас: ' + esc(m.file_name) + '</small><input type="file" name="file" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,audio/*" data-change="show-files"></label>'
                : '<label class="field full">ССЫЛКА<input name="url" type="url" value="' + esc(m.url) + '"></label>') +
              '<p class="err" hidden></p><div style="display:flex;gap:8px"><button class="btn sm" type="submit">Сохранить</button><button type="button" class="btn sm outline" data-act="mat-edit" data-id="">Отмена</button></div></form>';
          }
          return '<div class="card' + (fromStudent ? ' pinkfill' : '') + '" style="padding:18px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' + type +
            '<span class="label" style="font-size:10px;color:' + (fromStudent ? 'var(--pink-text)' : 'var(--blue)') + '">' + (fromStudent ? 'ОТ УЧЕНИЦЫ' : 'ОТ УЧИТЕЛЯ') + '</span></div>' +
            '<b style="font-size:16px;color:var(--ink);line-height:1.3">' + esc(m.title) + '</b>' + (m.note ? '<span class="muted" style="font-size:13px;line-height:1.45">' + esc(m.note) + '</span>' : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:auto;padding-top:6px">' + open + (canDel ? '<span style="display:flex;gap:12px"><button type="button" class="linkbtn" data-act="mat-edit" data-id="' + esc(m.id) + '">изменить</button><button type="button" class="linkbtn" data-act="mat-del" data-id="' + esc(m.id) + '">удалить</button></span>' : '') + '</div></div>';
        }).join('') + '</div></section>';
    }).join('');

    return pageHead('полезные материалы', 'Mate<em>rials</em>', '<button type="button" class="btn" data-act="mat-toggle">' + (ui.matAdd ? 'Закрыть' : '+ Добавить материал') + '</button>') + addPanel +
      (groups.length ? '<div class="pills">' + filters.map(function (f) { return '<button type="button" class="pill' + (ui.matFilter === f[0] ? ' on' : '') + '" data-act="mat-filter" data-f="' + esc(f[0]) + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>' : '') +
      (body || '<p class="hint">Материалов пока нет — добавьте первый кнопкой выше.</p>') +
      '<datalist id="mat-groups">' + groups.map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join('') + '</datalist>';
  }

  // ---------------------------------------------------------------- PROGRESS
  var DEFAULT_SKILLS = { 'Словарный запас': 5, 'Говорение': 5, 'Грамматика': 5, 'Аудирование': 5 };
  async function pageProgress() {
    var st = sid(), t = isT();
    if (!st) return noStudent();
    var since = new Date(Date.now() - 400 * 864e5).toISOString();
    var res = await Promise.all([
      q(sb.from('lessons').select('*').eq('student_id', st).order('starts_at')),
      q(sb.from('homework').select('status').eq('student_id', st)),
      q(sb.from('student_notes').select('*').eq('student_id', st).maybeSingle()),
      q(sb.from('review_log').select('created_at').eq('user_id', st).gte('created_at', since).order('created_at', { ascending: false }).limit(5000)),
      loadVocab(st),
      loadGoals(st)
    ]);
    var lessons = res[0], hw = res[1], notes = res[2], logs = res[3], v = res[4], goals = res[5];
    ui.notes = { student_id: st, skills: (notes && notes.skills) || Object.assign({}, DEFAULT_SKILLS), note: (notes && notes.note) || '' };
    var now = new Date();
    var learnedList = []; v.pm.forEach(function (p) { if (p.status === 'learned' && p.learned_at) learnedList.push(new Date(p.learned_at)); });
    var learned = learnedList.length;
    var weekAgo = Date.now() - 7 * 864e5;
    var learnedWeek = learnedList.filter(function (d) { return d.getTime() > weekAgo; }).length;
    var hwChecked = hw.filter(function (h) { return h.status === 'checked'; }).length;
    var hwDone = hw.filter(function (h) { return h.status === 'done'; }).length;
    var hwTodo = hw.filter(function (h) { return h.status === 'todo'; }).length;
    var pastLessons = lessons.filter(function (l) { return new Date(l.starts_at) <= now; }).length;
    var nextL = lessons.filter(function (l) { return new Date(l.starts_at) > now; })[0];
    var days = {}; logs.forEach(function (l) { days[dayKey(new Date(l.created_at))] = true; });
    var streak = 0, d = new Date(); if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (days[dayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }

    var bars = [];
    if (ui.period === 'weeks') {
      for (var k = 5; k >= 0; k--) {
        var end = new Date(); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() - k * 7);
        bars.push([k === 0 ? 'сейчас' : end.getDate() + ' ' + MON_SHORT[end.getMonth()], learnedList.filter(function (x) { return x <= end; }).length]);
      }
    } else {
      for (var m = 3; m >= 0; m--) {
        var me = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59);
        bars.push([MON_SHORT[me.getMonth()], learnedList.filter(function (x) { return x <= me; }).length]);
      }
    }
    var maxBar = Math.max(1, v.words.length, bars[bars.length - 1][1]);
    var chart = bars.map(function (b, i) { return '<div class="c' + (i === bars.length - 1 ? ' last' : '') + '"><b>' + b[1] + '</b><i style="height:' + Math.max(4, Math.round(b[1] / maxBar * 150)) + 'px"></i><small>' + b[0] + '</small></div>'; }).join('');

    var skills = Object.keys(ui.notes.skills).map(function (name) {
      var val = ui.notes.skills[name];
      return '<div class="skill"><div class="skill-top"><span>' + esc(name) + '</span><span class="stepper">' +
        (t ? '<button type="button" aria-label="Понизить" data-act="skill" data-name="' + esc(name) + '" data-d="-1">−</button>' : '') +
        '<span style="min-width:44px;text-align:center;font-size:13px;font-weight:800">' + val + '/10</span>' +
        (t ? '<button type="button" aria-label="Повысить" data-act="skill" data-name="' + esc(name) + '" data-d="1">+</button>' : '') +
        '</span></div><div class="bar"><div style="width:' + val * 10 + '%"></div></div></div>';
    }).join('');
    var hwTotal = Math.max(1, hw.length);
    var goalCards = goals.map(function (g) {
      var gs = goalStats(g, v);
      var mineG = g.set_by === S.me.id;
      var canDel = t || mineG;
      return '<div class="index-card" style="border-top-color:' + (gs.done ? '#7FB08A' : 'var(--sky2)') + '"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><span class="h3" style="font-size:21px">' + esc(goalTitle(g, gs)) + '</span>' +
        (canDel ? '<button type="button" class="iconbtn" aria-label="Удалить цель" data-act="goal-del" data-id="' + esc(g.id) + '">' + XICON + '</button>' : '') + '</div>' +
        '<div class="bar"><div style="width:' + gs.pct + '%"></div></div>' +
        '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:600"><span>выучено ' + gs.learned + ' из ' + gs.target + (gs.done ? ' — цель достигнута!' : '') + '</span><span class="muted">' + (g.set_by === S.teacherId ? 'цель от учителя' : 'своя цель') + '</span></div>' +
        (!gs.done && gs.due ? '<a class="btn sm outline" href="#/train' + (g.folder_id ? '?folder=' + encodeURIComponent(g.folder_id) : '') + '" style="align-self:flex-start">Повторить сегодня: ' + gs.due + '</a>' : '') + '</div>';
    }).join('');
    var goalForm = '<form class="index-card form" data-form="goal-new" style="gap:10px;border-top-color:var(--ink)"><span class="label">Новая цель' + (t ? ' для ' + esc(studentName(st)) : '') + '</span>' +
      '<div class="fields"><label class="field" style="flex-basis:90px">СЛОВ<input name="target" type="number" min="1" max="10000" required value="20"></label>' +
      '<label class="field" style="flex-basis:140px">ДО<input name="due" type="date"></label></div>' +
      '<label class="field full">ИЗ ПАПКИ<select name="folder"><option value="">все папки</option>' + v.folders.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; }).join('') + '</select></label>' +
      '<p class="err" hidden></p><button class="btn sm" type="submit">Поставить цель</button></form>';
    var goalsSection = '<section class="col" style="gap:16px"><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px"><h2 class="display s">Цели <em>по словам</em></h2><span class="label">' + (t ? '//ставите вы или ученица' : '//ставит учитель или ты сама') + '</span></div>' +
      (goals.length ? '' : '<p class="muted" style="margin:0">Счётчик выученных слов появится, когда будет поставлена цель.</p>') +
      '<div class="class-grid">' + goalCards + goalForm + '</div></section>';
    var noteBlock = t
      ? '<form class="form" data-form="note" style="gap:10px"><label class="field full">КОММЕНТАРИЙ ДЛЯ УЧЕНИЦЫ<textarea name="note" rows="4" style="border-color:transparent">' + esc(ui.notes.note) + '</textarea></label><button class="btn" type="submit" style="align-self:flex-start">СОХРАНИТЬ</button></form>'
      : '<p style="margin:0;font-size:16px;font-weight:600;line-height:1.55;color:var(--ink);white-space:pre-line">' + (ui.notes.note ? esc(ui.notes.note) : 'Учитель пока не оставил комментарий.') + '</p>';

    return pageHead('прогресс', 'Pro<em>gress</em>', '<div style="font-family:var(--display);font-style:italic;font-size:24px">you are here</div>') +
      '<div class="stats">' +
      (goals.length ? (function () { var gs = goalStats(goals[0], v); return '<div class="stat"><b>' + gs.learned + '/' + gs.target + '</b><span class="label">ЦЕЛЬ ПО СЛОВАМ</span><span class="muted" style="font-size:13px">' + esc(goalTitle(goals[0], gs).toLowerCase()) + '</span></div>'; })()
        : '<div class="stat"><b>' + v.words.length + '</b><span class="label">' + plural(v.words.length, 'СЛОВО', 'СЛОВА', 'СЛОВ') + ' В СЛОВАРЕ</span><span class="muted" style="font-size:13px">' + v.folders.length + ' ' + plural(v.folders.length, 'папка', 'папки', 'папок') + '</span></div>') +
      '<div class="stat"><b>' + (hwChecked + hwDone) + '/' + hw.length + '</b><span class="label">ДОМАШЕК СДАНО</span><span class="muted" style="font-size:13px">' + hwTodo + ' осталось, ' + hwDone + ' на проверке</span></div>' +
      '<div class="stat"><b>' + pastLessons + '</b><span class="label">' + plural(pastLessons, 'УРОК ПРОЙДЕН', 'УРОКА ПРОЙДЕНО', 'УРОКОВ ПРОЙДЕНО') + '</span><span class="muted" style="font-size:13px">' + (nextL ? 'следующий — ' + DAYS_SHORT[new Date(nextL.starts_at).getDay()] + ', ' + dayMonth(new Date(nextL.starts_at)) : 'следующий не назначен') + '</span></div>' +
      '<div class="stat pink"><b>' + streak + '</b><span class="label">' + plural(streak, 'ДЕНЬ ПОДРЯД', 'ДНЯ ПОДРЯД', 'ДНЕЙ ПОДРЯД') + '</span><span style="font-size:13px;font-weight:600">повторяешь слова</span></div></div>' +
      '<section class="paper bluep col" style="gap:20px"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline"><h2 class="display s">Маршрут <em>курса</em></h2><span class="label">//УРОКИ НАЗНАЧАЕТ УЧИТЕЛЬ</span></div>' + routeHtml(lessons) + '</section>' +
      goalsSection +
      '<div class="row" style="align-items:stretch">' + (goals.length ? '<section class="card col" style="flex:1 1 460px;gap:18px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><h2 class="label" style="font-size:16px;margin:0">ВЫУЧЕНО СЛОВ</h2><div class="pills" style="gap:6px"><button type="button" class="pill' + (ui.period === 'weeks' ? ' on' : '') + '" data-act="period" data-p="weeks" style="min-height:32px">НЕДЕЛИ</button><button type="button" class="pill' + (ui.period === 'months' ? ' on' : '') + '" data-act="period" data-p="months" style="min-height:32px">МЕСЯЦЫ</button></div></div><div class="chart">' + chart + '</div><span class="muted" style="font-size:12px">Слово считается выученным после трёх правильных ответов подряд в тренировке.</span></section>' : '') +
      '<section class="card col" style="flex:1 1 380px;gap:16px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;flex-wrap:wrap"><h2 class="label" style="font-size:16px;margin:0">НАВЫКИ</h2><span class="muted" style="font-size:12px">' + (t ? 'оцениваете вы, ученица видит' : 'оценка учителя') + '</span></div>' + skills + '</section></div>' +
      '<div class="row" style="align-items:stretch"><section class="card col" style="flex:1 1 380px;gap:14px"><h2 class="label" style="font-size:16px;margin:0">ДОМАШКА</h2><div class="stack"><div style="width:' + hwChecked / hwTotal * 100 + '%;background:var(--blue)"></div><div style="width:' + hwDone / hwTotal * 100 + '%;background:#9DBBE3"></div><div style="width:' + hwTodo / hwTotal * 100 + '%;background:var(--pink)"></div></div>' +
      '<div class="legend"><span><i style="background:var(--blue)"></i>проверено · ' + hwChecked + '</span><span><i style="background:#9DBBE3"></i>на проверке · ' + hwDone + '</span><span><i style="background:var(--pink)"></i>осталось · ' + hwTodo + '</span></div><a href="#/homework" class="label" style="margin-top:auto">ОТКРЫТЬ ДОМАШКУ →</a></section>' +
      '<section class="card pinkfill col" style="flex:1 1 460px"><span class="script" style="font-size:34px">note from teacher</span>' + noteBlock + '</section></div>';
  }
  async function saveNotes() {
    ui.notes.updated_at = new Date().toISOString();
    await q(sb.from('student_notes').upsert(ui.notes, { onConflict: 'student_id' }));
  }

  // ---------------------------------------------------------------- actions
  var A = {
    logout: async function () { await sb.auth.signOut(); S.session = null; S.me = null; go('login'); render(); },
    mode: function (el) { ui.loginMode = el.dataset.mode; render(); },
    forgot: async function () {
      var input = document.querySelector('form[data-form=login] input[name=email]');
      var email = input && input.value.trim();
      var form = document.querySelector('form[data-form=login]');
      if (!email) { showErr(form, 'Введите email в поле выше — пришлём ссылку для смены пароля.'); return; }
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (r.error) showErr(form, 'Не удалось отправить письмо: ' + r.error.message);
      else { showErr(form, ''); toast('Письмо со ссылкой отправлено на ' + email); }
    },
    'open-file': async function (el) {
      var w = window.open('', '_blank');
      var r = await sb.storage.from('files').createSignedUrl(el.dataset.path, 3600);
      if (r.error) { if (w) w.close(); toast('Не удалось открыть файл'); return; }
      if (w) { w.opener = null; w.location.href = r.data.signedUrl; } else location.href = r.data.signedUrl;
    },
    say: function (el) { say(el.dataset.text); },
    'invite-new': async function (el) {
      var code = newCode();
      await q(sb.from('invites').insert({ code: code, profile_id: el.dataset.id || null }));
      toast('Код создан: ' + code); refresh();
    },
    'student-del': async function (el) {
      if (!confirm('Удалить ученицу вместе с подготовленными для неё уроками и домашкой?')) return;
      await q(sb.from('profiles').delete().eq('id', el.dataset.id));
      if (S.studentId === el.dataset.id) S.studentId = null;
      toast('Удалено'); refresh();
    },
    'invite-copy': async function (el) {
      var link = location.origin + location.pathname + '#/login?invite=' + encodeURIComponent(el.dataset.code);
      try { await navigator.clipboard.writeText(link); toast('Ссылка-приглашение скопирована'); }
      catch (e) { window.prompt('Скопируйте ссылку:', link); }
    },
    'invite-del': async function (el) { await q(sb.from('invites').delete().eq('code', el.dataset.code)); refresh(); },
    'lesson-del': async function (el) { if (!confirm('Удалить этот урок?')) return; await q(sb.from('lessons').delete().eq('id', el.dataset.id)); refresh(); },
    'hw-edit': function (el) { ui.hwEdit = el.dataset.id || null; refresh(); },
    'hwfile-del': async function (el) {
      if (!confirm('Удалить этот файл из задания?')) return;
      if (el.dataset.path) await sb.storage.from('files').remove([el.dataset.path]);
      await q(sb.from('homework_files').delete().eq('id', el.dataset.id)); refresh();
    },
    'word-edit': function (el) { ui.wordEdit = el.dataset.id || null; refresh(); },
    'mat-edit': function (el) { ui.matEdit = el.dataset.id || null; refresh(); },
    'ff-del': async function (el) {
      if (!confirm('Удалить файл или ссылку из папки?')) return;
      if (el.dataset.path) await sb.storage.from('files').remove([el.dataset.path]);
      await q(sb.from('folder_files').delete().eq('id', el.dataset.id)); refresh();
    },
    'goal-del': async function (el) { if (!confirm('Удалить цель?')) return; await q(sb.from('word_goals').delete().eq('id', el.dataset.id)); refresh(); },
    'hw-tab': function (el) { ui.hwTab = el.dataset.tab; refresh(); },
    'hw-status': async function (el) {
      el.disabled = true;
      await q(sb.from('homework').update({ status: el.dataset.status }).eq('id', el.dataset.id));
      toast(el.dataset.status === 'done' ? 'Отмечено как сделанное' : 'Вернули в оставшиеся'); refresh();
    },
    'hw-del': async function (el) {
      if (!confirm('Удалить задание вместе с файлами?')) return;
      var files = await q(sb.from('homework_files').select('path').eq('homework_id', el.dataset.id));
      if (files.length) await sb.storage.from('files').remove(files.map(function (f) { return f.path; }));
      await q(sb.from('homework').delete().eq('id', el.dataset.id));
      toast('Задание удалено'); refresh();
    },
    folder: function (el) { ui.folderId = el.dataset.id; refresh(); },
    'folder-del': async function (el) { if (!confirm('Удалить папку вместе со всеми словами?')) return; await q(sb.from('folders').delete().eq('id', el.dataset.id)); ui.folderId = null; refresh(); },
    'word-del': async function (el) { await q(sb.from('words').delete().eq('id', el.dataset.id)); refresh(); },
    flip: function () { if (ui.train) { ui.train.flipped = !ui.train.flipped; redrawTrain(); } },
    answer: function (el) { answer(el.dataset.r); },
    'mat-toggle': function () { ui.matAdd = !ui.matAdd; refresh(); },
    'mat-filter': function (el) { ui.matFilter = el.dataset.f; refresh(); },
    'mat-del': async function (el) {
      if (!confirm('Удалить материал?')) return;
      var m = await q(sb.from('materials').select('file_path').eq('id', el.dataset.id).maybeSingle());
      if (m && m.file_path) await sb.storage.from('files').remove([m.file_path]);
      await q(sb.from('materials').delete().eq('id', el.dataset.id)); refresh();
    },
    period: function (el) { ui.period = el.dataset.p; refresh(); },
    skill: async function (el) {
      var n = el.dataset.name, val = Math.max(0, Math.min(10, (ui.notes.skills[n] || 0) + (+el.dataset.d)));
      ui.notes.skills[n] = val; await saveNotes(); refresh();
    }
  };

  var F = {
    login: async function (f, fd) {
      var r = await sb.auth.signInWithPassword({ email: String(fd.get('email')).trim(), password: String(fd.get('password')) });
      if (r.error) {
        var m = r.error.message || '';
        showErr(f, /invalid login/i.test(m) ? 'Неверный email или пароль' : /not confirmed/i.test(m) ? 'Подтвердите email по ссылке из письма' : m);
        return;
      }
      S.session = r.data.session; S.me = null;
      if (route().path === 'home') render(); else go('home');
    },
    register: async function (f, fd) {
      var name = String(fd.get('name') || '').trim(), email = String(fd.get('email') || '').trim(), pass = String(fd.get('password') || '');
      var code = String(fd.get('code') || '').trim().toUpperCase();
      if (!name || !email) { showErr(f, 'Заполните имя и email'); return; }
      if (pass.length < 8) { showErr(f, 'Пароль — минимум 8 символов'); return; }
      if (f.querySelector('[name=code]')) {
        var c = await sb.rpc('check_invite', { p_code: code });
        if (c.error || !c.data) { showErr(f, 'Код приглашения недействителен или уже использован'); return; }
      }
      var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { name: name, invite_code: code }, emailRedirectTo: location.origin + location.pathname } });
      if (r.error) {
        var m = r.error.message || '';
        showErr(f, /already registered|already exists/i.test(m) ? 'Этот email уже зарегистрирован — войдите' : /database error/i.test(m) ? 'Регистрация не прошла: проверьте код приглашения (а для учителя — email в настройках базы)' : m);
        return;
      }
      showErr(f, '');
      if (r.data.session) { S.session = r.data.session; S.me = null; history.replaceState(null, '', location.pathname + '#/home'); render(); }
      else showOk(f, 'Почти готово! Подтвердите email по ссылке из письма, затем войдите.');
    },
    reset: async function (f, fd) {
      var p = String(fd.get('password') || '');
      if (p.length < 8) { showErr(f, 'Минимум 8 символов'); return; }
      var r = await sb.auth.updateUser({ password: p });
      if (r.error) { showErr(f, r.error.message); return; }
      toast('Пароль обновлён'); go('home');
    },
    lesson: async function (f, fd) {
      var dt = new Date(fd.get('date') + 'T' + fd.get('time'));
      if (isNaN(dt.getTime())) { showErr(f, 'Проверьте дату и время'); return; }
      var link = String(fd.get('link') || '').trim();
      if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      await q(sb.from('lessons').insert({ student_id: sid(), starts_at: dt.toISOString(), topic: String(fd.get('topic') || '').trim(), call_link: link }));
      toast('Урок назначен'); refresh();
    },
    'hw-new': async function (f, fd) {
      var title = String(fd.get('title') || '').trim();
      if (!title) { showErr(f, 'Введите название задания'); return; }
      var files = Array.prototype.slice.call(f.querySelector('input[type=file]').files || []);
      var big = files.filter(function (x) { return x.size > MAX_FILE; })[0];
      if (big) { showErr(f, 'Файл «' + big.name + '» больше 20 МБ'); return; }
      var h = await q(sb.from('homework').insert({ student_id: sid(), title: title, lesson_label: String(fd.get('label') || '').trim(), description: String(fd.get('desc') || '').trim(), due_date: fd.get('due') || null }).select().single());
      for (var i = 0; i < files.length; i++) {
        var path = await upload(files[i], 'homework/' + h.id);
        await q(sb.from('homework_files').insert({ homework_id: h.id, kind: 'task', path: path, name: files[i].name, size: files[i].size }));
      }
      ui.hwTab = 'todo'; toast('Задание опубликовано'); refresh();
    },
    'hw-edit': async function (f, fd) {
      var title = String(fd.get('title') || '').trim();
      if (!title) { showErr(f, 'Введите название задания'); return; }
      var files = Array.prototype.slice.call(f.querySelector('input[type=file]').files || []);
      var big = files.filter(function (x) { return x.size > MAX_FILE; })[0];
      if (big) { showErr(f, 'Файл «' + big.name + '» больше 20 МБ'); return; }
      var id = f.dataset.id;
      await q(sb.from('homework').update({ title: title, lesson_label: String(fd.get('label') || '').trim(), description: String(fd.get('desc') || '').trim(), due_date: fd.get('due') || null }).eq('id', id));
      for (var i = 0; i < files.length; i++) {
        var path = await upload(files[i], 'homework/' + id);
        await q(sb.from('homework_files').insert({ homework_id: id, kind: 'task', path: path, name: files[i].name, size: files[i].size }));
      }
      ui.hwEdit = null; toast('Задание обновлено'); refresh();
    },
    'word-save': async function (f, fd) {
      var en = String(fd.get('en') || '').trim(); if (!en) { showErr(f, 'Введите слово'); return; }
      await q(sb.from('words').update({ en: en, ru: String(fd.get('ru') || '').trim(), example: String(fd.get('ex') || '').trim() }).eq('id', f.dataset.id));
      ui.wordEdit = null; refresh();
    },
    'mat-save': async function (f, fd) {
      var title = String(fd.get('title') || '').trim(), group = String(fd.get('group') || '').trim();
      if (!title || !group) { showErr(f, 'Заполните название и группу'); return; }
      var row = { title: title, group_name: group, note: String(fd.get('note') || '').trim() };
      if (fd.has('url')) { var url = String(fd.get('url') || '').trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url; if (!url) { showErr(f, 'Добавьте ссылку'); return; } row.url = url; }
      var fileInput = f.querySelector('input[type=file]'), file = fileInput && fileInput.files[0];
      if (file) {
        var old = await q(sb.from('materials').select('file_path').eq('id', f.dataset.id).maybeSingle());
        row.file_path = await upload(file, 'materials'); row.file_name = file.name;
        if (old && old.file_path) await sb.storage.from('files').remove([old.file_path]);
      }
      await q(sb.from('materials').update(row).eq('id', f.dataset.id));
      ui.matEdit = null; toast('Материал обновлён'); refresh();
    },
    'ff-new': async function (f, fd) {
      var title = String(fd.get('title') || '').trim();
      var url = String(fd.get('url') || '').trim();
      var file = f.querySelector('input[type=file]').files[0];
      if (!title) { showErr(f, 'Введите название'); return; }
      if (!url && !file) { showErr(f, 'Добавьте ссылку или файл'); return; }
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      var row = { folder_id: f.dataset.id, title: title, url: file ? '' : url, added_by: S.me.id };
      if (file) { row.file_path = await upload(file, 'folders/' + f.dataset.id); row.file_name = file.name; row.size = file.size; }
      await q(sb.from('folder_files').insert(row));
      toast('Добавлено в папку'); refresh();
    },
    'goal-new': async function (f, fd) {
      var n = parseInt(fd.get('target'), 10);
      if (!n || n < 1) { showErr(f, 'Укажите, сколько слов выучить'); return; }
      await q(sb.from('word_goals').insert({ student_id: sid(), target: n, folder_id: fd.get('folder') || null, due_date: fd.get('due') || null, set_by: S.me.id }));
      toast('Цель поставлена'); refresh();
    },
    'hw-check': async function (f, fd) {
      await q(sb.from('homework').update({ status: 'checked', teacher_comment: String(fd.get('comment') || '').trim(), grade: String(fd.get('grade') || '').trim(), checked_at: new Date().toISOString() }).eq('id', f.dataset.id));
      toast('Сохранено'); refresh();
    },
    'folder-new': async function (f, fd) {
      var name = String(fd.get('name') || '').trim(); if (!name) return;
      var row = await q(sb.from('folders').insert({ name: name, owner_id: S.me.id }).select().single());
      ui.folderId = row.id; refresh();
    },
    'word-new': async function (f, fd) {
      var en = String(fd.get('en') || '').trim(); if (!en) { showErr(f, 'Введите слово'); return; }
      await q(sb.from('words').insert({ folder_id: f.dataset.id, en: en, ru: String(fd.get('ru') || '').trim(), example: String(fd.get('ex') || '').trim(), added_by: S.me.id }));
      await refresh();
      var inp = document.querySelector('form[data-form=word-new] input[name=en]'); if (inp) inp.focus();
    },
    'mat-new': async function (f, fd) {
      var title = String(fd.get('title') || '').trim();
      var group = String(fd.get('newgroup') || '').trim() || String(fd.get('group') || '').trim();
      var url = String(fd.get('url') || '').trim();
      var file = f.querySelector('input[type=file]').files[0];
      if (!title) { showErr(f, 'Введите название'); return; }
      if (!group) { showErr(f, 'Выберите группу или впишите новую'); return; }
      if (!url && !file) { showErr(f, 'Добавьте ссылку или файл'); return; }
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      var row = { title: title, group_name: group, note: String(fd.get('note') || '').trim(), url: file ? '' : url, added_by: S.me.id };
      if (file) { row.file_path = await upload(file, 'materials'); row.file_name = file.name; }
      await q(sb.from('materials').insert(row));
      ui.matAdd = false; ui.matFilter = 'all'; toast('Материал добавлен'); refresh();
    },
    'student-new': async function (f, fd) {
      var name = String(fd.get('name') || '').trim(); if (!name) { showErr(f, 'Введите имя'); return; }
      var p = await q(sb.from('profiles').insert({ name: name, role: 'student', pending: true }).select().single());
      var code = newCode();
      await q(sb.from('invites').insert({ code: code, profile_id: p.id }));
      S.studentId = p.id; localStorage.setItem('studentId', p.id);
      toast(name + ' добавлена. Код приглашения: ' + code); refresh();
    },
    note: async function (f, fd) { ui.notes.note = String(fd.get('note') || ''); await saveNotes(); toast('Комментарий сохранён'); }
  };

  var C = {
    student: function (el) { S.studentId = el.value; localStorage.setItem('studentId', el.value); ui.folderId = null; refresh(); },
    'show-files': function (el) {
      var small = el.parentNode.querySelector('[data-files]');
      var names = Array.prototype.map.call(el.files || [], function (x) { return x.name; });
      if (small) small.textContent = names.length ? 'Выбрано: ' + names.join(', ') : 'Файлы не выбраны';
    },
    'answer-upload': async function (el) {
      var files = Array.prototype.slice.call(el.files || []); if (!files.length) return;
      var id = el.dataset.id; toast('Загружаем…');
      for (var i = 0; i < files.length; i++) {
        var path = await upload(files[i], 'answers/' + id);
        await q(sb.from('homework_files').insert({ homework_id: id, kind: 'answer', path: path, name: files[i].name, size: files[i].size }));
      }
      toast('Ответ прикреплён'); refresh();
    }
  };

  document.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var fn = A[el.dataset.act]; if (!fn) return;
    e.preventDefault();
    try { await fn(el, e); } catch (err) { console.error(err); }
  });
  document.addEventListener('submit', async function (e) {
    var f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    var fn = F[f.dataset.form]; if (!fn) return;
    var btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    showErr(f, '');
    try { await fn(f, new FormData(f)); }
    catch (err) { console.error(err); showErr(f, 'Не получилось: ' + (err.message || err)); }
    finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  });
  document.addEventListener('change', async function (e) {
    var el = e.target.closest('[data-change]'); if (!el) return;
    var fn = C[el.dataset.change]; if (!fn) return;
    try { await fn(el, e); } catch (err) { console.error(err); }
  });
  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-input="vsearch"]'); if (!el) return;
    var term = el.value.trim().toLowerCase();
    document.querySelectorAll('[data-words] .word').forEach(function (w) { w.style.display = !term || w.dataset.text.indexOf(term) >= 0 ? '' : 'none'; });
  });

  // ---------------------------------------------------------------- boot
  sb.auth.onAuthStateChange(function (event, session) {
    S.session = session;
    if (event === 'PASSWORD_RECOVERY') { setTimeout(function () { go('reset'); }, 0); }
    if (event === 'SIGNED_OUT') { S.me = null; }
  });
  window.addEventListener('hashchange', function () { render(); });
  (async function () {
    var r = await sb.auth.getSession();
    S.session = r.data.session;
    render();
  })();
})();
