const GRANT_KEY = (itemId) => `cfb_grant_${itemId}`;
const TEXT_PREVIEW_BYTES = 2000;

// Resolved at load time from the settings form.
let _owner = '';
let _publisherUrl = '';

// ── Config & init ─────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.defaultFeedOwner)
      document.getElementById('feed-owner').value = config.defaultFeedOwner;
    if (config.defaultPublisherUrl)
      document.getElementById('publisher-url').value = config.defaultPublisherUrl;
  } catch {
    // non-fatal
  }
}

function _toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const btn = document.getElementById('settings-toggle');
  const isOpen = panel.classList.toggle('open');
  btn.textContent = isOpen ? '▲ Settings' : '⚙ Settings';
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
  el.hidden = false;
  document.getElementById('grid').hidden = true;
  document.getElementById('count-badge').hidden = true;
  const meta = document.getElementById('catalog-meta');
  if (meta) meta.hidden = true;
}

function truncate(str, len = 16) {
  if (!str) return '';
  return str.length > len * 2 + 3 ? str.slice(0, len) + '…' + str.slice(-len) : str;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// CAIP-19 "eip155:84532/erc20:0x833…" → short "erc20:0x833…2913" label.
function shortAsset(caip19) {
  if (!caip19) return '';
  const slash = caip19.lastIndexOf('/');
  const tail = slash === -1 ? caip19 : caip19.slice(slash + 1);
  return tail.replace(/(0x[0-9a-fA-F]{4})[0-9a-fA-F]+([0-9a-fA-F]{4})/, '$1…$2');
}

function formatPrice(payment) {
  if (!Array.isArray(payment) || payment.length === 0) return 'free';
  const p = payment[0];
  return `${escHtml(p.amount)} ${escHtml(shortAsset(p.asset))}`;
}

function _copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
  });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderTags(tags) {
  if (!tags || tags.length === 0) return '<span class="tag empty">no tags</span>';
  return tags.map((t) => `<span class="tag">${escHtml(String(t))}</span>`).join('');
}

function lifecycleBadge(lifecycle) {
  const cls =
    lifecycle === 'retired'
      ? 'lc-retired'
      : lifecycle === 'deprecated'
        ? 'lc-deprecated'
        : 'lc-active';
  return `<span class="lifecycle-badge ${cls}">${escHtml(lifecycle)}</span>`;
}

function renderGrantBlock(grant) {
  const a = (v) => escHtml(v ?? '');
  const rows = [
    ['Item ID', grant.itemId],
    ['ACT History Ref', grant.actHistoryRef],
    ['Granted To', grant.grantTo],
    ['Tx Hash', grant.txHash],
    ['Granted At', grant.grantedAt],
  ];
  const canView =
    grant.grantorPublicKey && grant.actHistoryRef && (grant.reference || grant.itemId);
  const viewRow = canView
    ? `<div class="view-download-row">
        <button class="btn-view" onclick="_viewContent('${a(grant.itemId)}', this)">View content</button>
      </div>
      <div class="content-preview" id="content-${a(grant.itemId)}" hidden></div>`
    : '';
  return `
    <div class="buy-result success">
      <div class="buy-result-title">✓ Access Granted</div>
      ${rows
        .filter(([, v]) => v)
        .map(
          ([label, value]) => `
        <div class="detail-row">
          <span class="detail-label">${a(label)}</span>
          <span class="detail-value">${a(value)}</span>
        </div>`,
        )
        .join('')}
      ${viewRow}
    </div>`;
}

// Fetch and display the purchased ACT-protected content. Uses the grant stored at purchase time
// (grantorPublicKey = actPublisher, actHistoryRef, reference) — the server-side Bee node decrypts.
async function _viewContent(itemId, btn) {
  const container = document.getElementById(`content-${itemId}`);
  if (!container) return;
  if (!container.hidden) {
    container.hidden = true;
    btn.textContent = 'View content';
    return;
  }

  const grant = JSON.parse(localStorage.getItem(GRANT_KEY(itemId)) ?? '{}');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  try {
    const res = await fetch('/api/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: grant.reference || grant.itemId,
        actPublisher: grant.grantorPublicKey,
        actHistoryRef: grant.actHistoryRef,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to load content');
    const text = prettyMaybeJson(data.content);
    container.innerHTML = `
      <div class="purchased-content">
        <div class="purchased-content-label">Purchased content</div>
        <pre class="purchased-content-body">${escHtml(text)}</pre>
      </div>`;
    container.hidden = false;
    btn.textContent = 'Hide content';
  } catch (err) {
    container.innerHTML = `<span class="preview-error">${escHtml(err.message ?? 'Error')}</span>`;
    container.hidden = false;
    btn.textContent = prev;
  } finally {
    btn.disabled = false;
  }
}

function prettyMaybeJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function renderCard(item) {
  const id = `card-${item.itemId}`;
  const isRetired = item.lifecycle === 'retired';
  const stored = localStorage.getItem(GRANT_KEY(item.itemId));

  const grantHtml = stored ? renderGrantBlock(JSON.parse(stored)) : '';

  let buyBtn = '';
  if (!isRetired) {
    buyBtn = `<button class="btn-buy" onclick="_buyItem('${escHtml(item.itemId)}', this)"
      ${stored ? 'disabled title="Already purchased"' : ''}>${stored ? 'Purchased' : 'Buy'}</button>`;
  }

  return `
    <div class="card${isRetired ? ' card-retired' : ''}" id="${escHtml(id)}">
      <div class="card-header">
        <div class="card-name">${escHtml(item.name || 'Untitled')}</div>
        <div class="card-badges">
          ${lifecycleBadge(item.lifecycle)}
          <span class="type-badge">${escHtml(item.contentType)}</span>
          <span class="price-badge">${formatPrice(item.payment)}</span>
        </div>
        <div class="card-desc">${escHtml(item.description)}</div>
        <div class="card-hash">
          <code title="${escHtml(item.itemId)}">${escHtml(truncate(item.itemId))}</code>
          <button class="copy-btn" onclick="_copyToClipboard('${escHtml(item.itemId)}', this)">Copy</button>
        </div>
        <div class="tags">${renderTags(item.tags)}</div>
      </div>

      <div class="card-actions">
        <button class="btn-details" onclick="_toggleDetails('${escHtml(item.itemId)}', this)">▼ Details</button>
        ${buyBtn}
      </div>

      <div class="details-panel" id="details-${escHtml(item.itemId)}" data-loaded="0"
        data-has-sample="${item.hasSample ? '1' : '0'}" data-content-type="${escHtml(item.contentType)}"></div>

      ${grantHtml}
    </div>`;
}

// ── Detail view (full item.jsonld + sample preview) ─────────────────────────────

async function _toggleDetails(itemId, btn) {
  const panel = document.getElementById(`details-${itemId}`);
  const isOpen = panel.classList.toggle('open');
  btn.textContent = isOpen ? '▲ Details' : '▼ Details';
  if (isOpen && panel.dataset.loaded === '0') {
    await loadDetails(itemId, panel);
  }
}

function renderItemDoc(doc) {
  // Render the item.jsonld document as flat key/value rows, skipping JSON-LD machinery.
  const skip = new Set(['@context', '@type']);
  return Object.entries(doc)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => {
      const value = typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v);
      return `
        <div class="detail-row">
          <span class="detail-label">${escHtml(k)}</span>
          <span class="detail-value">${escHtml(value)}</span>
        </div>`;
    })
    .join('');
}

async function loadDetails(itemId, panel) {
  panel.innerHTML = '<div class="status" style="padding:16px 0">Loading…</div>';
  try {
    const res = await fetch(
      `/api/catalog/${encodeURIComponent(_owner)}/items/${encodeURIComponent(itemId)}`,
    );
    const doc = await res.json();
    if (!res.ok) {
      panel.innerHTML = `<span class="preview-error">${escHtml(doc.error ?? 'Failed to load item')}</span>`;
      return;
    }

    let html = renderItemDoc(doc);
    if (panel.dataset.hasSample === '1') {
      html += renderSample(itemId, panel.dataset.contentType);
    }
    panel.innerHTML = html;
    panel.dataset.loaded = '1';
  } catch (err) {
    panel.innerHTML = `<span class="preview-error">${escHtml(err.message ?? 'Error')}</span>`;
  }
}

function renderSample(itemId, contentType) {
  const url = `/api/catalog/${encodeURIComponent(_owner)}/items/${encodeURIComponent(itemId)}/sample`;
  const body =
    contentType === 'image'
      ? `<img class="content-image" src="${url}" alt="sample preview" />`
      : `<pre class="preview-text" id="sample-${escHtml(itemId)}">Loading sample…</pre>`;
  const out = `
    <div class="sample-block">
      <div class="sample-label">Sample / Preview — not the full asset</div>
      ${body}
    </div>`;
  if (contentType !== 'image') {
    // Defer text fetch until after the element is in the DOM.
    setTimeout(() => loadTextSample(itemId, url), 0);
  }
  return out;
}

async function loadTextSample(itemId, url) {
  const el = document.getElementById(`sample-${itemId}`);
  if (!el) return;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      el.textContent = `Sample unavailable (${res.status})`;
      return;
    }
    const buf = await res.arrayBuffer();
    const slice = buf.slice(0, TEXT_PREVIEW_BYTES);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    el.textContent =
      text +
      (buf.byteLength > TEXT_PREVIEW_BYTES ? `\n\n…[first ${TEXT_PREVIEW_BYTES} bytes]` : '');
  } catch (err) {
    el.textContent = err.message ?? 'Error loading sample';
  }
}

// ── Purchase ────────────────────────────────────────────────────────────────

async function _buyItem(itemId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Buying…';

  const card = document.getElementById(`card-${itemId}`);
  const existing = card.querySelector('.buy-result');
  if (existing) existing.remove();

  try {
    const res = await fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherUrl: _publisherUrl, itemId }),
    });
    const data = await res.json();

    if (res.ok) {
      localStorage.setItem(GRANT_KEY(itemId), JSON.stringify(data));
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderGrantBlock(data);
      card.appendChild(wrapper.firstElementChild);
      btn.disabled = true;
      btn.textContent = 'Purchased';
      btn.title = 'Already purchased';
    } else {
      const resultEl = document.createElement('div');
      resultEl.className = 'buy-result error';
      resultEl.textContent = data.error ?? 'Purchase failed';
      card.appendChild(resultEl);
      btn.disabled = false;
      btn.textContent = 'Buy';
    }
  } catch (err) {
    const resultEl = document.createElement('div');
    resultEl.className = 'buy-result error';
    resultEl.textContent = err.message ?? 'Network error';
    card.appendChild(resultEl);
    btn.disabled = false;
    btn.textContent = 'Buy';
  }
}

// ── Collection-level catalog metadata (catalog.jsonld) ──────────────────────────

function renderCatalogMeta(meta) {
  const el = document.getElementById('catalog-meta');
  if (!el) return;
  const hasContent = meta && (meta.name || meta.description || meta.license);
  if (!hasContent) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  const parts = [];
  if (meta.name) parts.push(`<h2 class="catalog-meta-name">${escHtml(meta.name)}</h2>`);
  if (meta.description) parts.push(`<p class="catalog-meta-desc">${escHtml(meta.description)}</p>`);
  if (meta.license) {
    const lic = String(meta.license);
    const licHtml = /^https?:\/\//.test(lic)
      ? `<a href="${escHtml(lic)}" target="_blank" rel="noopener noreferrer">${escHtml(lic)}</a>`
      : escHtml(lic);
    parts.push(`<div class="catalog-meta-license">License: ${licHtml}</div>`);
  }
  el.innerHTML = parts.join('');
  el.hidden = false;
}

async function loadCatalogMeta(owner) {
  try {
    const res = await fetch(`/api/catalog/${encodeURIComponent(owner)}/meta`);
    renderCatalogMeta(res.ok ? await res.json() : null);
  } catch {
    renderCatalogMeta(null);
  }
}

// ── Catalog loading ───────────────────────────────────────────────────────────

async function loadCatalogue() {
  _owner = document.getElementById('feed-owner').value.trim();
  _publisherUrl = document.getElementById('publisher-url').value.trim() || 'http://localhost:3000';
  const btn = document.getElementById('load-btn');

  if (!_owner) {
    setStatus('Please enter the Catalog Feed Owner.', true);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  setStatus('Resolving catalog feed → Mantaray → items…');

  try {
    const res = await fetch(`/api/catalog/${encodeURIComponent(_owner)}/items`);
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error ?? 'Failed to load catalog', true);
      return;
    }

    const items = Array.isArray(data) ? data : [];
    if (items.length === 0) {
      setStatus('Catalog is empty — no items found.');
      return;
    }

    const grid = document.getElementById('grid');
    grid.innerHTML = items.map((item) => renderCard(item)).join('');
    grid.hidden = false;
    document.getElementById('status').hidden = true;

    loadCatalogMeta(_owner);

    const badge = document.getElementById('count-badge');
    badge.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
    badge.hidden = false;
  } catch (err) {
    setStatus(err.message ?? 'Network error', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load Catalog';
  }
}

document.getElementById('load-btn').addEventListener('click', loadCatalogue);
document.getElementById('feed-owner').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadCatalogue();
});

async function init() {
  await loadConfig();

  const params = new URLSearchParams(window.location.search);
  const ownerParam = params.get('owner');
  const publisherParam = params.get('publisher') ?? params.get('x402');

  if (ownerParam) document.getElementById('feed-owner').value = ownerParam;
  if (publisherParam) document.getElementById('publisher-url').value = publisherParam;

  if (ownerParam) {
    loadCatalogue();
  } else {
    document.getElementById('settings-panel').classList.add('open');
    document.getElementById('settings-toggle').textContent = '▲ Settings';
  }
}

init();
