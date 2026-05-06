const GRANT_KEY = (swarmHash) => `cfb_grant_${swarmHash}`;
const TEXT_PREVIEW_BYTES = 2000;

// ── Config & init ─────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.defaultFeedOwner)
      document.getElementById('feed-owner').value = config.defaultFeedOwner;
    if (config.defaultFeedTopic)
      document.getElementById('feed-topic').value = config.defaultFeedTopic;
    if (config.defaultServerUrl)
      document.getElementById('server-url').value = config.defaultServerUrl;
    if (config.defaultBeeUrl) {
      document.getElementById('bee-url').value = config.defaultBeeUrl;
      fetchBeePublicKey(config.defaultBeeUrl);
    }
  } catch {
    // non-fatal
  }
}

async function fetchBeePublicKey(beeUrl) {
  const pkField = document.getElementById('bee-public-key');
  pkField.readOnly = true;
  pkField.placeholder = 'Fetching…';
  try {
    const res = await fetch(`/api/bee-public-key?beeUrl=${encodeURIComponent(beeUrl)}`);
    const data = await res.json();
    if (data.publicKey) {
      pkField.value = data.publicKey;
      pkField.readOnly = true;
    } else {
      pkField.value = '';
      pkField.readOnly = false;
      pkField.placeholder = 'Could not fetch — enter manually';
    }
  } catch {
    pkField.value = '';
    pkField.readOnly = false;
    pkField.placeholder = 'Could not fetch — enter manually';
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
}

function truncate(str, len = 20) {
  if (!str) return '';
  return str.length > len * 2 + 3 ? str.slice(0, len) + '…' + str.slice(-len) : str;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extracts `mime_type` from a DataItem metadata array.
 * Handles entries that are objects with a `mime_type` key.
 */
function getMimeType(metadata) {
  if (!Array.isArray(metadata)) return '';
  for (const m of metadata) {
    if (m && typeof m === 'object' && 'mime_type' in m) return String(m.mime_type);
  }
  return '';
}

/**
 * Detects MIME type from the leading magic bytes of an ArrayBuffer.
 * Returns null if no known signature is found.
 */
function detectMimeType(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  // PNG  89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  // JPEG  FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // GIF   47 49 46 38
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // WebP  RIFF….WEBP
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp';
  // BMP   42 4D
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  // AVIF/HEIC  …ftyp at offset 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  return null;
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

// ── Rendering helpers ─────────────────────────────────────────────────────────

function renderTags(tags) {
  if (!tags || tags.length === 0) return '<span class="tag empty">no tags</span>';
  return tags.map((t) => `<span class="tag">${escHtml(String(t))}</span>`).join('');
}

function renderDetailRows(item) {
  const rows = [
    { label: 'ACT History Ref', value: item.actHistoryRef },
    { label: 'Grantee Ref', value: item.granteeRef },
    { label: 'Scheme Version', value: window._catalogueVersion ?? '' },
  ];

  const metaRows =
    item.metadata && item.metadata.length > 0
      ? item.metadata.map((m, i) => ({ label: `Metadata [${i}]`, value: JSON.stringify(m) }))
      : [{ label: 'Metadata', value: 'none' }];

  return [...rows, ...metaRows]
    .filter((r) => r.value)
    .map(
      (r) => `
      <div class="detail-row">
        <span class="detail-label">${escHtml(r.label)}</span>
        <span class="detail-value">${escHtml(r.value)}</span>
      </div>`,
    )
    .join('');
}

/**
 * Renders the "Access Granted" block.
 * grant = ActGrantResult + displayName + mimeType.
 */
function renderGrantBlock(grant) {
  const a = (v) => escHtml(v ?? '');
  const dataAttrs = `
    data-swarm-hash="${a(grant.swarmHash)}"
    data-act-history-address="${a(grant.actHistoryAddress)}"
    data-publisher-publickey="${a(grant.publisherPublickey)}"
    data-display-name="${a(grant.displayName)}"
    data-mime-type="${a(grant.mimeType)}"
  `;
  return `
    <div class="buy-result success">
      <div class="buy-result-title">✓ Access Granted</div>
      ${[
        ['ACT History Address', grant.actHistoryAddress],
        ['Grantee Ref', grant.granteeRef],
        ['Publisher Public Key', grant.publisherPublickey],
        ...(grant.beePublicKey ? [['Buyer Public Key', grant.beePublicKey]] : []),
      ]
        .map(
          ([label, value]) => `
        <div class="detail-row">
          <span class="detail-label">${label}</span>
          <span class="detail-value">${a(value)}</span>
        </div>`,
        )
        .join('')}
      <div class="view-download-row">
        <button class="btn-view" ${dataAttrs} onclick="_viewContent(this)">👁 View</button>
        <button class="btn-download" ${dataAttrs} onclick="_downloadContent(this)">↓ Download</button>
      </div>
      <div class="content-preview"></div>
    </div>`;
}

function renderCard(item, serverUrl) {
  const id = `card-${item.swarmHash}`;
  const mimeType = getMimeType(item.metadata);

  // Restore persisted grant from localStorage if present
  const stored = localStorage.getItem(GRANT_KEY(item.swarmHash));
  const grantHtml = stored
    ? renderGrantBlock({
        ...JSON.parse(stored),
        displayName: item.displayName,
        mimeType: mimeType || JSON.parse(stored).mimeType || '',
      })
    : '';

  return `
    <div class="card" id="${escHtml(id)}"
      data-display-name="${escHtml(item.displayName || '')}"
      data-mime-type="${escHtml(mimeType)}">
      <div class="card-header">
        <div class="card-name">${escHtml(item.displayName || 'Untitled')}</div>
        <div class="card-hash">
          <code title="${escHtml(item.swarmHash)}">${escHtml(truncate(item.swarmHash, 16))}</code>
          <button class="copy-btn" onclick="_copyToClipboard('${escHtml(item.swarmHash)}', this)">Copy</button>
        </div>
        <div class="tags">${renderTags(item.tags)}</div>
      </div>

      <div class="card-actions">
        <button class="btn-details" onclick="_toggleDetails('${escHtml(item.swarmHash)}')">▼ Details</button>
        <button class="btn-buy" onclick="_buyItem('${escHtml(item.swarmHash)}', '${escHtml(serverUrl)}', this)"
          ${stored ? 'disabled title="Already purchased"' : ''}>${stored ? 'Purchased' : 'Buy'}</button>
      </div>

      <div class="details-panel" id="details-${escHtml(item.swarmHash)}">
        ${renderDetailRows(item)}
      </div>

      ${grantHtml}
    </div>`;
}

// ── Card interactions ─────────────────────────────────────────────────────────

function _toggleDetails(swarmHash) {
  const panel = document.getElementById(`details-${swarmHash}`);
  const btn = panel.previousElementSibling.querySelector('.btn-details');
  const isOpen = panel.classList.toggle('open');
  btn.textContent = isOpen ? '▲ Details' : '▼ Details';
}

async function _buyItem(swarmHash, serverUrl, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Buying…';

  const card = document.getElementById(`card-${swarmHash}`);
  const existing = card.querySelector('.buy-result');
  if (existing) existing.remove();

  const displayName = card.dataset.displayName || swarmHash;
  const mimeType = card.dataset.mimeType || '';

  const beeUrl = document.getElementById('bee-url').value.trim();
  const publicKey = document.getElementById('bee-public-key').value.trim();

  try {
    const res = await fetch('/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swarmHash, serverUrl, beeUrl, publicKey }),
    });
    const data = await res.json();

    if (res.ok) {
      const grant = { ...data, displayName, mimeType };
      localStorage.setItem(GRANT_KEY(swarmHash), JSON.stringify(grant));
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderGrantBlock(grant);
      card.appendChild(wrapper.firstElementChild);
      // Explicitly disable and re-label the Buy button (access already granted)
      btn.disabled = true;
      btn.textContent = 'Purchased';
      btn.title = 'Already purchased';
      return;
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

// ── Download helpers ──────────────────────────────────────────────────────────

function _downloadParams(btn) {
  return new URLSearchParams({
    swarmHash: btn.dataset.swarmHash,
    actHistoryAddress: btn.dataset.actHistoryAddress,
    publisherPublickey: btn.dataset.publisherPublickey,
  });
}

function _previewEl(btn) {
  return btn.closest('.buy-result').querySelector('.content-preview');
}

/**
 * View button — fetches content and renders it inline.
 * Images are displayed as <img>; everything else shows the first TEXT_PREVIEW_BYTES
 * decoded as UTF-8 in a <pre>.
 */
async function _viewContent(btn) {
  const displayName = btn.dataset.displayName || btn.dataset.swarmHash;
  const metaMime = btn.dataset.mimeType || '';

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner" style="border-color:rgba(255,255,255,.3);border-top-color:#fff"></span>Loading…';

  const preview = _previewEl(btn);
  preview.innerHTML = '';

  try {
    const res = await fetch(`/api/download?${_downloadParams(btn)}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      preview.innerHTML = `<span class="preview-error">${escHtml(err.error ?? `HTTP ${res.status}`)}</span>`;
      btn.disabled = false;
      btn.textContent = '👁 View';
      return;
    }

    // Read body once; we need bytes for both magic-number detection and rendering
    const buffer = await res.arrayBuffer();
    const headerType = res.headers.get('content-type') || 'application/octet-stream';

    // Priority: metadata mime_type → magic bytes → Content-Type header
    const contentType = metaMime || detectMimeType(buffer) || headerType;

    if (contentType.startsWith('image/')) {
      const blob = new Blob([buffer], { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = objectUrl;
      img.className = 'content-image';
      img.alt = displayName;
      img.onload = () => URL.revokeObjectURL(objectUrl);
      preview.appendChild(img);
      btn.remove(); // image is self-explanatory; hide the View button
    } else {
      // Show first TEXT_PREVIEW_BYTES bytes decoded as UTF-8
      const slice = buffer.slice(0, TEXT_PREVIEW_BYTES);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      const truncated = buffer.byteLength > TEXT_PREVIEW_BYTES;

      const pre = document.createElement('pre');
      pre.className = 'preview-text';
      pre.textContent =
        text + (truncated ? `\n\n…[showing first ${TEXT_PREVIEW_BYTES} bytes]` : '');
      preview.innerHTML = '';
      preview.appendChild(pre);

      btn.disabled = false;
      btn.textContent = '👁 View';
    }
  } catch (err) {
    preview.innerHTML = `<span class="preview-error">${escHtml(err.message ?? 'Error')}</span>`;
    btn.disabled = false;
    btn.textContent = '👁 View';
  }
}

/**
 * Download button — fetches content and triggers a browser file download
 * using displayName as the filename.
 */
async function _downloadContent(btn) {
  const displayName = btn.dataset.displayName || btn.dataset.swarmHash;

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner" style="border-color:rgba(0,0,0,.3);border-top-color:#000"></span>Downloading…';

  const preview = _previewEl(btn);

  try {
    const res = await fetch(`/api/download?${_downloadParams(btn)}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      preview.innerHTML = `<span class="preview-error">${escHtml(err.error ?? `HTTP ${res.status}`)}</span>`;
      btn.disabled = false;
      btn.textContent = '↓ Download';
      return;
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = displayName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);

    btn.disabled = false;
    btn.textContent = '✓ Downloaded';
    setTimeout(() => {
      btn.textContent = '↓ Download';
    }, 3000);
  } catch (err) {
    preview.innerHTML = `<span class="preview-error">${escHtml(err.message ?? 'Error')}</span>`;
    btn.disabled = false;
    btn.textContent = '↓ Download';
  }
}

// ── Catalogue loading ─────────────────────────────────────────────────────────

async function loadCatalogue() {
  const feedOwner = document.getElementById('feed-owner').value.trim();
  const feedTopic = document.getElementById('feed-topic').value.trim();
  const serverUrl = document.getElementById('server-url').value.trim() || 'http://localhost:3000';
  const btn = document.getElementById('load-btn');

  if (!feedOwner || !feedTopic) {
    setStatus('Please enter both Feed Owner and Feed Topic.', true);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  setStatus('Fetching catalogue from Swarm feed…');

  const beeUrl = document.getElementById('bee-url').value.trim();

  try {
    const params = new URLSearchParams({ feedOwner, feedTopic });
    if (beeUrl) params.set('beeUrl', beeUrl);
    const res = await fetch(`/api/catalogue?${params}`);
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error ?? 'Failed to load catalog', true);
      return;
    }

    window._catalogueVersion = data.schemeVersion;
    const items = data.dataItems ?? [];

    if (items.length === 0) {
      setStatus('Catalogue is empty — no items found.');
      return;
    }

    const grid = document.getElementById('grid');
    grid.innerHTML = items.map((item) => renderCard(item, serverUrl)).join('');
    grid.hidden = false;

    document.getElementById('status').hidden = true;

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
document.getElementById('feed-topic').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadCatalogue();
});
document.getElementById('bee-url').addEventListener('change', () => {
  const beeUrl = document.getElementById('bee-url').value.trim();
  const pkField = document.getElementById('bee-public-key');
  if (beeUrl) {
    fetchBeePublicKey(beeUrl);
  } else {
    pkField.value = '';
    pkField.readOnly = false;
    pkField.placeholder = 'Enter public key manually';
  }
});

async function init() {
  await loadConfig(); // apply .env defaults first

  // URL params override defaults: ?owner=...&x402=...
  const params = new URLSearchParams(window.location.search);
  const ownerParam = params.get('owner');
  const x402Param = params.get('x402');

  if (ownerParam) document.getElementById('feed-owner').value = ownerParam;
  if (x402Param) document.getElementById('server-url').value = x402Param;

  if (ownerParam || x402Param) {
    // Params supplied via URL — keep settings collapsed and load immediately
    loadCatalogue();
  } else {
    // No URL params — show settings so the user can fill them in
    document.getElementById('settings-panel').classList.add('open');
    document.getElementById('settings-toggle').textContent = '▲ Settings';
  }
}

init();
