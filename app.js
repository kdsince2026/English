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
  var S = { session: null, me: null, teacherId: null, students: [], studentId: localStorage.getItem('studentId') || null };
  var ui = { hwTab: 'todo', folderId: null, matFilter: 'all', matAdd: false, loginMode: 'login', period: 'weeks', notes: null, train: null, lastPath: null };

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
  var UPLOAD = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

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
  function isDue(w, pm) { var p = pm.get(w.id); return !p || new Date(p.due_at) <= new Date(); }
  function isFresh(w) { return w.added_by && w.added_by !== S.teacherId && (Date.now() - new Date(w.created_at)) < 7 * 864e5; }

  // ---------------------------------------------------------------- shell
  function footer() { return '<footer class="foot"><span>English</span><span>English b1 · ' + new Date().getFullYear() + '</span></footer>'; }
  function shell(path, inner) {
    var links = [['home', 'HOME'], ['homework', 'HOMEWORK'], ['vocabulary', 'VOCABULARY'], ['materials', 'MATERIALS'], ['progress', 'PROGRESS']];
    var nav = links.map(function (l) {
      return '<a href="#/' + l[0] + '"' + (path === l[0] ? ' class="active" aria-current="page"' : '') + '>' + l[1] + '</a>';
    }).join('');
    var pick = '';
    if (isT() && S.students.length) {
      pick = '<label><span class="sr">Ученица</span><select class="student-pick" data-change="student">' +
        S.students.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === S.studentId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
        '</select></label>';
    }
    var name = esc(S.me.name) + (isT() ? ' · учитель' : '');
    return '<div class="wrap"><nav class="nav" aria-label="Разделы сайта"><div class="nav-links">' + nav + '</div>' +
      '<div class="acct">' + pick + '<span class="avatar" aria-hidden="true">' + esc((S.me.name || '?').charAt(0).toUpperCase()) + '</span>' +
      '<span class="acct-name">' + name + '</span><button type="button" class="linkbtn" data-act="logout">ВЫЙТИ</button></div></nav>' +
      inner + footer() + '</div>';
  }
  function noStudent() {
    return '<div class="card bluefill" style="margin-top:20px"><h2 class="h2">Пока нет учеников</h2><p class="muted">Создайте код приглашения на главной странице и отправьте его ученице. После регистрации здесь появятся её домашка, слова и прогресс.</p><a class="btn" href="#/home">НА ГЛАВНУЮ</a></div>';
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
    var teacherExists = true;
    try { var tr = await sb.rpc('teacher_exists'); if (!tr.error) teacherExists = !!tr.data; } catch (e) { /* offline */ }
    var reg = ui.loginMode === 'register';
    var form;
    if (!reg) {
      form = '<form class="form" data-form="login" novalidate>' +
        '<label class="field full">EMAIL<input name="email" type="email" autocomplete="email" required></label>' +
        '<label class="field full">ПАРОЛЬ<input name="password" type="password" autocomplete="current-password" required></label>' +
        '<p class="err" hidden></p>' +
        '<button class="btn block" type="submit">ВОЙТИ</button>' +
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
        '<button class="btn block" type="submit">ЗАРЕГИСТРИРОВАТЬСЯ</button>' +
        '<p class="muted" style="margin:0;font-size:13px;text-align:center">Уже есть аккаунт? <button type="button" class="linkbtn" data-act="mode" data-mode="login">Войти</button></p>' +
        '</form>';
    }
    app.innerHTML = '<div class="wrap"><div style="padding-top:18px;font-family:var(--display);font-weight:800;font-size:22px;letter-spacing:-.05em;color:var(--pink)">English</div>' +
      '<div class="auth"><div style="display:flex;flex-direction:column"><h1 class="display l" style="margin-bottom:-.16em;position:relative;z-index:2">' + (reg ? 'welcome' : 'hello') + '</h1>' +
      '<div class="hero-card" style="flex:1"><span class="script">' + (reg ? 'to class!' : 'again!') + '</span></div></div>' +
      '<div style="display:flex;flex-direction:column;justify-content:center"><div class="card" style="padding:clamp(24px,4vw,40px)">' +
      '<div class="pills" style="margin-bottom:20px"><button type="button" class="pill' + (!reg ? ' on' : '') + '" data-act="mode" data-mode="login">ВХОД</button><button type="button" class="pill' + (reg ? ' on' : '') + '" data-act="mode" data-mode="register">РЕГИСТРАЦИЯ</button></div>' +
      form + '</div></div></div>' + footer() + '</div>';
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
      t ? q(sb.from('invites').select('*').is('used_by', null).order('created_at', { ascending: false })) : [],
      q(sb.from('materials').select('id,title,group_name,url,file_name,added_by').order('created_at', { ascending: false }).limit(4))
    ]);
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

    var aside = '';
    if (st) aside += '<div><span class="pk">// СЕГОДНЯ —</span><br>' + (due ? (t ? 'ученице ' : '') + 'повторить ' + due + ' ' + plural(due, 'слово', 'слова', 'слов') : 'все слова повторены') + '</div>';
    if (nearest) aside += '<div><span class="pk">// ' + (nearest.due_date ? 'ДО ' + dayMonth(parseDate(nearest.due_date)).toUpperCase() : 'ДОМАШКА') + ' —</span><br>' + esc(nearest.title) + '</div>';
    else if (st) aside += '<div><span class="pk">// ДОМАШКА —</span><br>всё сдано</div>';
    if (next) { var nd = new Date(next.starts_at); aside += '<div><span class="pk">// ' + (DAYS[nd.getDay()] + ', ' + hhmm(nd)).toUpperCase() + ' —</span><br>урок ' + (nextIdx + 1) + ': ' + esc(next.topic) + '</div>'; }
    if (t) {
      if (st) aside += '<div class="box"><span class="pk">// УЧИТЕЛЮ —</span><br>' + waiting + ' ' + plural(waiting, 'работа ждёт', 'работы ждут', 'работ ждут') + ' проверки,<br>+' + fresh + ' ' + plural(fresh, 'новое слово', 'новых слова', 'новых слов') + ' ученицы</div>';
      aside += '<div class="box solid"><span><span class="pk">// ПРИГЛАШЕНИЕ —</span><br>код для регистрации ученицы</span>' +
        invites.map(function (inv) {
          return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="code">' + esc(inv.code) + '</span><span style="display:flex;gap:6px"><button type="button" class="btn sm" data-act="invite-copy" data-code="' + esc(inv.code) + '">ССЫЛКА</button><button type="button" class="iconbtn" aria-label="Удалить код" data-act="invite-del" data-code="' + esc(inv.code) + '">' + XICON + '</button></span></div>';
        }).join('') +
        '<button type="button" class="btn outline sm" data-act="invite-new">+ СОЗДАТЬ КОД</button></div>';
    }

    var lessonBlock;
    if (next) {
      var d = new Date(next.starts_at);
      lessonBlock = '<div style="display:flex;flex-direction:column;align-items:center"><span class="display s strike">next lesson is</span><span class="script" style="font-size:clamp(56px,8vw,96px);margin-top:-.3em">' + DAYS_EN[d.getDay()] + '</span></div>' +
        '<p class="lead" style="max-width:560px;text-transform:uppercase;font-size:15px">' + esc(lessonWhen(d)) + '. Тема — ' + esc(next.topic || 'без темы') + '</p>' +
        (next.call_link ? '<a class="btn" href="' + esc(safeUrl(next.call_link)) + '" target="_blank" rel="noopener" style="min-width:260px">ПОДКЛЮЧИТЬСЯ К УРОКУ</a>' : '<a class="btn" href="#/vocabulary" style="min-width:260px">ПОДГОТОВИТЬСЯ К УРОКУ</a>');
    } else {
      lessonBlock = '<div style="display:flex;flex-direction:column;align-items:center"><span class="display s">next lesson is</span><span class="script" style="font-size:clamp(56px,8vw,96px);margin-top:-.3em">soon</span></div><p class="lead" style="text-transform:uppercase;font-size:15px">' + (t ? 'Назначьте урок ниже' : 'Учитель скоро назначит урок') + '</p>';
    }
    if (t && st) {
      var upcoming = lessons.filter(function (l) { return new Date(l.starts_at).getTime() > now.getTime() - 3600e3; });
      lessonBlock += '<form class="form" data-form="lesson" style="background:rgba(255,255,255,.7);border-radius:16px;padding:18px;width:100%;max-width:820px;text-align:left">' +
        '<span class="label">//НАЗНАЧИТЬ УРОК ДЛЯ: ' + esc(studentName(st)).toUpperCase() + '</span>' +
        '<div class="fields"><label class="field">ДАТА<input type="date" name="date" required value="' + dayKey(new Date(Date.now() + 864e5)) + '"></label>' +
        '<label class="field" style="flex-basis:110px">ВРЕМЯ<input type="time" name="time" required value="19:00"></label>' +
        '<label class="field wide">ТЕМА<input name="topic" placeholder="Talking about plans"></label>' +
        '<label class="field wide">ССЫЛКА НА ЗВОНОК<input name="link" type="url" placeholder="https://"></label>' +
        '<button class="btn" type="submit">СОХРАНИТЬ</button></div><p class="err" hidden></p></form>' +
        (upcoming.length ? '<div class="lesson-list">' + upcoming.map(function (l) {
          var ld = new Date(l.starts_at);
          return '<div class="lesson-item"><span>' + esc(lessonWhen(ld)) + ' · ' + esc(l.topic) + '</span><button type="button" class="iconbtn" aria-label="Удалить урок" data-act="lesson-del" data-id="' + esc(l.id) + '">' + XICON + '</button></div>';
        }).join('') + '</div>' : '');
    }

    var hwCards = todo.slice(0, 2).map(function (h) {
      return '<a href="#/homework" class="card" style="flex:1 1 200px;text-decoration:none;display:flex;flex-direction:column;gap:8px;padding:18px"><span class="badge b-todo" style="align-self:flex-start">' + esc(dueText(h.due_date)) + '</span><b style="color:var(--ink);font-size:15px">' + esc(h.title) + '</b></a>';
    }).join('') || '<div class="card" style="flex:1"><p class="empty" style="margin:0">всё сделано!</p></div>';
    var latest = v.words.slice(0, 3).map(function (w) { return '<div class="mini"><b>' + esc(w.en) + '</b><span class="muted">' + esc(w.ru) + '</span></div>'; }).join('');
    var matCards = mats.map(function (m) {
      var st2 = m.added_by !== S.teacherId;
      return '<a href="#/materials" class="card' + (st2 ? ' pinkfill' : '') + '" style="padding:16px;text-decoration:none;display:flex;flex-direction:column;gap:6px"><span class="label pk">' + esc(m.group_name).toUpperCase() + '</span><b style="color:var(--ink)">' + esc(m.title) + '</b></a>';
    }).join('');

    return '<section class="hero"><div class="hero-main"><h1 class="display xl">English</h1><div class="hero-card">' +
      '<svg viewBox="0 0 400 260" fill="none" stroke="#BFD3EE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M40 200c40-14 90-14 140 4V60C130 42 80 42 40 56z"/><path d="M180 204c50-18 100-18 140-4V56c-40-14-90-14-140 4"/><path d="M70 90c25-6 55-6 80 2M70 120c25-6 55-6 80 2M70 150c25-6 55-6 80 2M210 92c25-8 55-8 80-2M210 122c25-8 55-8 80-2"/><path d="M290 20h80a16 16 0 0 1 16 16v34a16 16 0 0 1-16 16h-40l-22 18v-18h-18a16 16 0 0 1-16-16V36a16 16 0 0 1 16-16z"/><path d="M302 46h56M302 62h36"/></svg>' +
      '<span class="script">let’s talk!</span><div class="hero-tab"><p>You’re killing it, girl</p><a class="btn" href="#/train">REPEAT VOCABULARY</a></div></div></div>' +
      '<aside class="hero-aside">' + aside + '</aside></section>' +
      '<section class="paper pinkp center">' + lessonBlock + '</section>' +
      '<section class="teaser"><div style="display:flex;gap:14px;flex-wrap:wrap">' + hwCards + '</div><div class="col"><span class="label">//ОСТАЛОСЬ: ' + todo.length + ' · СДЕЛАНО: ' + doneAll + '</span><h2 class="display m">homework</h2><p class="lead">задания с файлами, фото, PDF и DOCX,<br>отметки «сделано» и комментарии учителя</p><a class="btn" href="#/homework">К ДОМАШКЕ</a></div></section>' +
      '<section class="teaser rev"><div class="col"><span class="label">//' + v.words.length + ' ' + plural(v.words.length, 'СЛОВО', 'СЛОВА', 'СЛОВ') + ' · ' + topics + ' ' + plural(topics, 'ТОПИК', 'ТОПИКА', 'ТОПИКОВ') + (own ? ' · ' + own + ' ' + plural(own, 'СВОЯ ПАПКА', 'СВОИ ПАПКИ', 'СВОИХ ПАПОК') : '') + '</span><h2 class="display m">vocabulary</h2><p class="lead">слова по топикам</p><a class="btn" href="#/vocabulary">К СЛОВАМ</a></div><div class="minis">' + (latest || '<p class="muted">Слов пока нет</p>') + '</div></section>' +
      '<section class="teaser"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">' + (matCards || '<p class="muted">Материалов пока нет</p>') + '</div><div class="col"><h2 class="display m">materials</h2><p class="lead">шпаргалки, подкасты, видео и файлы</p><a class="btn" href="#/materials">К МАТЕРИАЛАМ</a></div></section>' +
      '<section class="paper bluep teaser"><div class="col"><div><span class="display s">you are</span> <span class="script" style="font-size:clamp(56px,7vw,86px);margin-left:-.2em">here</span></div>' +
      '<p class="lead" style="text-transform:uppercase;font-size:15px">' + pastCount + ' ' + plural(pastCount, 'урок пройден', 'урока пройдено', 'уроков пройдено') + ', ' + learned + ' ' + plural(learned, 'слово выучено', 'слова выучено', 'слов выучено') + ',<br>' + doneAll + ' из ' + hw.length + ' домашек сдано</p>' +
      '<a class="btn" href="#/progress" style="max-width:320px">СМОТРЕТЬ ПРОГРЕСС</a></div><div class="card" style="display:flex;flex-direction:column;gap:16px"><span class="label">МАРШРУТ КУРСА</span>' + routeHtml(lessons) + '</div></section>';
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
        '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline"><h2 class="display s" style="color:var(--blue)">новое задание</h2><span class="label">//ДЛЯ: ' + esc(studentName(st)).toUpperCase() + '</span></div>' +
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
      if (t) side += '<button type="button" class="linkbtn" style="align-self:flex-start" data-act="hw-del" data-id="' + esc(h.id) + '">удалить задание</button>';
      return '<article class="card hw"><div class="hw-main"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' + (h.lesson_label ? '<span class="label">//' + esc(h.lesson_label).toUpperCase() + '</span>' : '') + badge + '</div>' +
        '<h2 class="h3">' + esc(h.title) + '</h2>' + (h.description ? '<p class="desc">' + esc(h.description) + '</p>' : '') +
        (tf.length ? '<div class="files">' + tf.map(function (f) { return fileChip(f); }).join('') + '</div>' : '') +
        (af.length ? '<div class="files" style="align-items:center"><span class="label">ОТВЕТ:</span>' + af.map(function (f) { return fileChip(f, 'answer'); }).join('') + '</div>' : '') +
        (h.status === 'checked' && (h.teacher_comment || h.grade) ? '<div class="comment">' + (h.grade ? '<span class="script">' + esc(h.grade) + '</span>' : '') + (h.teacher_comment ? '<p>' + esc(h.teacher_comment) + '</p>' : '') + '</div>' : '') +
        '</div><div class="hw-side">' + side + '</div></article>';
    }).join('');

    return '<header class="page-head"><div class="title-wrap"><h1 class="display l">homework</h1><span class="script">to do</span></div>' +
      '<div class="notes"><div><span class="pk">// ОСТАЛОСЬ —</span> ' + todo.length + '</div><div><span class="pk">// СДЕЛАНО —</span> ' + done.length + '</div></div></header>' +
      form +
      '<div class="pills tabs"><button type="button" class="pill' + (ui.hwTab === 'todo' ? ' on' : '') + '" data-act="hw-tab" data-tab="todo">ОСТАЛОСЬ · ' + todo.length + '</button><button type="button" class="pill' + (ui.hwTab === 'done' ? ' on' : '') + '" data-act="hw-tab" data-tab="done">СДЕЛАНО · ' + done.length + '</button></div>' +
      '<div class="col" style="gap:18px">' + (cards || '<p class="empty">' + (ui.hwTab === 'todo' ? 'всё сделано!' : 'пока пусто') + '</p>') + '</div>';
  }

  // ---------------------------------------------------------------- VOCABULARY
  async function pageVocab() {
    var st = sid(), t = isT();
    var v = await loadVocab(st);
    var topics = v.folders.filter(function (f) { return f.owner_id === S.teacherId; });
    var mine = v.folders.filter(function (f) { return f.owner_id !== S.teacherId; });
    if (!v.folders.some(function (f) { return f.id === ui.folderId; })) ui.folderId = v.folders[0] ? v.folders[0].id : null;
    var folder = v.folders.filter(function (f) { return f.id === ui.folderId; })[0];
    var counts = {}; v.words.forEach(function (w) { counts[w.folder_id] = (counts[w.folder_id] || 0) + 1; });
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
      main += '<div class="grid" data-words>' + (words.map(function (w) {
        var p = v.pm.get(w.id), s = STAT[p ? p.status : 'new'];
        var fr = t && isFresh(w);
        return '<div class="word' + (fr ? ' fresh' : '') + '" data-text="' + esc((w.en + ' ' + w.ru).toLowerCase()) + '"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><span class="en">' + esc(w.en) + '</span><span style="display:flex;gap:4px"><button type="button" class="iconbtn" aria-label="Послушать" data-act="say" data-text="' + esc(w.en) + '">' + SPEAK + '</button>' +
          (own ? '<button type="button" class="iconbtn" aria-label="Удалить слово" data-act="word-del" data-id="' + esc(w.id) + '">' + XICON + '</button>' : '') + '</span></div>' +
          '<span class="ru">' + esc(w.ru) + '</span>' + (w.example ? '<span class="ex">' + esc(w.example) + '</span>' : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' + (st ? '<span class="badge ' + s[1] + '">' + s[0] + '</span>' : '') + (fr ? '<span class="badge b-fresh">НОВОЕ ОТ УЧЕНИЦЫ</span>' : '') + '</div></div>';
      }).join('') || '<p class="muted">В папке пока нет слов.</p>') + '</div>';
    }

    return '<header class="page-head"><div class="title-wrap"><h1 class="display l">vocabulary</h1><span class="script">my words</span></div>' +
      '<div class="notes"><div><span class="pk">// ТОПИКИ —</span> добавляет учитель</div><div><span class="pk">// МОИ ПАПКИ —</span> добавляет ученица,<br>учитель тоже их видит</div></div></header>' +
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
    if (!total) return head + '<div class="card center"><span class="script" style="font-size:44px;transform:none">all done!</span><p class="muted">На сегодня повторять нечего. Загляни завтра или потренируй любую папку.</p><a class="btn" href="#/vocabulary">К СЛОВАМ</a></div>';
    if (tr.i >= total) {
      return head + '<div class="card center"><span class="script" style="font-size:52px;transform:none">well done!</span><p class="lead">Помню: ' + tr.good + ' · Сложно: ' + tr.hard + ' · Не помню: ' + tr.again + '</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/home">НА ГЛАВНУЮ</a><a class="btn outline" href="#/vocabulary">К СЛОВАМ</a></div></div>';
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
      addPanel = '<section class="paper bluep"><form class="form" data-form="mat-new"><h2 class="display s" style="color:var(--blue)">новый материал</h2>' +
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
      return '<section class="col" style="gap:16px"><div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap"><h2 class="display s">' + esc(g.toLowerCase()) + '</h2><span class="label">//' + its.length + ' ' + plural(its.length, 'МАТЕРИАЛ', 'МАТЕРИАЛА', 'МАТЕРИАЛОВ') + '</span></div><div class="grid">' +
        its.map(function (m) {
          var fromStudent = m.added_by !== S.teacherId;
          var type = m.file_path ? extTag(m.file_name) : '<span class="ext' + (isVideo(m.url) ? ' doc' : '') + '">' + (isVideo(m.url) ? 'ВИДЕО' : 'ССЫЛКА') + '</span>';
          var open = m.file_path
            ? '<button type="button" class="btn sm outline" data-act="open-file" data-path="' + esc(m.file_path) + '">ОТКРЫТЬ ФАЙЛ</button>'
            : '<a class="btn sm outline" href="' + esc(safeUrl(m.url)) + '" target="_blank" rel="noopener">ОТКРЫТЬ</a>';
          var canDel = t || m.added_by === S.me.id;
          return '<div class="card' + (fromStudent ? ' pinkfill' : '') + '" style="padding:18px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' + type +
            '<span class="label" style="font-size:10px;color:' + (fromStudent ? 'var(--pink-text)' : 'var(--blue)') + '">' + (fromStudent ? 'ОТ УЧЕНИЦЫ' : 'ОТ УЧИТЕЛЯ') + '</span></div>' +
            '<b style="font-size:16px;color:var(--ink);line-height:1.3">' + esc(m.title) + '</b>' + (m.note ? '<span class="muted" style="font-size:13px;line-height:1.45">' + esc(m.note) + '</span>' : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:auto;padding-top:6px">' + open + (canDel ? '<button type="button" class="linkbtn" data-act="mat-del" data-id="' + esc(m.id) + '">удалить</button>' : '') + '</div></div>';
        }).join('') + '</div></section>';
    }).join('');

    return '<header class="page-head"><div class="title-wrap"><h1 class="display l">materials</h1><span class="script">useful</span></div>' +
      '<button type="button" class="btn" data-act="mat-toggle">' + (ui.matAdd ? 'ЗАКРЫТЬ' : '+ ДОБАВИТЬ МАТЕРИАЛ') + '</button></header>' + addPanel +
      (groups.length ? '<div class="pills">' + filters.map(function (f) { return '<button type="button" class="pill' + (ui.matFilter === f[0] ? ' on' : '') + '" data-act="mat-filter" data-f="' + esc(f[0]) + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>' : '') +
      (body || '<p class="hint">Материалов пока нет — добавьте первый кнопкой выше.</p>');
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
      loadVocab(st)
    ]);
    var lessons = res[0], hw = res[1], notes = res[2], logs = res[3], v = res[4];
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
    var noteBlock = t
      ? '<form class="form" data-form="note" style="gap:10px"><label class="field full">КОММЕНТАРИЙ ДЛЯ УЧЕНИЦЫ<textarea name="note" rows="4" style="border-color:transparent">' + esc(ui.notes.note) + '</textarea></label><button class="btn" type="submit" style="align-self:flex-start">СОХРАНИТЬ</button></form>'
      : '<p style="margin:0;font-size:16px;font-weight:600;line-height:1.55;color:var(--ink);white-space:pre-line">' + (ui.notes.note ? esc(ui.notes.note) : 'Учитель пока не оставил комментарий.') + '</p>';

    return '<header class="page-head"><div class="title-wrap"><h1 class="display l">progress</h1><span class="script" style="right:-40px">you are here</span></div></header>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + learned + '</b><span class="label">' + plural(learned, 'СЛОВО ВЫУЧЕНО', 'СЛОВА ВЫУЧЕНО', 'СЛОВ ВЫУЧЕНО') + '</span><span class="muted" style="font-size:13px">из ' + v.words.length + ' · +' + learnedWeek + ' за неделю</span></div>' +
      '<div class="stat"><b>' + (hwChecked + hwDone) + '/' + hw.length + '</b><span class="label">ДОМАШЕК СДАНО</span><span class="muted" style="font-size:13px">' + hwTodo + ' осталось, ' + hwDone + ' на проверке</span></div>' +
      '<div class="stat"><b>' + pastLessons + '</b><span class="label">' + plural(pastLessons, 'УРОК ПРОЙДЕН', 'УРОКА ПРОЙДЕНО', 'УРОКОВ ПРОЙДЕНО') + '</span><span class="muted" style="font-size:13px">' + (nextL ? 'следующий — ' + DAYS_SHORT[new Date(nextL.starts_at).getDay()] + ', ' + dayMonth(new Date(nextL.starts_at)) : 'следующий не назначен') + '</span></div>' +
      '<div class="stat pink"><b>' + streak + '</b><span class="label">' + plural(streak, 'ДЕНЬ ПОДРЯД', 'ДНЯ ПОДРЯД', 'ДНЕЙ ПОДРЯД') + '</span><span style="font-size:13px;font-weight:600">повторяешь слова</span></div></div>' +
      '<section class="paper bluep col" style="gap:20px"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline"><h2 class="display s" style="color:var(--blue)">маршрут курса</h2><span class="label">//УРОКИ НАЗНАЧАЕТ УЧИТЕЛЬ</span></div>' + routeHtml(lessons) + '</section>' +
      '<div class="row" style="align-items:stretch"><section class="card col" style="flex:1 1 460px;gap:18px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><h2 class="label" style="font-size:16px;margin:0">ВЫУЧЕНО СЛОВ</h2><div class="pills" style="gap:6px"><button type="button" class="pill' + (ui.period === 'weeks' ? ' on' : '') + '" data-act="period" data-p="weeks" style="min-height:32px">НЕДЕЛИ</button><button type="button" class="pill' + (ui.period === 'months' ? ' on' : '') + '" data-act="period" data-p="months" style="min-height:32px">МЕСЯЦЫ</button></div></div><div class="chart">' + chart + '</div><span class="muted" style="font-size:12px">Слово считается выученным после трёх правильных ответов подряд в тренировке.</span></section>' +
      '<section class="card col" style="flex:1 1 380px;gap:16px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;flex-wrap:wrap"><h2 class="label" style="font-size:16px;margin:0">НАВЫКИ</h2><span class="muted" style="font-size:12px">' + (t ? 'оцениваете вы, ученица видит' : 'оценка учителя') + '</span></div>' + skills + '</section></div>' +
      '<div class="row" style="align-items:stretch"><section class="card col" style="flex:1 1 380px;gap:14px"><h2 class="label" style="font-size:16px;margin:0">ДОМАШКА</h2><div class="stack"><div style="width:' + hwChecked / hwTotal * 100 + '%;background:var(--blue)"></div><div style="width:' + hwDone / hwTotal * 100 + '%;background:#9DBBE3"></div><div style="width:' + hwTodo / hwTotal * 100 + '%;background:var(--pink)"></div></div>' +
      '<div class="legend"><span><i style="background:var(--blue)"></i>проверено · ' + hwChecked + '</span><span><i style="background:#9DBBE3"></i>на проверке · ' + hwDone + '</span><span><i style="background:var(--pink)"></i>осталось · ' + hwTodo + '</span></div><a href="#/homework" class="label" style="margin-top:auto">ОТКРЫТЬ ДОМАШКУ →</a></section>' +
      '<section class="card pinkfill col" style="flex:1 1 460px"><span class="script" style="font-size:36px;transform:none">note from teacher</span>' + noteBlock + '</section></div>';
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
    'invite-new': async function () {
      var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = 'B1-';
      var rnd = new Uint32Array(5); crypto.getRandomValues(rnd);
      for (var i = 0; i < 5; i++) code += abc[rnd[i] % abc.length];
      await q(sb.from('invites').insert({ code: code }));
      toast('Код создан: ' + code); refresh();
    },
    'invite-copy': async function (el) {
      var link = location.origin + location.pathname + '#/login?invite=' + encodeURIComponent(el.dataset.code);
      try { await navigator.clipboard.writeText(link); toast('Ссылка-приглашение скопирована'); }
      catch (e) { window.prompt('Скопируйте ссылку:', link); }
    },
    'invite-del': async function (el) { await q(sb.from('invites').delete().eq('code', el.dataset.code)); refresh(); },
    'lesson-del': async function (el) { if (!confirm('Удалить этот урок?')) return; await q(sb.from('lessons').delete().eq('id', el.dataset.id)); refresh(); },
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
