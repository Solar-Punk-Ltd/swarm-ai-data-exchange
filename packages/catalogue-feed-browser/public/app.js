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

function renderCard(item, serverUrl) {
  const id = `card-${item.swarmHash}`;
  return `
    <div class="card" id="${escHtml(id)}">
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

  try {
    const res = await fetch('/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swarmHash, serverUrl }),
    });
    const data = await res.json();

    const resultEl = document.createElement('div');
    resultEl.className = 'buy-result';

    if (res.ok) {
      resultEl.classList.add('success');
      resultEl.innerHTML = `
        <div class="buy-result-title">✓ Access Granted</div>
        ${[
          ['Swarm Hash', data.swarmHash],
          ['ACT History Address', data.actHistoryAddress],
          ['Grantee Ref', data.granteeRef],
          ['Publisher Public Key', data.publisherPublickey],
        ]
          .map(
            ([label, value]) => `
          <div class="detail-row">
            <span class="detail-label">${label}</span>
            <span class="detail-value">${escHtml(value ?? '')}</span>
          </div>
        `,
          )
          .join('')}
      `;
    } else {
      resultEl.classList.add('error');
      resultEl.textContent = data.error ?? 'Purchase failed';
    }

    card.appendChild(resultEl);
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
