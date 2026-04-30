let state = { active_profile_id: '', profiles: [] };

async function apiRequest(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '请求失败');
  }
  return res.json();
}

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t ?? '';
  return d.innerHTML;
}

function openEditor(profile = null) {
  document.getElementById('editorModal').classList.remove('hidden');
  document.getElementById('editorModal').classList.add('flex');
  document.getElementById('validateResult').textContent = '';
  if (!profile) {
    document.getElementById('editorTitle').textContent = '新增配置';
    document.getElementById('profileId').value = '';
    document.getElementById('name').value = '';
    document.getElementById('provider').value = 'openai';
    document.getElementById('api_key').value = '';
    document.getElementById('base_url').value = 'https://api.openai.com/v1';
    document.getElementById('model').value = 'gpt-4o-mini';
    document.getElementById('max_tokens').value = 4096;
    return;
  }
  document.getElementById('editorTitle').textContent = '编辑配置';
  document.getElementById('profileId').value = profile.id;
  document.getElementById('name').value = profile.name || '';
  document.getElementById('provider').value = profile.provider || 'openai';
  document.getElementById('api_key').value = profile.api_key || '';
  document.getElementById('base_url').value = profile.base_url || '';
  document.getElementById('model').value = profile.model || '';
  document.getElementById('max_tokens').value = profile.max_tokens || 4096;
}

function closeEditor() {
  document.getElementById('editorModal').classList.add('hidden');
  document.getElementById('editorModal').classList.remove('flex');
}

function getFormPayload() {
  return {
    name: document.getElementById('name').value.trim(),
    provider: document.getElementById('provider').value,
    api_key: document.getElementById('api_key').value.trim(),
    base_url: document.getElementById('base_url').value.trim(),
    model: document.getElementById('model').value.trim(),
    max_tokens: parseInt(document.getElementById('max_tokens').value || '4096', 10),
  };
}

async function saveProfile(e) {
  e.preventDefault();
  const id = document.getElementById('profileId').value;
  const payload = getFormPayload();
  if (!payload.name || !payload.api_key || !payload.model) {
    alert('请填写完整名称/API Key/Model');
    return;
  }
  if (id) {
    state = await apiRequest(`/api/settings/llm/profiles/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    state = await apiRequest('/api/settings/llm/profiles', { method: 'POST', body: JSON.stringify(payload) });
  }
  renderCards();
  closeEditor();
}

async function validateFromEditor() {
  const payload = getFormPayload();
  const res = await apiRequest('/api/settings/llm/validate', { method: 'POST', body: JSON.stringify(payload) });
  const box = document.getElementById('validateResult');
  if (res.ok) {
    box.className = 'text-sm text-green-600';
    box.textContent = `✅ ${res.message}（${res.latency_ms || '-'}ms）`;
  } else {
    box.className = 'text-sm text-red-600';
    box.textContent = `❌ ${res.message}（${res.latency_ms || '-'}ms）`;
  }
}

async function switchProfile(id) {
  state = await apiRequest(`/api/settings/llm/active/${id}`, { method: 'PUT' });
  renderCards();
  await refreshRuntime();
}

async function checkProfile(id) {
  state = await apiRequest(`/api/settings/llm/profiles/${id}/check`, { method: 'POST' });
  renderCards();
  const p = (state.profiles || []).find(x => x.id === id);
  const r = (p && p.last_check) ? p.last_check : null;
  if (r) {
    alert(r.ok ? `检查成功：${r.message}${r.latency_ms ? `（${r.latency_ms}ms）` : ''}` : `检查失败：${r.message}`);
  } else {
    alert('检查已完成，但未返回状态信息');
  }
}

async function toggleEnabled(id, enabled) {
  state = await apiRequest(`/api/settings/llm/profiles/${id}/meta`, { method: 'PUT', body: JSON.stringify({ enabled }) });
  renderCards();
}

async function saveTags(id) {
  const el = document.getElementById(`tags-${id}`);
  const tags = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
  state = await apiRequest(`/api/settings/llm/profiles/${id}/meta`, { method: 'PUT', body: JSON.stringify({ tags }) });
  renderCards();
}

async function removeProfile(id) {
  if (!confirm('确定删除该配置吗？')) return;
  state = await apiRequest(`/api/settings/llm/profiles/${id}`, { method: 'DELETE' });
  renderCards();
}

function renderCards() {
  const box = document.getElementById('profileCards');
  const active = state.active_profile_id;
  const profiles = state.profiles || [];
  if (!profiles.length) {
    box.innerHTML = '<p class="text-sm text-gray-500">暂无配置</p>';
    return;
  }
  box.innerHTML = profiles.map(p => {
    const isActive = p.id === active;
    const enabled = p.enabled !== false;
    const check = p.last_check || {};
    const checkText = check.ok === true ? `可用 ${check.latency_ms || '-'}ms` : (check.message || '未检查');
    return `
      <div class="border rounded p-3 ${isActive ? 'ring-2 ring-indigo-300 bg-indigo-50' : 'bg-white'}">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-gray-800">${esc(p.name || '未命名配置')}</div>
          <div class="flex gap-1">
            ${isActive ? '<span class="px-2 py-0.5 text-xs rounded bg-indigo-50 text-indigo-700">当前</span>' : ''}
            <span class="px-2 py-0.5 text-xs rounded ${enabled ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}">${enabled ? '启用' : '禁用'}</span>
          </div>
        </div>
        <div class="text-xs text-gray-600 mt-1">${esc((p.provider || '') + ' / ' + (p.model || ''))}</div>
        <div class="text-xs text-gray-500 break-all mt-1">${esc(p.base_url || '')}</div>
        <div class="mt-2 text-xs ${check.ok ? 'text-green-700' : 'text-gray-700'}">${esc(checkText)}</div>
        <div class="mt-2 flex flex-wrap gap-1">
          <button onclick="openEditorById('${p.id}')" class="px-2 py-1 text-xs border rounded">编辑</button>
          <button onclick="checkProfile('${p.id}')" class="px-2 py-1 text-xs border rounded">检查</button>
          ${!isActive ? `<button onclick="switchProfile('${p.id}')" class="px-2 py-1 text-xs bg-indigo-600 text-white rounded">切换</button>` : ''}
          <button onclick="toggleEnabled('${p.id}', ${enabled ? 'false' : 'true'})" class="px-2 py-1 text-xs border rounded">${enabled ? '禁用' : '启用'}</button>
          ${!isActive ? `<button onclick="removeProfile('${p.id}')" class="px-2 py-1 text-xs border rounded text-red-600">删除</button>` : ''}
        </div>
        <div class="mt-2 flex gap-1">
          <input id="tags-${p.id}" value="${esc((p.tags || []).join(','))}" class="flex-1 px-2 py-1 border rounded text-xs" placeholder="标签，逗号分隔">
          <button onclick="saveTags('${p.id}')" class="px-2 py-1 text-xs border rounded">存标签</button>
        </div>
      </div>
    `;
  }).join('');
}

function openEditorById(id) {
  const p = (state.profiles || []).find(x => x.id === id);
  openEditor(p || null);
}

async function refreshRuntime() {
  const data = await apiRequest('/api/settings/llm/runtime');
  const box = document.getElementById('runtimeBadge');
  box.textContent = `运行时：${data.runtime_provider}/${data.runtime_model} | ${data.runtime_base_url} | 一致性：${data.is_consistent ? '是' : '否'}`;
}

async function refreshLogs() {
  const data = await apiRequest('/api/settings/llm/call-logs?limit=30');
  const logs = data.logs || [];
  const box = document.getElementById('callLogs');
  if (!logs.length) {
    box.innerHTML = '<p class="text-gray-500 italic">暂无日志</p>';
    return;
  }
  box.innerHTML = logs.map(l => `<div class="border-b pb-1"><span class="${l.ok ? 'text-green-700' : 'text-red-700'} font-medium">${l.ok ? 'OK' : 'ERR'}</span> <span>${esc(l.provider)}/${esc(l.model)}</span> <span class="text-gray-500">${l.latency_ms}ms</span> ${l.error ? `<div class="text-red-600">${esc(l.error)}</div>` : ''}</div>`).join('');
}

async function refreshAll() {
  state = await apiRequest('/api/settings/llm/profiles');
  renderCards();
  await refreshRuntime();
  await refreshLogs();
}

document.getElementById('btnAdd').addEventListener('click', () => openEditor());
document.getElementById('btnRefresh').addEventListener('click', refreshAll);
document.getElementById('btnClose').addEventListener('click', closeEditor);
document.getElementById('btnCancel').addEventListener('click', closeEditor);
document.getElementById('btnValidate').addEventListener('click', validateFromEditor);
document.getElementById('editorForm').addEventListener('submit', saveProfile);

document.addEventListener('DOMContentLoaded', refreshAll);
