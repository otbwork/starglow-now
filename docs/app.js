'use strict';

const feedEl = document.getElementById('feed');
const updatedEl = document.getElementById('updatedAt');
const filtersEl = document.getElementById('filters');
const refreshBtn = document.getElementById('refreshBtn');

let allItems = [];
let currentFilter = 'all';

const TYPE_LABEL = {
  youtube: '🎬 YouTube',
  news: '📰 ニュース',
};

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
    case 'youtube': return item.type === 'youtube';
    case 'news': return item.type === 'news';
    case 'verified': return tier === 'official' || tier === 'major';
    default: return true;
  }
}

function cardHTML(item) {
  const c = item.credibility || { tier: 'known', tierLabel: 'メディア', score: 50, warning: null };
  const tier = c.tier || 'known';
  const typeLabel = TYPE_LABEL[item.type] || '🔗 情報';
  const warn = c.warning
    ? `<div class="warn">⚠️ <span>${escapeHtml(c.warning)}</span></div>` : '';
  const summary = item.summary
    ? `<p class="summary">${escapeHtml(item.summary)}</p>` : '';

  return `
    <a class="card tier-${tier}" href="${escapeHtml(item.url)}" rel="noopener">
      <div class="card-top">
        <span class="badge ${tier}">${escapeHtml(c.tierLabel || tier)}</span>
        <span class="type-tag">${typeLabel}</span>
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      ${summary}
      ${warn}
      <div class="cred-bar"><div class="cred-fill" style="width:${Math.max(6, c.score || 0)}%"></div></div>
      <div class="card-meta">
        <span class="source">${escapeHtml(item.source || '')} ・ ${timeAgo(item.publishedAt)}</span>
        <span class="go">開く →</span>
      </div>
    </a>`;
}

function render() {
  const items = allItems.filter(matchesFilter);
  if (!items.length) {
    feedEl.innerHTML = '<div class="state">該当する情報がありません</div>';
    return;
  }
  feedEl.innerHTML = items.map(cardHTML).join('');
}

async function load() {
  feedEl.innerHTML = '<div class="state">読み込み中…</div>';
  try {
    const res = await fetch('data/feed.json?_=' + Date.now());
    const data = await res.json();
    allItems = data.items || [];
    // 新しい順 → 信頼度順で安定化
    allItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const note = data.sample
      ? '<div class="sample-note">※ サンプル表示中です。GitHub Actions が初回実行されると実データに切り替わります。</div>'
      : '';
    feedEl.insertAdjacentHTML('beforebegin', note);

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

refreshBtn.addEventListener('click', load);

load();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
