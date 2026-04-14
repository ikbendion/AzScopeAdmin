// AzScopeAdmin — Renderer process
// All Azure/Graph calls go through window.api (defined in preload.js).
// No direct network access from the renderer.

let selectedSP = null;
let pendingScopes = [];
let debounceTimer = null;

// ── Boot ───────────────────────────────────────────────────────────────────

async function init() {
  document.getElementById('portal-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps');
  });

  const config = await window.api.getConfig();
  if (!config?.clientId || config.clientId === 'YOUR_CLIENT_ID') {
    showSetupPage();
    return;
  }

  showPage('signin');
  bindSignIn();
}

// ── Setup page ─────────────────────────────────────────────────────────────

function showSetupPage() {
  showPage('setup');

  document.getElementById('save-config-btn').onclick = async () => {
    const clientId = document.getElementById('input-client-id').value.trim();
    const tenantId = document.getElementById('input-tenant-id').value.trim();
    const err = document.getElementById('setup-error');

    if (!isGuid(clientId) || !isGuid(tenantId)) {
      err.textContent = 'Both fields must be valid GUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).';
      err.classList.remove('hidden');
      return;
    }

    err.classList.add('hidden');
    await window.api.saveConfig({ clientId, tenantId });
    showPage('signin');
    bindSignIn();
  };
}

// ── Sign-in page ───────────────────────────────────────────────────────────

function bindSignIn() {
  document.getElementById('sign-in-btn').onclick = signIn;
  document.getElementById('reconfigure-btn').onclick = () => {
    window.api.logout();
    showSetupPage();
  };
}

async function signIn() {
  const btn = document.getElementById('sign-in-btn');
  btn.disabled = true;
  btn.textContent = 'Opening browser…';

  const result = await window.api.login();
  if (!result.ok) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="21" height="21" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg> Sign in with Microsoft`;
    showToast('Sign-in failed: ' + result.error);
    return;
  }

  document.getElementById('user-name').textContent = result.name;
  document.getElementById('user-area').classList.remove('hidden');
  document.getElementById('sign-out-btn').onclick = signOut;

  // Pre-warm Graph SP cache
  window.api.loadGraphSP().catch(() => {});

  goSearch();
}

async function signOut() {
  await window.api.logout();
  document.getElementById('user-area').classList.add('hidden');
  document.getElementById('user-name').textContent = '';
  showPage('signin');
  bindSignIn();
  // Reset sign-in button
  document.getElementById('sign-in-btn').disabled = false;
  document.getElementById('sign-in-btn').innerHTML = `<svg width="21" height="21" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg> Sign in with Microsoft`;
}

// ── Search page ────────────────────────────────────────────────────────────

function goSearch() {
  showPage('search');
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-hint').style.display = '';

  // Replace input to drop stale listeners
  const old = document.getElementById('search-input');
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);

  fresh.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const term = fresh.value.trim();
    if (term.length < 2) {
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('search-hint').style.display = '';
      document.getElementById('search-spinner').classList.remove('active');
      return;
    }
    document.getElementById('search-hint').style.display = 'none';
    document.getElementById('search-spinner').classList.add('active');
    debounceTimer = setTimeout(() => runSearch(term), 320);
  });

  fresh.focus();
}

async function runSearch(term) {
  try {
    const items = await window.api.searchSPs(term);
    renderResults(items);
  } catch (e) {
    showToast('Search failed: ' + e.message);
    document.getElementById('search-results').innerHTML = '';
  } finally {
    document.getElementById('search-spinner').classList.remove('active');
  }
}

function renderResults(items) {
  const container = document.getElementById('search-results');
  if (!items.length) {
    container.innerHTML = '<p class="hint">No service principals found.</p>';
    return;
  }

  container.innerHTML = `<div class="result-list">${
    items.map((sp, i) => `
      <div class="result-item" data-idx="${i}" tabindex="0" role="button">
        <div class="result-avatar">${initials(sp.displayName)}</div>
        <div class="result-info">
          <div class="result-name">${esc(sp.displayName)}</div>
          <div class="result-id">${sp.id}</div>
        </div>
        <svg class="result-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    `).join('')
  }</div>`;

  container.querySelectorAll('.result-item').forEach(el => {
    const pick = () => goScopes(items[parseInt(el.dataset.idx)]);
    el.addEventListener('click', pick);
    el.addEventListener('keydown', e => e.key === 'Enter' && pick());
  });
}

// ── Scope assignment page ──────────────────────────────────────────────────

async function goScopes(sp) {
  selectedSP = sp;
  pendingScopes = [];

  document.getElementById('sp-name').textContent = sp.displayName;
  document.getElementById('sp-id').textContent = sp.id;
  document.getElementById('sp-avatar').textContent = initials(sp.displayName);
  document.getElementById('scope-input').value = '';
  document.getElementById('scope-suggestions').innerHTML = '';
  renderQueue();

  document.getElementById('back-to-search').onclick = goSearch;
  document.getElementById('add-scope-btn').onclick = addScope;
  document.getElementById('assign-btn').onclick = runAssign;

  const scopeInput = document.getElementById('scope-input');
  scopeInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addScope(); } };

  updateAssignBtn();
  showPage('scopes');
  scopeInput.focus();

  // Populate autocomplete from Graph AppRoles (background)
  window.api.loadGraphSP()
    .then(gsp => {
      const opts = gsp.appRoles
        .filter(r => r.isEnabled && r.allowedMemberTypes.includes('Application'))
        .sort((a, b) => a.value.localeCompare(b.value))
        .map(r => `<option value="${esc(r.value)}">`);
      document.getElementById('scope-suggestions').innerHTML = opts.join('');
    })
    .catch(() => {});
}

function addScope() {
  const input = document.getElementById('scope-input');
  const val = input.value.trim();
  if (!val) return;
  if (pendingScopes.includes(val)) {
    showToast(`'${val}' is already in the list.`);
    return;
  }
  pendingScopes.push(val);
  input.value = '';
  input.focus();
  renderQueue();
  updateAssignBtn();
}

function removeScope(scope) {
  pendingScopes = pendingScopes.filter(s => s !== scope);
  renderQueue();
  updateAssignBtn();
}

function renderQueue() {
  const el = document.getElementById('scope-queue');
  if (!pendingScopes.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <label class="field-label">Permissions to assign</label>
    <ul class="scope-queue-list">
      ${pendingScopes.map(scope => `
        <li class="scope-tag">
          <span class="scope-tag-name">${esc(scope)}</span>
          <button class="scope-tag-remove" data-scope="${esc(scope)}" title="Remove">×</button>
        </li>
      `).join('')}
    </ul>`;

  el.querySelectorAll('.scope-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeScope(btn.dataset.scope));
  });
}

function updateAssignBtn() {
  document.getElementById('assign-btn').disabled = pendingScopes.length === 0;
}

// ── Assign ─────────────────────────────────────────────────────────────────

async function runAssign() {
  const btn = document.getElementById('assign-btn');
  btn.disabled = true;
  btn.textContent = 'Assigning…';

  let gsp;
  try {
    gsp = await window.api.loadGraphSP();
  } catch (e) {
    showToast('Could not load Graph service principal: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Assign Permissions';
    return;
  }

  const results = [];
  for (const scope of pendingScopes) {
    const role = gsp.appRoles.find(
      r => r.value === scope && r.allowedMemberTypes.includes('Application') && r.isEnabled
    );
    if (!role) {
      results.push({ scope, ok: false, error: 'Not a valid application permission' });
      continue;
    }
    try {
      await window.api.assignScope({ spId: selectedSP.id, resourceId: gsp.id, appRoleId: role.id });
      results.push({ scope, ok: true });
    } catch (e) {
      results.push({ scope, ok: false, error: e.message });
    }
  }

  showResults(results);
}

// ── Results page ───────────────────────────────────────────────────────────

function showResults(results) {
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;

  const iconEl = document.getElementById('results-icon');
  iconEl.textContent = failed === 0 ? '✓' : failed === results.length ? '✗' : '⚠';
  iconEl.style.color = failed === 0 ? 'var(--success)' : failed === results.length ? 'var(--error)' : '#8a6800';

  document.getElementById('results-summary').textContent =
    `${succeeded} permission${succeeded !== 1 ? 's' : ''} assigned to ${selectedSP.displayName}` +
    (failed ? `, ${failed} failed` : '') + '.';

  document.getElementById('results-breakdown').innerHTML = results.map(r => `
    <li class="result-row ${r.ok ? 'ok' : 'fail'}">
      <span class="result-badge">${r.ok ? '✓' : '✗'}</span>
      <span class="result-scope">${esc(r.scope)}</span>
      ${r.error ? `<span class="result-err">${esc(r.error)}</span>` : ''}
    </li>
  `).join('');

  const portalUrl = `https://portal.azure.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/Overview` +
    `/objectId/${selectedSP.id}/appId/${selectedSP.appId}` +
    `/preferredSingleSignOnMode~/null/servicePrincipalType/ManagedIdentity/fromNav/`;

  document.getElementById('open-portal-btn').onclick = () => window.api.openExternal(portalUrl);
  document.getElementById('new-assignment-btn').onclick = () => {
    selectedSP = null;
    pendingScopes = [];
    goSearch();
  };

  showPage('results');
}

// ── Utilities ──────────────────────────────────────────────────────────────

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
}

function initials(name) {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

function isGuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 5000);
}

init().catch(console.error);
