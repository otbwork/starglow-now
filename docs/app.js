'use strict';

const feedEl = document.getElementById('feed');
const updatedEl = document.getElementById('updatedAt');
const filtersEl = document.getElementById('filters');
const refreshBtn = document.getElementById('refreshBtn');
const searchEl = document.getElementById('searchBox');
const upcomingEl = document.getElementById('upcoming');
const membersEl = document.getElementById('members');

let allItems = [];
let allEvents = [];
let currentFilter = 'all';
let currentQuery = '';
let currentMember = null;

const TYPE_LABEL = {
  youtube: '🎬 YouTube',
  news: '📰 ニュース',
  goods: '🛍 グッズ',
};

// ---- メンバー情報（STARGLOW／BMSG。公式メンバーカラーは無いため色は持たせない） ----
const MEMBERS = [
  { name: 'ADAM',   birth: '04.24', aliases: ['ADAM', 'アダム'] },
  { name: 'KANON',  birth: '04.03', aliases: ['KANON', 'カノン'] },
  { name: 'GOICHI', birth: '12.14', aliases: ['GOICHI', 'ゴウイチ'] },
  { name: 'RUI',    birth: '06.01', aliases: ['RUI', 'ルイ'] },
  { name: 'TAIKI',  birth: '07.28', aliases: ['TAIKI', 'タイキ'] },
];

// メンバー名のマッチ用正規表現（「マルイ」の中の「ルイ」等の誤ヒットを防ぐ）
function memberRegexes(mb) {
  return mb.aliases.map((a) => {
    if (/^[A-Za-z]+$/.test(a)) {
      return new RegExp(`(?<![A-Za-z])${a}(?![A-Za-z])`, 'i'); // 英字は単語境界
    }
    try {
      return new RegExp(`(?<![ァ-ヶー])${a}(?![ァ-ヶー])`); // カタカナは前後にカタカナが無いこと
    } catch (e) {
      return new RegExp(a); // 古いブラウザは単純一致にフォールバック
    }
  });
}
MEMBERS.forEach((mb) => { mb.regexes = memberRegexes(mb); });

function matchesMember(item) {
  if (!currentMember) return true;
  const mb = MEMBERS.find((m) => m.name === currentMember);
  if (!mb) return true;
  const hay = `${item.title || ''} ${item.summary || ''}`;
  return mb.regexes.some((re) => re.test(hay));
}

// 記念日（毎年繰り返し）
const ANNIVERSARIES = [
  { label: 'GROUP ANNIVERSARY', note: 'THE LAST PIECE で結成 (2025)', date: '09.19', emoji: '✨' },
];

// ---- お気に入り（端末に保存） ----
const FAV_KEY = 'starglow-now-favs';
let favs = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch (e) {}
function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch (e) {}
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

function isNew(iso) {
  const then = new Date(iso).getTime();
  return !isNaN(then) && Date.now() - then < 24 * 3600 * 1000;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function matchesFilter(item) {
  const tier = item.credibility?.tier;
  switch (currentFilter) {
    case 'all': return true;
    case 'official': return tier === 'official';
    case 'goods': return item.type === 'goods';
    case 'youtube': return item.type === 'youtube';
    case 'news': return item.type === 'news';
    case 'verified': return tier === 'official' || tier === 'major';
    case 'fav': return favs.has(item.id);
    default: return true;
  }
}

function matchesQuery(item) {
  if (!currentQuery) return true;
  const hay = `${item.title || ''} ${item.summary || ''} ${item.source || ''}`.toLowerCase();
  return currentQuery.toLowerCase().split(/\s+/).every((w) => !w || hay.includes(w));
}

function cardHTML(item) {
  const c = item.credibility || { tier: 'known', tierLabel: 'メディア', score: 50, warning: null };
  const tier = c.tier || 'known';
  const typeLabel = TYPE_LABEL[item.type] || '🔗 情報';
  const newBadge = isNew(item.publishedAt) ? '<span class="new-badge">NEW</span>' : '';
  const warn = c.warning
    ? `<div class="warn">⚠️ <span>${escapeHtml(c.warning)}</span></div>` : '';
  const summary = item.summary
    ? `<p class="summary">${escapeHtml(item.summary)}</p>` : '';
  const thumb = item.thumbnail
    ? `<img class="thumb" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.remove()" />` : '';
  const favOn = favs.has(item.id);

  return `
    <a class="card tier-${tier}" href="${escapeHtml(item.url)}" rel="noopener">
      <div class="card-top">
        <span class="badge ${tier}">${escapeHtml(c.tierLabel || tier)}</span>
        <span class="type-tag">${typeLabel}</span>
        ${newBadge}
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      ${thumb}
      ${summary}
      ${warn}
      <div class="cred-bar"><div class="cred-fill" style="width:${Math.max(6, c.score || 0)}%"></div></div>
      <div class="card-meta">
        <span class="source">${escapeHtml(item.source || '')} ・ ${timeAgo(item.publishedAt)}</span>
        <span class="card-actions">
          <button class="mini-btn fav-btn ${favOn ? 'is-on' : ''}" data-act="fav" data-id="${escapeHtml(item.id)}"
            title="お気に入り" aria-label="お気に入り" aria-pressed="${favOn}">${favOn ? '♥' : '♡'}</button>
          <button class="mini-btn" data-act="share" data-id="${escapeHtml(item.id)}"
            title="共有" aria-label="共有">↗</button>
          <span class="go">開く →</span>
        </span>
      </div>
    </a>`;
}

function render() {
  const items = allItems.filter((it) => matchesFilter(it) && matchesQuery(it) && matchesMember(it));
  renderMemberNote();
  if (!items.length) {
    let msg = '該当する情報がありません';
    if (currentFilter === 'fav') {
      msg = 'お気に入りはまだありません。カードの ♡ をタップすると保存されます。';
    } else if (currentMember) {
      msg = `${currentMember} に関する情報は今のところありません`;
    }
    feedEl.innerHTML = `<div class="state">${msg}</div>`;
    return;
  }
  feedEl.innerHTML = items.map(cardHTML).join('');
}

// ---- メンバー絞り込みの表示バー ----
function renderMemberNote() {
  const note = document.getElementById('memberNote');
  if (!note) return;
  if (!currentMember) { note.style.display = 'none'; note.innerHTML = ''; return; }
  const mb = MEMBERS.find((m) => m.name === currentMember);
  note.style.display = '';
  note.innerHTML = `<span class="m-dot"></span>
    <span><b>${mb.name}</b> のニュースを表示中</span>
    <button id="clearMember" type="button">解除 ×</button>`;
  note.querySelector('#clearMember').addEventListener('click', () => setMember(null));
}

function setMember(name) {
  currentMember = currentMember === name ? null : name;
  document.querySelectorAll('.member').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.name === currentMember);
  });
  render();
  if (currentMember) {
    document.getElementById('memberNote')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---- ライブ・リリース予定（記事から自動抽出したもの） ----
const KIND_EMOJI = { live: '🎤', release: '💿', media: '📺', event: '🎪' };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function renderSchedule() {
  const sec = document.getElementById('schedule-sec');
  const el = document.getElementById('schedule');
  if (!sec || !el) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const list = (allEvents || [])
    .filter((ev) => new Date(ev.date + 'T00:00:00') >= today)
    .slice(0, 8);
  if (!list.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  el.innerHTML = list.map((ev) => {
    const d = new Date(ev.date + 'T00:00:00');
    const isToday = d.getTime() === today.getTime();
    return `<a class="sc-row" href="${escapeHtml(ev.url)}" rel="noopener">
      <span class="sc-date">${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}
        <small>${WEEKDAYS[d.getDay()]}曜日</small></span>
      <span class="sc-kind ${escapeHtml(ev.kind)}">${KIND_EMOJI[ev.kind] || '📌'} ${escapeHtml(ev.kindLabel || '')}</span>
      <span class="sc-title">${escapeHtml(ev.title)}</span>
      ${isToday ? '<span class="sc-today">本日</span>' : ''}
    </a>`;
  }).join('');
}

// ---- 誕生日・記念日カウントダウン ----
function nextOccurrence(mmdd) {
  const [m, d] = mmdd.split('.').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(now.getFullYear(), m - 1, d);
  if (target < today) target = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((target - today) / 86400000);
}

function renderUpcoming() {
  if (!upcomingEl) return;
  const events = [
    ...MEMBERS.map((mb) => ({
      emoji: '🎂', isMember: true,
      title: `${mb.name} BIRTHDAY`, date: mb.birth,
      days: nextOccurrence(mb.birth),
    })),
    ...ANNIVERSARIES.map((a) => ({
      emoji: a.emoji, isMember: false,
      title: a.label, note: a.note, date: a.date,
      days: nextOccurrence(a.date),
    })),
  ].sort((x, y) => x.days - y.days).slice(0, 3);

  const rows = events.map((ev) => {
    const dot = ev.isMember
      ? '<span class="m-dot"></span>' : `<span class="m-dot m-dot-none">${ev.emoji}</span>`;
    const when = ev.days === 0
      ? '<b class="today">本日 🎉</b>'
      : `<b>あと${ev.days}日</b>`;
    return `<div class="up-row">
      ${dot}
      <span class="up-title">${ev.emoji === '🎂' ? '🎂 ' : ''}${escapeHtml(ev.title)}</span>
      <span class="up-date">${escapeHtml(ev.date)}</span>
      <span class="up-days">${when}</span>
    </div>`;
  }).join('');

  upcomingEl.innerHTML = `<p class="up-label">Upcoming</p>${rows}`;
}

// ---- メンバー一覧 ----
function renderMembers() {
  if (!membersEl) return;
  membersEl.innerHTML = MEMBERS.map((mb) => `
    <button class="member" type="button" data-name="${mb.name}"
      title="${mb.name}のニュースを表示" aria-label="${mb.name}のニュースを表示">
      <span class="m-dot"></span>
      <span class="m-name">${mb.name}</span>
      <span class="m-birth">🎂 ${mb.birth}</span>
    </button>`).join('');
  membersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.member');
    if (btn) setMember(btn.dataset.name);
  });
}

async function load() {
  feedEl.innerHTML = '<div class="state">読み込み中…</div>';
  try {
    const res = await fetch('data/feed.json?_=' + Date.now());
    const data = await res.json();
    allItems = data.items || [];
    allEvents = data.events || [];
    // 新しい順 → 信頼度順で安定化
    allItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    renderSchedule();

    if (data.sample && !document.querySelector('.sample-note')) {
      feedEl.insertAdjacentHTML('beforebegin',
        '<div class="sample-note">※ サンプル表示中です。GitHub Actions が初回実行されると実データに切り替わります。</div>');
    }

    if (data.updatedAt) {
      updatedEl.textContent = '最終更新: ' + new Date(data.updatedAt).toLocaleString('ja-JP');
    }
    render();
  } catch (e) {
    feedEl.innerHTML = '<div class="state">読み込みに失敗しました。<br>時間をおいて再度お試しください。</div>';
  }
}

filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
  btn.classList.add('is-active');
  currentFilter = btn.dataset.filter;
  render();
});

// カード内の ♡ / 共有ボタン（リンク遷移を止めて処理）
feedEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.mini-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const id = btn.dataset.id;
  const item = allItems.find((it) => it.id === id);
  if (!item) return;

  if (btn.dataset.act === 'fav') {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    saveFavs();
    render();
  } else if (btn.dataset.act === 'share') {
    const payload = { title: item.title, text: `${item.title} | STARGLOW NOW`, url: item.url };
    if (navigator.share) {
      navigator.share(payload).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(item.url).then(() => {
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '↗'; }, 1200);
      }).catch(() => {});
    }
  }
});

if (searchEl) {
  searchEl.addEventListener('input', () => {
    currentQuery = searchEl.value.trim();
    render();
  });
}

refreshBtn.addEventListener('click', load);

// ---- 起動スプラッシュ（トップ画像を画面いっぱいに出してからフェードアウト） ----
function initSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const remove = () => splash.remove();
  // アニメーション終了後に取り除く（保険のタイマーも用意）
  splash.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 2600);
}

initSplash();
renderUpcoming();
renderMembers();
load();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
