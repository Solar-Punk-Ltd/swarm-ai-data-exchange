const GRANT_KEY = (swarmHash) => `cfb_grant_${swarmHash}`;

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
  } catch {
    // non-fatal
  }
}

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

function _copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
  });
}

function renderTags(tags) {
  if (!tags || tags.length === 0) {
    return '<span class="tag empty">no tags</span>';
  }
  return tags.map((t) => `<span class="tag">${escHtml(String(t))}</span>`).join('');
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      </div>
    `,
    )
    .join('');
}

// Renders the "Access Granted" block. grant = ActGrantResult + displayName.
function renderGrantBlock(grant) {
  const a = (v) => escHtml(v ?? '');
  return `
    <div class="buy-result success">
      <div class="buy-result-title">✓ Access Granted</div>
      ${[
        ['Swarm Hash', grant.swarmHash],
        ['ACT History Address', grant.actHistoryAddress],
        ['Grantee Ref', grant.granteeRef],
        ['Publisher Public Key', grant.publisherPublickey],
      ]
        .map(
          ([label, value]) => `
        <div class="detail-row">
          <span class="detail-label">${label}</span>
          <span class="detail-value">${a(value)}</span>
        </div>
      `,
        )
        .join('')}
      <div class="view-download-row">
        <button class="btn-view-download"
          data-swarm-hash="${a(grant.swarmHash)}"
          data-act-history-address="${a(grant.actHistoryAddress)}"
          data-publisher-publickey="${a(grant.publisherPublickey)}"
          data-display-name="${a(grant.displayName)}"
          onclick="_viewDownload(this)">↓ View / Download</button>
      </div>
      <div class="content-preview"></div>
    </div>
  `;
}

function renderCard(item, serverUrl) {
  const id = `card-${item.swarmHash}`;

  // Restore persisted grant from localStorage if present
  const stored = localStorage.getItem(GRANT_KEY(item.swarmHash));
  const grantHtml = stored
    ? renderGrantBlock({ ...JSON.parse(stored), displayName: item.displayName })
    : '';

  return `
    <div class="card" id="${escHtml(id)}" data-display-name="${escHtml(item.displayName || '')}">
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
        <button class="btn-buy" onclick="_buyItem('${escHtml(item.swarmHash)}', '${escHtml(serverUrl)}', this)">Buy</button>
      </div>

      <div class="details-panel" id="details-${escHtml(item.swarmHash)}">
        ${renderDetailRows(item)}
      </div>

      ${grantHtml}
    </div>
  `;
}

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

  try {
    const res = await fetch('/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swarmHash, serverUrl }),
    });
    const data = await res.json();

    if (res.ok) {
      const grant = { ...data, displayName };
      localStorage.setItem(GRANT_KEY(swarmHash), JSON.stringify(grant));
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderGrantBlock(grant);
      card.appendChild(wrapper.firstElementChild);
    } else {
      const resultEl = document.createElement('div');
      resultEl.className = 'buy-result error';
      resultEl.textContent = data.error ?? 'Purchase failed';
      card.appendChild(resultEl);
    }
  } catch (err) {
    const resultEl = document.createElement('div');
    resultEl.className = 'buy-result error';
    resultEl.textContent = err.message ?? 'Network error';
    card.appendChild(resultEl);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buy';
  }
}

async function _viewDownload(btn) {
  const swarmHash = btn.dataset.swarmHash;
  const actHistoryAddress = btn.dataset.actHistoryAddress;
  const publisherPublickey = btn.dataset.publisherPublickey;
  const displayName = btn.dataset.displayName || swarmHash;

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner" style="border-color:rgba(0,0,0,.3);border-top-color:#000"></span>Fetching…';

  const preview = btn.closest('.buy-result').querySelector('.content-preview');
  preview.innerHTML = '';

  try {
    const params = new URLSearchParams({ swarmHash, actHistoryAddress, publisherPublickey });
    const res = await fetch(`/api/download?${params}`);

    if (!res.ok) {
      const err = await res.json();
      preview.innerHTML = `<span class="preview-error">${escHtml(err.error ?? 'Download failed')}</span>`;
      btn.disabled = false;
      btn.textContent = '↓ View / Download';
      return;
    }

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    if (contentType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = objectUrl;
      img.className = 'content-image';
      img.alt = displayName;
      img.onload = () => URL.revokeObjectURL(objectUrl);
      preview.appendChild(img);
      btn.remove();
    } else {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = displayName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      btn.disabled = false;
      btn.textContent = '↓ Downloaded';
    }
  } catch (err) {
    preview.innerHTML = `<span class="preview-error">${escHtml(err.message ?? 'Error')}</span>`;
    btn.disabled = false;
    btn.textContent = '↓ View / Download';
  }
}

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

  try {
    const params = new URLSearchParams({ feedOwner, feedTopic });
    const res = await fetch(`/api/catalogue?${params}`);
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error ?? 'Failed to load catalogue', true);
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
    btn.textContent = 'Load Catalogue';
  }
}

document.getElementById('load-btn').addEventListener('click', loadCatalogue);
document.getElementById('feed-topic').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadCatalogue();
});

loadConfig();
