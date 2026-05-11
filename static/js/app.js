let currentProject = null;
let currentChapter = null;
let currentTab = 'master_outline';
let currentWorkbenchModule = null;
let currentChatModule = 'master_outline';
let mobileChatVersionsCache = [];
let outlineViewMode = 'volume';
let outlineVolumeProgressCache = [];
let mobileProjectListExpanded = false;
const TAB_DEFS = [
    { key: 'world', label: '1. 题材定位', minWidth: 112 },
    { key: 'master_outline', label: '2. 总纲', minWidth: 92 },
    { key: 'characters', label: '3. 角色', minWidth: 92 },
    { key: 'outline', label: '4. 卷纲', minWidth: 92 },
    { key: 'write', label: '5. 写作', minWidth: 92 },
    { key: 'read', label: '6. 阅读', minWidth: 92 },
    { key: 'export', label: '7. 导出', minWidth: 92 }
];
const TAB_STYLE_ACTIVE = 'py-3 px-4 font-medium bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600';
const TAB_STYLE_INACTIVE = 'py-3 px-4 font-medium text-gray-500 hover:bg-gray-50';

let readingState = {
    projectId: null,
    chapters: [],
    currentChapterId: null,
    mobileTocOpen: false,
    loading: false,
    settings: loadReaderSettings()
};

function loadReaderSettings() {
    try {
        const raw = localStorage.getItem('readerSettingsV1');
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            fontSize: Number(parsed.fontSize) || 20,
            lineHeight: Number(parsed.lineHeight) || 1.95,
            width: Number(parsed.width) || 840
        };
    } catch (e) {
        return {
            fontSize: 20,
            lineHeight: 1.95,
            width: 840
        };
    }
}

function persistReaderSettings() {
    try {
        localStorage.setItem('readerSettingsV1', JSON.stringify(readingState.settings || {}));
    } catch (e) {
        console.warn('保存阅读设置失败', e);
    }
}

// ========== 统一弹窗 ==========
function ensureUiModalHost() {
    let host = document.getElementById('uiModalHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'uiModalHost';
    host.className = 'fixed inset-0 z-[100] hidden items-center justify-center bg-black/45';
    host.innerHTML = `
      <div class="w-[92%] max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div id="uiModalTitle" class="px-5 pt-5 text-lg font-semibold text-slate-800">提示</div>
        <div id="uiModalBody" class="px-5 py-3 text-sm text-slate-700 whitespace-pre-wrap"></div>
        <div id="uiModalInputWrap" class="px-5 pb-2 hidden">
          <input id="uiModalInput" class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div class="px-5 pb-5 pt-2 flex justify-end gap-2">
          <button id="uiModalCancel" class="px-3 py-2 rounded-lg border text-slate-600 hover:bg-slate-50 hidden">取消</button>
          <button id="uiModalOk" class="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    return host;
}

function uiAlert(message, title = '提示') {
    return new Promise((resolve) => {
        const host = ensureUiModalHost();
        host.classList.remove('hidden');
        host.classList.add('flex');
        document.getElementById('uiModalTitle').textContent = title;
        document.getElementById('uiModalBody').textContent = String(message || '');
        document.getElementById('uiModalInputWrap').classList.add('hidden');
        const cancelBtn = document.getElementById('uiModalCancel');
        cancelBtn.classList.add('hidden');
        const okBtn = document.getElementById('uiModalOk');
        const done = () => {
            host.classList.add('hidden');
            host.classList.remove('flex');
            okBtn.onclick = null;
            resolve(true);
        };
        okBtn.onclick = done;
    });
}

function uiConfirm(message, title = '请确认') {
    return new Promise((resolve) => {
        const host = ensureUiModalHost();
        host.classList.remove('hidden');
        host.classList.add('flex');
        document.getElementById('uiModalTitle').textContent = title;
        document.getElementById('uiModalBody').textContent = String(message || '');
        document.getElementById('uiModalInputWrap').classList.add('hidden');
        const cancelBtn = document.getElementById('uiModalCancel');
        const okBtn = document.getElementById('uiModalOk');
        cancelBtn.classList.remove('hidden');
        const close = (ret) => {
            host.classList.add('hidden');
            host.classList.remove('flex');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(ret);
        };
        okBtn.onclick = () => close(true);
        cancelBtn.onclick = () => close(false);
    });
}

function uiPrompt(message, defaultValue = '', title = '请输入') {
    return new Promise((resolve) => {
        const host = ensureUiModalHost();
        host.classList.remove('hidden');
        host.classList.add('flex');
        document.getElementById('uiModalTitle').textContent = title;
        document.getElementById('uiModalBody').textContent = String(message || '');
        const inputWrap = document.getElementById('uiModalInputWrap');
        const input = document.getElementById('uiModalInput');
        inputWrap.classList.remove('hidden');
        input.value = defaultValue || '';
        const cancelBtn = document.getElementById('uiModalCancel');
        const okBtn = document.getElementById('uiModalOk');
        cancelBtn.classList.remove('hidden');
        const close = (ret) => {
            host.classList.add('hidden');
            host.classList.remove('flex');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            input.onkeydown = null;
            resolve(ret);
        };
        okBtn.onclick = () => close(input.value);
        cancelBtn.onclick = () => close(null);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') okBtn.click();
        };
        setTimeout(() => input.focus(), 0);
    });
}

// ========== 主题切换 ==========
// 初始化主题
let darkMode = localStorage.getItem('darkMode') === 'true';

function toggleTheme() {
    darkMode = !darkMode;
    localStorage.setItem('darkMode', darkMode);
    applyTheme();
}

function applyTheme() {
    if (darkMode) {
        document.documentElement.classList.add('dark');
        const themeText = document.getElementById('themeText');
        if (themeText) {
            themeText.textContent = '☀️';
        }
    } else {
        document.documentElement.classList.remove('dark');
        const themeText = document.getElementById('themeText');
        if (themeText) {
            themeText.textContent = '🌙';
        }
    }
}

// DOM加载后应用保存的主题
document.addEventListener('DOMContentLoaded', applyTheme);

// ========== 移动端项目列表切换 ==========
function toggleMobileProjectList() {
    mobileProjectListExpanded = !mobileProjectListExpanded;
    const list = document.getElementById('mobileProjectList');
    const arrow = document.getElementById('mobileProjectArrow');
    if (list) {
        if (mobileProjectListExpanded) {
            list.classList.add('expanded');
        } else {
            list.classList.remove('expanded');
        }
    }
    if (arrow) {
        arrow.style.transform = mobileProjectListExpanded ? 'rotate(180deg)' : '';
    }
}

function closeMobileProjectList() {
    mobileProjectListExpanded = false;
    const list = document.getElementById('mobileProjectList');
    const arrow = document.getElementById('mobileProjectArrow');
    if (list) list.classList.remove('expanded');
    if (arrow) arrow.style.transform = '';
}

function updateMobileProjectTitle(title) {
    const el = document.getElementById('mobileProjectTitle');
    if (el) {
        el.textContent = title || '项目列表';
    }
}

// 页面加载时获取项目列表
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
});

document.addEventListener('DOMContentLoaded', () => {
    loadLLMSettings();
});

// API 请求封装
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '请求失败');
        }
        return response.json();
    } catch (e) {
        console.error('API错误:', e);
        throw e;
    }
}

// 显示loading
function showLoading(element, text = "生成中...") {
    element.disabled = true;
    element.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.062 1.135 5.9 3 8.13l1.709-1.71C4.735 17.135 3.592 16 2 16v-1.709z"></path></svg> ${text}`;
    return element;
}

// 隐藏loading
function hideLoading(element, text) {
    element.disabled = false;
    element.innerHTML = text;
    return element;
}

// 加载项目列表
async function loadProjects() {
    try {
        const projects = await apiRequest('/api/projects/');
        
        // 渲染项目卡片的函数
        const renderProjectItem = (p, isMobile = false) => {
            const item = document.createElement('div');
            item.className = `p-2.5 md:p-2 border rounded cursor-pointer transition mobile-tap-target ${currentProject && currentProject.id === p.id ? 'bg-indigo-100 border-indigo-500 dark:bg-indigo-900 dark:border-indigo-400' : 'hover:bg-indigo-50 dark:hover:bg-gray-700'}`;
            item.innerHTML = `
                <div class="font-medium text-sm md:text-base truncate text-gray-800 dark:text-gray-200">${escapeHtml(p.title)}</div>
                <div class="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">${p.genre} · ${new Date(p.updated_at).toLocaleDateString()}</div>
            `;
            item.onclick = () => {
                selectProject(p);
                if (isMobile) closeMobileProjectList();
            };
            return item;
        };
        
        // 桌面端列表
        const listEl = document.getElementById('projectList');
        if (listEl) {
            listEl.innerHTML = '';
            projects.forEach(p => listEl.appendChild(renderProjectItem(p, false)));
        }
        
        // 移动端列表
        const mobileListEl = document.getElementById('projectListMobile');
        if (mobileListEl) {
            mobileListEl.innerHTML = '';
            if (projects.length === 0) {
                mobileListEl.innerHTML = '<div class="text-sm text-gray-500 text-center py-4">暂无项目</div>';
            } else {
                projects.forEach(p => mobileListEl.appendChild(renderProjectItem(p, true)));
            }
        }
    } catch (e) {
        console.error('加载项目列表失败', e);
    }
}

// 选择项目
async function selectProject(project) {
    currentProject = project;
    currentChapter = null;
    currentTab = 'master_outline';
    updateMobileProjectTitle(project.title);
    loadProjects();
    renderProjectDetail(project);
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 渲染项目详情
function renderProjectDetail(project) {
    const content = `
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-3 md:p-6">
            <div class="flex flex-col md:flex-row md:justify-between md:items-start gap-3">
                <div class="flex-1 min-w-0">
                    <h2 class="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-200 truncate">${escapeHtml(project.title)}</h2>
                    <p class="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-1">${project.genre} · ${project.enable_review ? '审查开启' : '审查关闭'} · 每章${project.target_words_per_chapter}字</p>
                    ${project.description ? `<p class="text-sm md:text-base text-gray-700 dark:text-gray-300 mt-2 line-clamp-2 md:line-clamp-none">${escapeHtml(project.description)}</p>` : ''}
                </div>
                <div class="flex flex-wrap items-center gap-1.5 md:gap-2 shrink-0">
                    <button onclick="openProjectChatModal()" class="px-2.5 md:px-3 py-1.5 bg-indigo-600 text-white rounded text-xs md:text-sm mobile-tap-target">创作聊天</button>
                    <button onclick="downloadProjectBundle(${project.id})" class="px-2.5 md:px-3 py-1.5 bg-blue-600 text-white rounded text-xs md:text-sm mobile-tap-target">导出</button>
                    <button onclick="triggerGlobalImportProject()" class="px-2.5 md:px-3 py-1.5 bg-emerald-600 text-white rounded text-xs md:text-sm mobile-tap-target">导入</button>
                    <button onclick="deleteProject(${project.id})" class="px-2.5 md:px-3 py-1.5 bg-red-600 text-white rounded text-xs md:text-sm mobile-tap-target">删除</button>
                </div>
            </div>
        </div>

        <!-- Tab 导航 -->
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div class="flex border-b overflow-x-auto hide-scrollbar mobile-nav-scroll whitespace-nowrap px-1" id="projectTabButtons">
                ${TAB_DEFS.map(tab => `
                    <button
                        data-tab-key="${tab.key}"
                        class="shrink-0 py-2.5 md:py-3 px-3 md:px-4 text-xs md:text-sm font-medium ${currentTab === tab.key ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' : 'text-gray-500 hover:text-gray-700'}"
                        onclick="switchTab('${tab.key}')"
                    >
                        ${tab.label}
                    </button>
                `).join('')}
            </div>
            <div id="tabContent" class="p-3 md:p-4">
                <!-- 内容由switchTab填充 -->
            </div>
        </div>
    `;

    document.getElementById('mainContent').innerHTML = content;
    switchTab(currentTab);
}

// ========== 项目级创作聊天弹窗 ==========
function ensureProjectChatModal() {
    let el = document.getElementById('projectChatModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'projectChatModal';
    el.className = 'fixed inset-0 z-[90] hidden items-end md:items-center justify-center bg-black/45';
    el.innerHTML = `
      <div class="w-full md:w-[95%] h-[92vh] md:h-[90vh] rounded-t-2xl md:rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-slate-200 dark:border-gray-700 overflow-hidden">
        <div class="h-full grid grid-cols-1 md:grid-cols-12 min-h-0">
          <div class="md:col-span-2 border-b md:border-b-0 md:border-r bg-slate-50 dark:bg-gray-700 min-h-0 overflow-y-auto">
            <div class="p-3 border-b font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-between">
              <span>创作聊天</span>
              <button onclick="closeProjectChatModal()" class="md:hidden px-2 py-1 border rounded text-xs mobile-tap-target">关闭</button>
            </div>
            <div id="chatModuleTabs" class="p-2 flex md:flex-col gap-1 md:gap-2 overflow-x-auto md:overflow-x-visible hide-scrollbar whitespace-nowrap md:whitespace-normal mobile-scroll"></div>
          </div>
          <div class="md:col-span-7 flex flex-col min-h-0">
            <div class="px-3 md:px-4 py-2 md:py-3 border-b flex items-center justify-between">
              <div class="flex-1 min-w-0">
                <div id="chatModuleTitle" class="font-semibold text-sm md:text-base text-slate-800 dark:text-slate-200 truncate">总纲聊天</div>
                <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">对话是主体：继续聊 -> 整理版本 -> 设为正式版</div>
              </div>
              <div class="flex items-center gap-2">
                <button onclick="openMobileChatVersions()" class="md:hidden px-2 py-1 border rounded text-xs mobile-tap-target">历史版本</button>
                <button onclick="closeProjectChatModal()" class="hidden md:block px-2 py-1 border rounded mobile-tap-target">关闭</button>
              </div>
            </div>
            <div id="chatContextSummary" class="px-3 md:px-4 py-2 border-b bg-indigo-50/60 dark:bg-indigo-900/30 text-[10px] md:text-xs text-slate-700 dark:text-slate-300"></div>
            <div id="chatMessages" class="flex-1 min-h-0 overflow-y-auto p-2 md:p-4 space-y-2 bg-white dark:bg-gray-800 mobile-scroll"></div>
            <div class="border-t p-2 md:p-3 bg-slate-50 dark:bg-gray-700 shrink-0 safe-bottom">
              <div class="flex gap-2 items-end">
                <textarea id="chatInput" rows="1" class="flex-1 px-3 py-2 border rounded resize-none overflow-y-auto text-sm md:text-base" placeholder="输入创作要求..."></textarea>
                <button id="chatSendBtn" onclick="sendProjectChatMessage()" class="px-3 py-2 bg-indigo-600 text-white rounded text-sm mobile-tap-target shrink-0">发送</button>
              </div>
              <div class="mt-2 flex gap-1.5 md:gap-2 flex-wrap">
                <button onclick="finalizeFromConversationInModal()" class="text-[10px] md:text-xs px-2 py-1 bg-indigo-600 text-white rounded mobile-tap-target">符合预期，整理版本</button>
                <button onclick="focusProjectChatInput()" class="text-[10px] md:text-xs px-2 py-1 border rounded mobile-tap-target">继续聊</button>
                <button onclick="injectCoreContextToChat()" class="text-[10px] md:text-xs px-2 py-1 border rounded text-indigo-700 border-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 mobile-tap-target">一键注入上下文</button>
              </div>
            </div>
          </div>
          <div class="hidden md:flex md:col-span-3 border-l bg-slate-50 dark:bg-gray-700 flex-col min-h-0">
            <div class="p-3 border-b flex items-center justify-between">
              <div class="font-semibold text-slate-800 dark:text-slate-200">历史版本</div>
              <button onclick="refreshProjectChatModal()" class="text-xs px-2 py-1 border rounded mobile-tap-target">刷新</button>
            </div>
            <div id="chatVersions" class="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 mobile-scroll"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
}

function chatModuleDefs() {
    return [
        { key: 'creative_profile', label: '题材定位' },
        { key: 'master_outline', label: '总纲' },
        { key: 'character_system', label: '角色系统' },
        { key: 'world_system', label: '世界观系统' },
        { key: 'characters', label: '角色' },
        { key: 'outline', label: '卷纲' },
        { key: 'world', label: '世界观' },
    ];
}

function renderProjectChatTabs() {
    const host = document.getElementById('chatModuleTabs');
    if (!host) return;
    host.innerHTML = chatModuleDefs().map(m => {
        const active = m.key === currentChatModule;
        return `<button onclick="switchProjectChatModule('${m.key}')" class="block md:w-full text-left px-2 py-2 rounded text-sm shrink-0 ${active ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-100 text-slate-700'}">${m.label}</button>`;
    }).join('');
}

function moduleDisplayName(module) {
    const map = { creative_profile: '题材定位', world: '世界观', master_outline: '总纲', character_system: '角色系统', world_system: '世界观系统', characters: '角色', outline: '卷纲' };
    return map[module] || module;
}

async function openProjectChatModal() {
    if (!currentProject) return;
    const el = ensureProjectChatModal();
    el.classList.remove('hidden');
    el.classList.add('flex');
    currentChatModule = currentChatModule || 'master_outline';
    const input = document.getElementById('chatInput');
    if (input && !input.dataset.boundEnter) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendProjectChatMessage();
            }
        });
        input.addEventListener('input', autoResizeChatInput);
        input.dataset.boundEnter = '1';
    }
    await refreshProjectChatModal();
    focusProjectChatInput();
}

function closeProjectChatModal() {
    const el = document.getElementById('projectChatModal');
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
}

async function switchProjectChatModule(module) {
    currentChatModule = module;
    await refreshProjectChatModal();
}

async function refreshProjectChatModal() {
    if (!currentProject) return;
    renderProjectChatTabs();
    const titleEl = document.getElementById('chatModuleTitle');
    if (titleEl) titleEl.textContent = `${moduleDisplayName(currentChatModule)}聊天`;
    try {
        const state = await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}`);
        renderChatContextSummary(state.injected_context || {});
        renderProjectChatMessages(state.messages || []);
        renderProjectChatVersions(state.versions || []);
    } catch (e) {
        const msgEl = document.getElementById('chatMessages');
        if (msgEl) msgEl.innerHTML = `<div class="text-sm text-red-600">加载失败：${escapeHtml(e.message || '')}</div>`;
    }
}

function renderChatContextSummary(ctx) {
    const el = document.getElementById('chatContextSummary');
    if (!el) return;
    const cp = (ctx && ctx.creative_profile) || {};
    const mo = (ctx && ctx.master_outline) || {};
    const ws = (ctx && ctx.world_setting) || {};
    const cs = (ctx && ctx.character_system) || {};
    const names = Array.isArray(ctx && ctx.active_character_names) ? ctx.active_character_names : [];

    const chips = [];
    if (cp.core_contrast) chips.push(`<span class="px-2 py-0.5 rounded bg-white border">核心反差已注入</span>`);
    if (cp.reader_promise) chips.push(`<span class="px-2 py-0.5 rounded bg-white border">读者承诺已注入</span>`);
    if (Object.keys(mo).length > 0) chips.push(`<span class="px-2 py-0.5 rounded bg-white border">总纲已注入</span>`);
    if (ws.background || ws.power_system || ws.rules) chips.push(`<span class="px-2 py-0.5 rounded bg-white border">世界观已注入</span>`);
    if (cs.arc_design || cs.taskcard_rule) chips.push(`<span class="px-2 py-0.5 rounded bg-white border">角色系统已注入</span>`);
    chips.push(`<span class="px-2 py-0.5 rounded bg-white border">角色数: ${names.length}</span>`);
    const previewNames = names.slice(0, 8).map(n => escapeHtml(n)).join(' / ') || '暂无';

    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-1 mb-1">
        ${chips.join('')}
        <button onclick='viewInjectedContextDetail()' class="px-2 py-0.5 rounded border bg-white hover:bg-slate-50 text-[11px]">查看注入详情</button>
      </div>
      <div class="text-[11px] text-slate-600">本轮上下文角色预览：${previewNames}${names.length > 8 ? ' ...' : ''}</div>
    `;
}

function injectCoreContextToChat() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const presets = {
        master_outline: '请基于当前项目已注入的题材定位、总纲、世界观与角色信息，做增量优化，不要整稿重写。先列出你将沿用的关键约束，再给出修改后的总纲候选。',
        character_system: '请基于当前题材定位与总纲，优化角色系统（成长弧/终局规划/任务卡规则），保持角色名单不变，仅做增量调整。',
        world_system: '请基于当前题材定位与总纲，优化世界观系统（规则/代价/资源/限制），保持世界观主设定不变，仅做增量调整。',
        characters: '请基于当前题材定位与总纲，微调角色分工与关系推进，不重建角色名单。',
        outline: '请基于当前题材定位与总纲，优化卷纲节奏与钩子，保持已有主线方向。'
    };
    const text = presets[currentChatModule] || '请基于当前已注入上下文做增量优化，不要从零重写。';
    input.value = text;
    autoResizeChatInput();
    input.focus();
}

function viewInjectedContextDetail() {
    if (!currentProject) return;
    apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}`).then((state) => {
        const ctx = state.injected_context || {};
        const raw = JSON.stringify(ctx, null, 2);
        const html = `
          <div id="injectedCtxModal" class="fixed inset-0 bg-black/55 flex items-center justify-center z-[98]">
            <div class="bg-white rounded-lg p-4 max-w-5xl w-[94%] max-h-[86vh] overflow-y-auto">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">本轮注入上下文详情</h3>
                <button onclick="document.getElementById('injectedCtxModal').remove()" class="px-2 py-1 border rounded">关闭</button>
              </div>
              <pre class="text-sm whitespace-pre-wrap break-words bg-slate-50 border rounded p-3">${escapeHtml(raw)}</pre>
            </div>
          </div>
        `;
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);
    }).catch((e) => uiAlert('加载注入上下文失败: ' + e.message));
}

function renderProjectChatMessages(messages) {
    const el = document.getElementById('chatMessages');
    if (!el) return;
    if (!messages.length) {
        el.innerHTML = '<div class="text-sm text-slate-500">开始对话吧，先描述你想要的方向。</div>';
        return;
    }
    el.innerHTML = messages.map(m => {
        const isUser = m.role === 'user';
        const cls = isUser ? 'bg-indigo-50 border-indigo-200 ml-12' : 'bg-emerald-50 border-emerald-200 mr-12';
        const safeContent = escapeHtml(m.content || '');
        const shortContent = safeContent.length > 800 ? `${safeContent.slice(0, 800)}...` : safeContent;
        const needExpand = safeContent.length > 800;
        const encodedProposal = encodeURIComponent(m.proposal_json || '');
        let actions = '';
        if (!isUser && m.has_proposal) {
            actions += `<button onclick="applyProjectChatProposal(${m.id})" class="text-xs px-2 py-1 bg-emerald-600 text-white rounded">应用候选</button>`;
            actions += `<button onclick="viewProposalDetail(${m.id})" class="text-xs px-2 py-1 border rounded ml-1">查看详细候选</button>`;
        }
        if (!isUser && (currentChatModule === 'outline' || currentChatModule === 'master_outline')) {
            actions += `<button onclick="finalizeFromConversationInModal()" class="text-xs px-2 py-1 bg-indigo-600 text-white rounded ml-1">符合预期，整理版本</button>`;
        }
        return `<div class="border rounded p-2 ${cls}">
          <div class="text-xs text-slate-500">${isUser ? '你' : 'AI'} · ${new Date(m.created_at).toLocaleString()}</div>
          <div class="text-sm whitespace-pre-wrap break-words">${shortContent}</div>
          ${needExpand ? `<button onclick="viewFullChatMessage(${m.id})" class="mt-1 text-xs px-2 py-1 border rounded">查看完整内容</button>` : ''}
          <textarea id="chat-msg-full-${m.id}" class="hidden">${safeContent}</textarea>
          <textarea id="chat-msg-proposal-${m.id}" class="hidden">${encodedProposal}</textarea>
          ${m.summary ? `<div class="text-xs text-slate-600 mt-1">摘要：${escapeHtml(m.summary)}</div>` : ''}
          ${actions ? `<div class="mt-1">${actions}</div>` : ''}
        </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
}

function viewProposalDetail(messageId) {
    const holder = document.getElementById(`chat-msg-proposal-${messageId}`);
    if (!holder || !holder.value) {
        uiAlert('这条消息没有可展示的候选详情');
        return;
    }
    let detail = decodeURIComponent(holder.value || '');
    let parsed = null;
    try {
        parsed = JSON.parse(detail);
        detail = JSON.stringify(parsed, null, 2);
    } catch (_) {}
    const readable = renderReadableProposal(parsed);
    const html = `
      <div id="proposalDetailModal" class="fixed inset-0 bg-black/55 flex items-center justify-center z-[98]">
        <div class="bg-white rounded-lg p-4 max-w-5xl w-[94%] max-h-[86vh] overflow-y-auto">
          <div class="flex items-center justify-between mb-2 gap-2">
            <h3 class="font-semibold text-slate-800">候选详细内容</h3>
            <div class="flex items-center gap-2">
              <button onclick="toggleProposalRaw(false)" class="px-2 py-1 border rounded text-sm">可读视图</button>
              <button onclick="toggleProposalRaw(true)" class="px-2 py-1 border rounded text-sm">原始JSON</button>
              <button onclick="document.getElementById('proposalDetailModal').remove()" class="px-2 py-1 border rounded">关闭</button>
            </div>
          </div>
          <div id="proposalReadableView" class="text-sm">${readable}</div>
          <pre id="proposalRawView" class="hidden text-sm whitespace-pre-wrap break-words bg-slate-50 border rounded p-3">${escapeHtml(detail)}</pre>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
}

function toggleProposalRaw(showRaw) {
    const raw = document.getElementById('proposalRawView');
    const readable = document.getElementById('proposalReadableView');
    if (!raw || !readable) return;
    if (showRaw) {
        raw.classList.remove('hidden');
        readable.classList.add('hidden');
    } else {
        readable.classList.remove('hidden');
        raw.classList.add('hidden');
    }
}

function renderReadableProposal(data) {
    const renderChapterCard = (c, idx = 0) => `
        <div class="mb-2 border rounded p-3 bg-slate-50">
          <div class="font-medium text-slate-800">第${escapeHtml(String(c.chapter_index || c.chapter || (idx + 1)))}章 ${escapeHtml(c.title || '')}</div>
          ${c.goal ? `<div class="text-slate-700 mt-1"><span class="text-slate-500">目标：</span>${escapeHtml(c.goal)}</div>` : ''}
          ${c.core_conflict && !c.conflict ? `<div class="text-slate-700 mt-1"><span class="text-slate-500">冲突：</span>${escapeHtml(c.core_conflict)}</div>` : ''}
          ${c.conflict ? `<div class="text-slate-700"><span class="text-slate-500">冲突：</span>${escapeHtml(c.conflict)}</div>` : ''}
          ${c.cost ? `<div class="text-slate-700"><span class="text-slate-500">代价：</span>${escapeHtml(c.cost)}</div>` : ''}
          ${c.strand ? `<div class="text-slate-700"><span class="text-slate-500">叙事线：</span>${escapeHtml(c.strand)}</div>` : ''}
          ${c.cool_point_type ? `<div class="text-slate-700"><span class="text-slate-500">爽点类型：</span>${escapeHtml(c.cool_point_type)}</div>` : ''}
          ${c.antagonist_level ? `<div class="text-slate-700"><span class="text-slate-500">反派强度：</span>${escapeHtml(c.antagonist_level)}</div>` : ''}
          ${c.pov ? `<div class="text-slate-700"><span class="text-slate-500">视角：</span>${escapeHtml(c.pov)}</div>` : ''}
          ${c.hook ? `<div class="text-slate-700"><span class="text-slate-500">钩子：</span>${escapeHtml(c.hook)}</div>` : ''}
          ${c.word_count_reference ? `<div class="text-slate-700"><span class="text-slate-500">字数参考：</span>${escapeHtml(c.word_count_reference)}</div>` : ''}
          ${c.summary ? `<div class="text-slate-700"><span class="text-slate-500">摘要：</span>${escapeHtml(c.summary)}</div>` : ''}
          ${c.outline ? `<div class="text-slate-700"><span class="text-slate-500">概要：</span>${escapeHtml(c.outline)}</div>` : ''}
        </div>
    `;
    const renderVolumeCard = (v, idx = 0) => {
        const chs = Array.isArray(v.chapters) ? v.chapters : [];
        const volumeNo = v.volume_index || v.volume || (idx + 1);
        return `
          <div class="mb-3 border rounded-lg p-3 bg-slate-50">
            <div class="text-base font-semibold text-slate-800">第${escapeHtml(String(volumeNo))}卷：${escapeHtml(v.title || '')}</div>
            ${v.summary ? `<div class="mt-1 text-slate-700"><span class="text-slate-500">卷概要：</span>${escapeHtml(v.summary)}</div>` : ''}
            ${v.plot_focus ? `<div class="mt-1 text-slate-700"><span class="text-slate-500">剧情聚焦：</span>${escapeHtml(v.plot_focus)}</div>` : ''}
            ${v.beat_sheet ? `<div class="mt-1 text-slate-700"><span class="text-slate-500">节拍表：</span>${escapeHtml(v.beat_sheet)}</div>` : ''}
            ${v.core_conflict ? `<div class="mt-1 text-slate-700"><span class="text-slate-500">核心冲突：</span>${escapeHtml(v.core_conflict)}</div>` : ''}
            ${v.climax ? `<div class="mt-1 text-slate-700"><span class="text-slate-500">卷高潮：</span>${escapeHtml(v.climax)}</div>` : ''}
            ${chs.length ? `<div class="mt-2 text-xs text-slate-600 mb-1">章节数：${chs.length}</div><div class="space-y-2">${chs.map((c, cidx) => renderChapterCard(c, cidx)).join('')}</div>` : ''}
          </div>
        `;
    };

    if (!data) {
        return '<div class="p-3 border rounded bg-slate-50 text-slate-600">无法解析候选内容，请切换到原始JSON查看。</div>';
    }
    if (Array.isArray(data)) {
        // 卷纲列表 / 角色列表
        if (data.length && data[0] && Object.prototype.hasOwnProperty.call(data[0], 'volume_index')) {
            return data.map((v, idx) => renderVolumeCard(v, idx)).join('');
        }
        // 仅章节列表（无volume包装）
        if (data.length && data[0] && (
            Object.prototype.hasOwnProperty.call(data[0], 'chapter_index') ||
            Object.prototype.hasOwnProperty.call(data[0], 'chapter') ||
            Object.prototype.hasOwnProperty.call(data[0], 'goal') ||
            Object.prototype.hasOwnProperty.call(data[0], 'summary') ||
            Object.prototype.hasOwnProperty.call(data[0], 'core_conflict') ||
            Object.prototype.hasOwnProperty.call(data[0], 'conflict') ||
            Object.prototype.hasOwnProperty.call(data[0], 'hook')
        )) {
            return data.map((c, idx) => renderChapterCard(c, idx)).join('');
        }
        // 卷对象但字段不完全标准
        if (data.length && data[0] && (
            Object.prototype.hasOwnProperty.call(data[0], 'title') ||
            Object.prototype.hasOwnProperty.call(data[0], 'summary') ||
            Object.prototype.hasOwnProperty.call(data[0], 'chapters')
        )) {
            return data.map((v, idx) => renderVolumeCard(v, idx)).join('');
        }
        // 字符串数组
        if (data.every(x => typeof x === 'string')) {
            return data.map((s, idx) => `
                <div class="mb-2 border rounded p-3 bg-slate-50">
                  <div class="font-medium text-slate-700 mb-1">条目 ${idx + 1}</div>
                  <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(s)}</div>
                </div>
            `).join('');
        }
        return data.map((item, idx) => `
            <div class="mb-2 border rounded p-3 bg-slate-50">
              <div class="font-medium text-slate-800">${escapeHtml((item && item.name) || (item && item.title) || `条目 ${idx + 1}`)}</div>
              ${item && item.role ? `<div><span class="text-slate-500">定位：</span>${escapeHtml(item.role)}</div>` : ''}
              ${item && item.personality ? `<div><span class="text-slate-500">性格：</span>${escapeHtml(item.personality)}</div>` : ''}
              ${item && item.background ? `<div><span class="text-slate-500">背景：</span>${escapeHtml(item.background)}</div>` : ''}
              ${item && item.abilities ? `<div><span class="text-slate-500">能力：</span>${escapeHtml(item.abilities)}</div>` : ''}
              ${item && !item.name && !item.role && !item.personality && !item.background && !item.abilities
                ? `<pre class="mt-1 text-xs whitespace-pre-wrap break-words bg-white border rounded p-2">${escapeHtml(JSON.stringify(item, null, 2))}</pre>`
                : ''}
            </div>
        `).join('');
    }
    if (typeof data === 'object') {
        // 兼容被包裹的卷纲结构
        if (Array.isArray(data.volumes)) {
            return data.volumes.map((v, idx) => renderVolumeCard(v, idx)).join('');
        }
        if (Array.isArray(data.outline)) {
            return data.outline.map((v, idx) => renderVolumeCard(v, idx)).join('');
        }
        if (Array.isArray(data.chapters)) {
            return data.chapters.map((c, idx) => renderChapterCard(c, idx)).join('');
        }
        // 单卷对象
        if (
            Object.prototype.hasOwnProperty.call(data, 'volume_index') ||
            Object.prototype.hasOwnProperty.call(data, 'core_conflict') ||
            Object.prototype.hasOwnProperty.call(data, 'beat_sheet')
        ) {
            return renderVolumeCard(data, 0);
        }
        // 单章对象
        if (
            Object.prototype.hasOwnProperty.call(data, 'chapter_index') ||
            Object.prototype.hasOwnProperty.call(data, 'chapter') ||
            Object.prototype.hasOwnProperty.call(data, 'goal') ||
            Object.prototype.hasOwnProperty.call(data, 'summary') ||
            Object.prototype.hasOwnProperty.call(data, 'core_conflict') ||
            Object.prototype.hasOwnProperty.call(data, 'conflict') ||
            Object.prototype.hasOwnProperty.call(data, 'hook')
        ) {
            return renderChapterCard(data, 0);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'master_outline')) {
            const dynamicActs = extractMasterOutlineActs(data);
            const rows = [
                { k: '核心承诺', v: data.core_promise || '' },
                { k: '目标读者', v: data.target_reader || '' },
                { k: '故事终局', v: data.ending || '' },
                { k: '世界终极真相', v: data.ultimate_truth || '' },
                { k: '角色终局', v: data.character_endings || '' },
            ];
            dynamicActs.forEach((a, idx) => rows.push({ k: `第${idx + 1}幕`, v: a }));
            let html = rows.map(r => r.v ? `
                <div class="mb-2 border rounded p-3 bg-slate-50">
                  <div class="font-medium text-slate-700 mb-1">${r.k}</div>
                  <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(r.v)}</div>
                </div>` : '').join('');
            if (data.master_outline) {
                html += `<div class="mb-2 border rounded p-3 bg-white">
                  <div class="font-medium text-slate-700 mb-1">串联总纲</div>
                  <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(data.master_outline)}</div>
                </div>`;
            }
            return html || `<div class="border rounded p-3 bg-slate-50 whitespace-pre-wrap break-words">${escapeHtml(data.master_outline || '')}</div>`;
        }
        if (
            Object.prototype.hasOwnProperty.call(data, 'core_contrast') ||
            Object.prototype.hasOwnProperty.call(data, 'cheat_cost') ||
            Object.prototype.hasOwnProperty.call(data, 'reader_promise') ||
            Object.prototype.hasOwnProperty.call(data, 'unique_mechanism')
        ) {
            const rows = [
                { k: '核心反差', v: data.core_contrast || '' },
                { k: '金手指代价', v: data.cheat_cost || '' },
                { k: '读者承诺', v: data.reader_promise || '' },
                { k: '独特机制', v: data.unique_mechanism || '' },
            ];
            return rows.map(r => `
                <div class="mb-2 border rounded p-3 bg-slate-50">
                  <div class="font-medium text-slate-700 mb-1">${r.k}</div>
                  <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(r.v || '（未填写）')}</div>
                </div>
            `).join('');
        }
        if (
            Object.prototype.hasOwnProperty.call(data, 'arc_design') ||
            Object.prototype.hasOwnProperty.call(data, 'ending_plan') ||
            Object.prototype.hasOwnProperty.call(data, 'taskcard_rule')
        ) {
            const rows = [
                { k: '主配角成长弧', v: data.arc_design || '' },
                { k: '角色终局规划', v: data.ending_plan || '' },
                { k: '任务卡规则', v: data.taskcard_rule || '' },
            ];
            return rows.map(r => `
                <div class="mb-2 border rounded p-3 bg-slate-50">
                  <div class="font-medium text-slate-700 mb-1">${r.k}</div>
                  <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(r.v || '（未填写）')}</div>
                </div>
            `).join('');
        }
        if (
            Object.prototype.hasOwnProperty.call(data, 'rules') ||
            Object.prototype.hasOwnProperty.call(data, 'costs') ||
            Object.prototype.hasOwnProperty.call(data, 'resources') ||
            Object.prototype.hasOwnProperty.call(data, 'limits')
        ) {
            const rows = [
                { k: '世界规则', v: data.rules || '' },
                { k: '力量代价', v: data.costs || '' },
                { k: '资源系统', v: data.resources || '' },
                { k: '限制条件', v: data.limits || '' },
            ];
            return rows.map(r => `
                <div class="mb-2 border rounded p-3 bg-slate-50">
                  <div class="font-medium text-slate-700 mb-1">${r.k}</div>
                  <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(r.v || '（未填写）')}</div>
                </div>
            `).join('');
        }
        const preferred = ['background', 'power_system', 'geography', 'factions', 'rules'];
        const hasWorld = preferred.some(k => Object.prototype.hasOwnProperty.call(data, k));
        if (hasWorld) {
            return preferred.map(k => {
                const labelMap = {
                    background: '背景',
                    power_system: '力量体系',
                    geography: '地理',
                    factions: '势力',
                    rules: '规则'
                };
                if (!data[k]) return '';
                return `
                  <div class="mb-2 border rounded p-3 bg-slate-50">
                    <div class="font-medium text-slate-700 mb-1">${labelMap[k]}</div>
                    <div class="whitespace-pre-wrap break-words text-slate-800">${escapeHtml(String(data[k]))}</div>
                  </div>
                `;
            }).join('');
        }
        return `<pre class="text-sm whitespace-pre-wrap break-words bg-slate-50 border rounded p-3">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    }
    return `<div class="p-3 border rounded bg-slate-50">${escapeHtml(String(data))}</div>`;
}

function extractMasterOutlineActs(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.acts)) {
        return data.acts.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 2)).filter(Boolean);
    }
    const pairs = [];
    Object.keys(data).forEach((k) => {
        const m = /^act(\d+)$/i.exec(k || '');
        if (m) {
            const idx = parseInt(m[1], 10);
            if (Number.isFinite(idx) && idx > 0) {
                pairs.push([idx, data[k]]);
            }
        }
    });
    pairs.sort((a, b) => a[0] - b[0]);
    return pairs.map(([, v]) => (v == null ? '' : String(v))).filter(v => v.trim());
}

function viewFullChatMessage(messageId) {
    const holder = document.getElementById(`chat-msg-full-${messageId}`);
    const content = holder ? holder.value : '';
    const html = `
        <div id="chatMessageViewModal" class="fixed inset-0 bg-black/55 flex items-center justify-center z-[98]">
          <div class="bg-white rounded-lg p-4 max-w-5xl w-[94%] max-h-[86vh] overflow-y-auto">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold text-slate-800">完整对话内容</h3>
              <button onclick="document.getElementById('chatMessageViewModal').remove()" class="px-2 py-1 border rounded">关闭</button>
            </div>
            <pre class="text-sm whitespace-pre-wrap break-words bg-slate-50 border rounded p-3">${content}</pre>
          </div>
        </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
}

function renderProjectChatVersions(versions) {
    mobileChatVersionsCache = versions || [];
    const el = document.getElementById('chatVersions');
    if (!el) return;
    if (!versions.length) {
        el.innerHTML = '<div class="text-sm text-slate-500">暂无版本</div>';
        return;
    }
    el.innerHTML = versions.map(v => `
      <div class="border rounded p-2 bg-white">
        <div class="text-xs text-slate-500">v${v.version_no} · ${new Date(v.created_at).toLocaleString()}</div>
        <div class="text-sm">${escapeHtml(v.summary || '未命名版本')} ${v.is_official ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">正式版</span>' : ''}</div>
        <div class="mt-1 flex gap-1">
          <button onclick="viewProjectChatVersionText(${v.id})" class="text-xs px-2 py-1 border rounded">查看文本</button>
          <button onclick="diffProjectChatVersion(${v.id})" class="text-xs px-2 py-1 border rounded">对比</button>
          <button onclick="tuneProjectChatVersion(${v.id})" class="text-xs px-2 py-1 border rounded">微调</button>
          <button onclick="restoreProjectChatVersion(${v.id})" class="text-xs px-2 py-1 border rounded">回滚</button>
          ${currentChatModule === 'outline' ? `<button onclick="previewProjectChatVersionMerge(${v.id})" class="text-xs px-2 py-1 border rounded">预览增量</button><button onclick="publishProjectChatVersionMerge(${v.id})" class="text-xs px-2 py-1 bg-teal-600 text-white rounded">增量设正式版</button>` : ''}
          <button onclick="publishProjectChatVersion(${v.id})" class="text-xs px-2 py-1 bg-amber-600 text-white rounded">设正式版</button>
        </div>
      </div>
    `).join('');
}

function openMobileChatVersions() {
    const versions = mobileChatVersionsCache || [];
    const html = `
      <div id="mobileChatVersionsModal" class="fixed inset-0 bg-black/55 flex items-end justify-center z-[97]">
        <div class="bg-white w-full rounded-t-2xl p-3 max-h-[75vh] overflow-y-auto safe-bottom">
          <div class="flex items-center justify-between mb-2">
            <div class="font-semibold text-slate-800">历史版本</div>
            <button onclick="document.getElementById('mobileChatVersionsModal').remove()" class="px-2 py-1 border rounded">关闭</button>
          </div>
          <div class="space-y-2">
            ${versions.length ? versions.map(v => `
              <div class="border rounded p-2 bg-white">
                <div class="text-xs text-slate-500">v${v.version_no} · ${new Date(v.created_at).toLocaleString()}</div>
                <div class="text-sm">${escapeHtml(v.summary || '未命名版本')} ${v.is_official ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">正式版</span>' : ''}</div>
                <div class="mt-1 flex gap-1 flex-wrap">
                  <button onclick="viewProjectChatVersionText(${v.id})" class="text-xs px-2 py-1 border rounded">查看文本</button>
                  <button onclick="diffProjectChatVersion(${v.id})" class="text-xs px-2 py-1 border rounded">对比</button>
                  <button onclick="restoreProjectChatVersion(${v.id})" class="text-xs px-2 py-1 border rounded">回滚</button>
                  ${currentChatModule === 'outline' ? `<button onclick="previewProjectChatVersionMerge(${v.id})" class="text-xs px-2 py-1 border rounded">预览增量</button><button onclick="publishProjectChatVersionMerge(${v.id})" class="text-xs px-2 py-1 bg-teal-600 text-white rounded">增量设正式版</button>` : ''}
                  <button onclick="publishProjectChatVersion(${v.id})" class="text-xs px-2 py-1 bg-amber-600 text-white rounded">设正式版</button>
                </div>
              </div>
            `).join('') : '<div class="text-sm text-slate-500">暂无版本</div>'}
          </div>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
}

async function tuneProjectChatVersion(versionId) {
    if (!currentProject) return;
    const instruction = await uiPrompt('请输入微调指令（将基于该历史版本做最小改动）');
    if (instruction === null) return;
    if (!instruction.trim()) {
        await uiAlert('微调指令不能为空');
        return;
    }
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}/tune`, {
            method: 'POST',
            body: JSON.stringify({ instruction: instruction.trim() })
        });
        await refreshProjectChatModal();
        await uiAlert(`已生成新版本 v${res.new_version_no}（基于v${res.base_version_no}）`);
    } catch (e) {
        await uiAlert('版本微调失败: ' + e.message);
    }
}

async function viewProjectChatVersionText(versionId) {
    if (!currentProject) return;
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}`);
        const content = res.content || {};
        const raw = res.raw_json || JSON.stringify(content, null, 2);
        const readable = renderReadableProposal(content);
        const html = `
          <div id="versionTextModal" class="fixed inset-0 bg-black/55 flex items-center justify-center z-[98]">
            <div class="bg-white rounded-lg p-4 max-w-5xl w-[94%] max-h-[86vh] overflow-y-auto">
              <div class="flex items-center justify-between mb-2 gap-2">
                <h3 class="font-semibold text-slate-800">版本文本 · v${res.version_no} ${escapeHtml(res.summary || '')}</h3>
                <div class="flex items-center gap-2">
                  <button onclick="toggleVersionRaw(false)" class="px-2 py-1 border rounded text-sm">可读视图</button>
                  <button onclick="toggleVersionRaw(true)" class="px-2 py-1 border rounded text-sm">原始JSON</button>
                  <button onclick="document.getElementById('versionTextModal').remove()" class="px-2 py-1 border rounded">关闭</button>
                </div>
              </div>
              <div id="versionReadableView" class="text-sm">${readable}</div>
              <pre id="versionRawView" class="hidden text-sm whitespace-pre-wrap break-words bg-slate-50 border rounded p-3">${escapeHtml(raw)}</pre>
            </div>
          </div>
        `;
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);
    } catch (e) {
        await uiAlert('查看版本文本失败: ' + e.message);
    }
}

function toggleVersionRaw(showRaw) {
    const raw = document.getElementById('versionRawView');
    const readable = document.getElementById('versionReadableView');
    if (!raw || !readable) return;
    if (showRaw) {
        raw.classList.remove('hidden');
        readable.classList.add('hidden');
    } else {
        readable.classList.remove('hidden');
        raw.classList.add('hidden');
    }
}

function focusProjectChatInput() {
    const input = document.getElementById('chatInput');
    if (input) input.focus();
}

function autoResizeChatInput() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.style.height = 'auto';
    const max = 180; // 约8-9行
    input.style.height = `${Math.min(input.scrollHeight, max)}px`;
}

async function sendProjectChatMessage() {
    if (!currentProject) return;
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (!input || !btn) return;
    const text = (input.value || '').trim();
    if (!text) return;
    showLoading(btn, '发送中...');
    const msgEl = document.getElementById('chatMessages');
    if (msgEl) {
        const now = new Date().toLocaleString();
        const userBubble = document.createElement('div');
        userBubble.className = 'border rounded p-2 bg-indigo-50 border-indigo-200 ml-12';
        userBubble.innerHTML = `
          <div class="text-xs text-slate-500">你 · ${now}</div>
          <div class="text-sm whitespace-pre-wrap break-words">${escapeHtml(text)}</div>
        `;
        msgEl.appendChild(userBubble);
        const pending = document.createElement('div');
        pending.className = 'border rounded p-2 bg-amber-50 border-amber-200 mr-12';
        pending.id = 'chatPendingAssistant';
        pending.innerHTML = `
          <div class="text-xs text-slate-500">AI · ${now}</div>
          <div class="text-sm text-amber-700">正在生成回复，请稍候...</div>
        `;
        msgEl.appendChild(pending);
        msgEl.scrollTop = msgEl.scrollHeight;
    }
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/chat`, {
            method: 'POST',
            body: JSON.stringify({ message: text, save_version: true })
        });
        input.value = '';
        autoResizeChatInput();
        await refreshProjectChatModal();
    } catch (e) {
        const pending = document.getElementById('chatPendingAssistant');
        if (pending) {
            pending.className = 'border rounded p-2 bg-red-50 border-red-200 mr-12';
            pending.querySelector('.text-sm').textContent = `生成失败：${e.message}`;
        }
        await uiAlert('发送失败: ' + e.message);
    } finally {
        hideLoading(btn, '发送');
    }
}

async function applyProjectChatProposal(messageId) {
    if (!currentProject) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/apply`, {
            method: 'POST',
            body: JSON.stringify({ message_id: messageId, summary: '聊天应用候选' })
        });
        await refreshProjectChatModal();
        if (currentChatModule === 'master_outline') await loadMasterOutline(currentProject.id);
        if (currentChatModule === 'creative_profile') await loadCreativeProfile(currentProject.id);
        if (currentChatModule === 'world') await loadWorldSetting(currentProject.id);
        if (currentChatModule === 'characters') await loadCharacters(currentProject.id);
        if (currentChatModule === 'outline') await loadOutline(currentProject.id);
    } catch (e) {
        await uiAlert('应用失败: ' + e.message);
    }
}

async function finalizeFromConversationInModal() {
    if (!currentProject) return;
    const ok = await uiConfirm('确认把当前对话整理成新版本吗？');
    if (!ok) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/finalize`, { method: 'POST' });
        await refreshProjectChatModal();
    } catch (e) {
        await uiAlert('整理失败: ' + e.message);
    }
}

async function publishProjectChatVersion(versionId) {
    if (!currentProject) return;
    const ok = await uiConfirm('确认设为正式版并覆盖当前内容吗？');
    if (!ok) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}/publish`, { method: 'POST' });
        await refreshProjectChatModal();
        if (currentChatModule === 'master_outline') await loadMasterOutline(currentProject.id);
        if (currentChatModule === 'creative_profile') await loadCreativeProfile(currentProject.id);
        if (currentChatModule === 'world') await loadWorldSetting(currentProject.id);
        if (currentChatModule === 'characters') await loadCharacters(currentProject.id);
        if (currentChatModule === 'outline') await loadOutline(currentProject.id);
    } catch (e) {
        await uiAlert('发布失败: ' + e.message);
    }
}

async function publishProjectChatVersionMerge(versionId) {
    if (!currentProject) return;
    const ok = await uiConfirm('确认按“增量合并”设为正式版吗？仅更新本版本涉及的卷/章。');
    if (!ok) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}/publish-merge`, { method: 'POST' });
        await refreshProjectChatModal();
        if (currentChatModule === 'outline') await loadOutline(currentProject.id);
        await uiAlert('已按增量合并设为正式版');
    } catch (e) {
        await uiAlert('增量发布失败: ' + e.message);
    }
}

async function previewProjectChatVersionMerge(versionId) {
    if (!currentProject || currentChatModule !== 'outline') return;
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}/publish-merge-preview`);
        const p = (res && res.preview) || {};
        const rows = Array.isArray(p.volumes) ? p.volumes : [];
        const lines = rows.length
            ? rows.map(v => `第${v.volume_index}卷 ${v.volume_title}：新增${v.add_chapters}章，覆盖${v.update_chapters}章（输入${v.incoming_chapters}章）`).join('\n')
            : '未识别到可合并的卷章数据';
        await uiAlert(`增量发布预览：\n\n${lines}\n\n合计：新增${p.total_add_chapters || 0}章，覆盖${p.total_update_chapters || 0}章`);
    } catch (e) {
        await uiAlert('预览失败: ' + e.message);
    }
}

async function restoreProjectChatVersion(versionId) {
    if (!currentProject) return;
    const ok = await uiConfirm('确认回滚到这个版本吗？');
    if (!ok) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}/restore`, { method: 'POST' });
        await refreshProjectChatModal();
    } catch (e) {
        await uiAlert('回滚失败: ' + e.message);
    }
}

async function diffProjectChatVersion(versionId) {
    if (!currentProject) return;
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentChatModule}/versions/${versionId}/diff`);
        const diff = res.diff || '无差异';
        const html = `
            <div id="chatDiffModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[95]">
              <div class="bg-white rounded-lg p-4 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-2">
                  <h3 class="font-semibold">版本差异</h3>
                  <button onclick="document.getElementById('chatDiffModal').remove()" class="px-2 py-1 border rounded">关闭</button>
                </div>
                <pre class="text-xs bg-slate-900 text-slate-100 p-3 rounded overflow-x-auto">${escapeHtml(diff)}</pre>
              </div>
            </div>`;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        document.body.appendChild(holder.firstElementChild);
    } catch (e) {
        await uiAlert('对比失败: ' + e.message);
    }
}

// 切换Tab
function switchTab(tab) {
    currentTab = tab;

    // 更新按钮样式
    const tabWrap = document.getElementById('projectTabButtons');
    if (tabWrap) {
        tabWrap.querySelectorAll('button[data-tab-key]').forEach((btn) => {
            const btnTab = btn.getAttribute('data-tab-key');
            btn.className = `shrink-0 py-2.5 md:py-3 px-3 md:px-4 text-xs md:text-sm font-medium ${btnTab === tab ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' : 'text-gray-500 hover:text-gray-700'}`;
        });
        // 滚动到可见的 tab
        const activeBtn = tabWrap.querySelector(`button[data-tab-key="${tab}"]`);
        if (activeBtn) {
            activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    const contentEl = document.getElementById('tabContent');
    const projectId = currentProject.id;

    if (tab === 'world') {
        contentEl.innerHTML = `
            <div class="mb-3 flex flex-wrap justify-end gap-2">
                <button onclick="openManualEditCurrentTab(${projectId}, 'creative_profile')" class="px-3 py-2 bg-indigo-600 text-white rounded text-sm mobile-tap-target">手动编辑</button>
            </div>
            <div id="worldSettingBody">
                <p class="text-gray-500 italic text-sm">尚未设置题材定位</p>
            </div>
            <div id="workbenchPanel" class="mt-4 md:mt-6"></div>
        `;
        loadCreativeProfile(projectId);
        loadWorkbench(projectId, 'creative_profile');
    } else if (tab === 'master_outline') {
        contentEl.innerHTML = `
            <div class="mb-3 p-2.5 md:p-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded text-xs md:text-sm text-indigo-800 dark:text-indigo-200">
                对话是主体：先在工作台持续对话，满意后"整理成版本"，再"设为正式版"。后续卷纲生成将强依赖这里的正式总纲。
            </div>
            <div class="mb-3 flex flex-wrap justify-end gap-2">
                <button onclick="openManualEditCurrentTab(${projectId}, 'master_outline')" class="px-3 py-2 bg-indigo-600 text-white rounded text-sm mobile-tap-target">手动编辑</button>
            </div>
            <div id="masterOutlineBody" class="mb-4">
                <p class="text-gray-500 italic text-sm">尚未沉淀总纲，请先用下方工作台对话生成。</p>
            </div>
            <div id="workbenchPanel" class="mt-2"></div>
        `;
        loadMasterOutline(projectId);
        loadWorkbench(projectId, 'master_outline');
    } else if (tab === 'characters') {
        contentEl.innerHTML = `
            <div class="mb-3 md:mb-4 flex flex-wrap justify-end gap-1.5 md:gap-2">
                <button onclick="openManualEditCurrentTab(${projectId}, 'characters')" class="px-2.5 md:px-4 py-1.5 md:py-2 bg-indigo-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                    手动编辑
                </button>
                <button onclick="showAddCharacter(${projectId})" class="px-2.5 md:px-4 py-1.5 md:py-2 bg-gray-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                    添加角色
                </button>
                <button onclick="generateCharacters(${projectId})" id="btnGenerateChars" class="px-2.5 md:px-4 py-1.5 md:py-2 bg-indigo-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                    AI生成角色
                </button>
                <button onclick="deleteAllCharacters(${projectId})" class="px-2.5 md:px-4 py-1.5 md:py-2 bg-red-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                    清空所有
                </button>
            </div>
            <div id="characterListBody">
                <p class="text-gray-500 italic text-sm">尚未生成角色</p>
            </div>
            <div id="workbenchPanel" class="mt-4 md:mt-6"></div>
        `;
        loadCharacters(projectId);
        loadWorkbench(projectId, 'characters');
    } else if (tab === 'outline') {
        contentEl.innerHTML = `
            <div class="mb-3 flex flex-wrap justify-end gap-2">
                <button onclick="openManualEditCurrentTab(${projectId}, 'outline')" class="px-3 py-2 bg-indigo-600 text-white rounded text-sm mobile-tap-target">手动编辑</button>
            </div>
            <div class="mb-3 md:mb-4 bg-blue-50 dark:bg-blue-900/30 p-2.5 md:p-3 rounded text-xs md:text-sm">
                <p class="text-blue-800 dark:text-blue-200">💡 推荐先用下方<strong>卷纲聊天工作台</strong>持续迭代。分步生成按钮放在"高级生成"里，仅作辅助入口。</p>
            </div>
            <div class="mb-3 md:mb-4 flex flex-wrap gap-2">
                <button onclick="toggleOutlineAdvanced()" class="px-3 py-2 border rounded text-sm mobile-tap-target">高级生成（展开/收起）</button>
                <button id="outlineViewVolumeBtn" onclick="setOutlineViewMode('volume', ${projectId})" class="px-3 py-2 rounded text-sm bg-indigo-600 text-white mobile-tap-target">按卷视图</button>
                <button id="outlineViewChapterBtn" onclick="setOutlineViewMode('chapter', ${projectId})" class="px-3 py-2 rounded text-sm border mobile-tap-target">按章视图</button>
            </div>
            <div id="outlineAdvancedBox" class="hidden">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div>
                        <label class="block text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-1">目标卷</label>
                        <select id="batchTargetVolume" class="w-full px-2 py-1.5 border rounded text-sm mobile-tap-target"></select>
                    </div>
                    <div>
                        <label class="block text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-1">总章节数</label>
                        <input type="number" id="totalChapters" value="50" min="10" max="100" class="w-full px-2 py-1.5 border rounded text-sm">
                    </div>
                    <div>
                        <label class="block text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-1">每批生成</label>
                        <input type="number" id="batchSize" value="10" min="5" max="30" class="w-full px-2 py-1.5 border rounded text-sm">
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 mb-4">
                    <button onclick="generateNextVolumeSkeleton(${projectId})" id="btnGenerateSkeleton" class="px-3 md:px-4 py-2 bg-purple-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                        1. 生成卷骨架
                    </button>
                    <button onclick="generateNextBatch(${projectId})" id="btnGenerateBatch" class="px-3 md:px-4 py-2 bg-indigo-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                        2. 生成下一批章节
                    </button>
                    <button onclick="generateAllRemainingChapters(${projectId})" id="btnGenerateAllRemaining" class="px-3 md:px-4 py-2 bg-emerald-600 text-white rounded text-xs md:text-sm mobile-tap-target">
                        3. 一键补齐本卷
                    </button>
                </div>
            </div>
            <div id="outlineContent" class="space-y-2 md:space-y-3">
                <p class="text-gray-500 italic text-sm">尚未生成大纲，点击上方按钮开始分步生成</p>
            </div>
            <div id="workbenchPanel" class="mt-4 md:mt-6"></div>
        `;
        updateOutlineViewButtons();
        loadOutline(projectId);
        loadWorkbench(projectId, 'outline');
    } else if (tab === 'write') {
        contentEl.innerHTML = `
            <div id="writeContent" class="space-y-3">
                <div class="border rounded-lg p-3 md:p-4 bg-indigo-50 dark:bg-indigo-900/30">
                    <div class="font-semibold text-sm md:text-base text-gray-800 dark:text-gray-200">正文批量生成（连续剧情模式）</div>
                    <div class="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">推荐每批 <strong>5章</strong>：稳定、连贯、失败重试成本低。下一批会自动从未生成章节继续，并继承前文上下文。</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 mt-3">
                        <div class="sm:col-span-2 lg:col-span-2">
                            <label class="block text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-1">目标卷</label>
                            <select id="writeBatchVolume" class="w-full px-3 py-2 border rounded text-sm mobile-tap-target"></select>
                        </div>
                        <div>
                            <label class="block text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-1">每批章数</label>
                            <input id="writeBatchSize" type="number" min="1" max="10" value="5" class="w-full px-3 py-2 border rounded text-sm">
                        </div>
                        <div>
                            <label class="block text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-1">目标字数（可选）</label>
                            <input id="writeBatchTargetWords" type="number" min="500" max="20000" step="100" placeholder="留空=按章配置" class="w-full px-3 py-2 border rounded text-sm">
                        </div>
                    </div>
                    <div id="writeBatchPendingInfo" class="text-[10px] md:text-xs text-gray-600 dark:text-gray-400 mt-2"></div>
                    <div class="flex flex-wrap gap-2 mt-3">
                        <button id="btnWriteBatchNext" onclick="generateWriteNextBatch(${projectId})" class="px-3 md:px-4 py-2 bg-indigo-600 text-white rounded text-xs md:text-sm mobile-tap-target">生成下一批正文</button>
                        <button id="btnWriteBatchAll" onclick="generateWriteAllRemaining(${projectId})" class="px-3 md:px-4 py-2 bg-emerald-600 text-white rounded text-xs md:text-sm mobile-tap-target">一键补齐本卷</button>
                    </div>
                    <div id="writeBatchProgressWrap" class="hidden mt-3">
                        <div class="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                            <span id="writeBatchProgressText">准备中...</span>
                            <span id="writeBatchProgressPercent">0%</span>
                        </div>
                        <div class="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div id="writeBatchProgressBar" class="h-2 bg-indigo-600 transition-all duration-300" style="width:0%"></div>
                        </div>
                    </div>
                    <div id="writeBatchResult" class="text-xs mt-2 text-gray-600 dark:text-gray-400"></div>
                    <div id="writeBatchFailedBox" class="hidden mt-3 border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 rounded p-2">
                        <div class="flex items-center justify-between">
                            <div class="text-xs font-medium text-amber-800 dark:text-amber-200">失败章节列表</div>
                            <button id="btnWriteRetryFailed" onclick="retryWriteFailedChapters()" class="px-2 py-1 text-xs bg-amber-600 text-white rounded mobile-tap-target">重试失败章节</button>
                        </div>
                        <div id="writeBatchFailedList" class="mt-2 text-xs text-amber-900 dark:text-amber-100 space-y-1"></div>
                    </div>
                </div>
                <div class="text-center py-6 md:py-8 text-gray-500 text-sm" id="writeEmpty">
                    <p>请先生成大纲和章节，生成好的正文会显示在这里</p>
                </div>
                <div id="generatedChapters" class="hidden space-y-3 md:space-y-4"></div>
            </div>
        `;
        loadWriteBatchPanel(projectId);
        loadGeneratedChapters(projectId);
    } else if (tab === 'read') {
        const fs = Number(readingState?.settings?.fontSize || 20);
        const lh = Number(readingState?.settings?.lineHeight || 1.95);
        const rw = Number(readingState?.settings?.width || 840);
        contentEl.innerHTML = `
            <div class="space-y-3">
                <div class="border rounded-lg p-2.5 md:p-3 bg-slate-50 dark:bg-gray-700">
                    <div class="font-semibold text-sm md:text-base text-slate-800 dark:text-slate-200">小说阅读模式</div>
                    <div class="text-[10px] md:text-xs text-slate-600 dark:text-slate-400 mt-1">支持 Web + H5：目录跳章、上一章/下一章、字号与排版宽度可调。</div>
                    <div class="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mt-2 md:mt-3">
                        <div class="col-span-2 md:col-span-2">
                            <label class="block text-[10px] md:text-xs text-gray-600 dark:text-gray-400 mb-1">卷目录</label>
                            <select id="readVolumeSelect" class="w-full px-2 md:px-3 py-1.5 md:py-2 border rounded text-sm mobile-tap-target" onchange="handleReadVolumeChange()"></select>
                        </div>
                        <div>
                            <label class="block text-[10px] md:text-xs text-gray-600 dark:text-gray-400 mb-1">字号</label>
                            <input id="readerFontSize" type="number" min="14" max="34" step="1" value="${fs}" class="w-full px-2 py-1.5 md:py-2 border rounded text-sm" onchange="updateReaderSettings()">
                        </div>
                        <div>
                            <label class="block text-[10px] md:text-xs text-gray-600 dark:text-gray-400 mb-1">行距</label>
                            <input id="readerLineHeight" type="number" min="1.4" max="2.8" step="0.05" value="${lh}" class="w-full px-2 py-1.5 md:py-2 border rounded text-sm" onchange="updateReaderSettings()">
                        </div>
                        <div class="hidden md:block">
                            <label class="block text-[10px] md:text-xs text-gray-600 dark:text-gray-400 mb-1">排版宽度</label>
                            <input id="readerWidth" type="number" min="560" max="1100" step="10" value="${rw}" class="w-full px-2 py-1.5 md:py-2 border rounded text-sm" onchange="updateReaderSettings()">
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-2 md:gap-3 min-h-[50vh] md:min-h-[68vh]">
                    <aside class="lg:col-span-4 border rounded-lg bg-white dark:bg-gray-800 flex flex-col min-h-[30vh] md:min-h-[68vh]">
                        <div class="px-3 py-2 border-b flex items-center justify-between">
                            <div class="font-medium text-sm md:text-base text-slate-800 dark:text-slate-200">章节目录</div>
                            <button onclick="toggleReadMobileToc()" class="lg:hidden text-xs px-2 py-1 border rounded mobile-tap-target">展开/收起</button>
                        </div>
                        <div id="readTocList" class="hidden lg:block flex-1 min-h-0 overflow-y-auto p-2 space-y-1"></div>
                        <div id="readTocListMobile" class="lg:hidden flex-1 min-h-0 overflow-y-auto p-2 space-y-1 hidden"></div>
                    </aside>
                    <section class="lg:col-span-8 border rounded-lg bg-white dark:bg-gray-800 flex flex-col min-h-[50vh] md:min-h-[68vh]">
                        <div class="px-2.5 md:px-3 py-2 border-b bg-slate-50 dark:bg-gray-700">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex-1 min-w-0">
                                    <div id="readChapterTitle" class="font-semibold text-sm md:text-base text-slate-900 dark:text-slate-100 truncate">请选择章节</div>
                                    <div id="readChapterMeta" class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 mt-0.5">未选择</div>
                                </div>
                                <div class="hidden md:flex items-center gap-2">
                                    <button onclick="gotoPrevReadChapter()" class="px-2 py-1 border rounded text-sm hover:bg-gray-100 mobile-tap-target">上一章</button>
                                    <button onclick="gotoNextReadChapter()" class="px-2 py-1 border rounded text-sm hover:bg-gray-100 mobile-tap-target">下一章</button>
                                </div>
                            </div>
                            <div class="md:hidden mt-2 flex gap-2">
                                <button onclick="gotoPrevReadChapter()" class="flex-1 px-2 py-1.5 border rounded text-sm mobile-tap-target">上一章</button>
                                <button onclick="gotoNextReadChapter()" class="flex-1 px-2 py-1.5 border rounded text-sm mobile-tap-target">下一章</button>
                            </div>
                        </div>
                        <div id="readChapterBodyWrap" class="flex-1 min-h-0 overflow-y-auto p-3 md:p-6 bg-slate-50 dark:bg-gray-900 mobile-scroll">
                            <article id="readChapterBody" class="reader-content mx-auto text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-7 md:leading-8 text-sm md:text-base"></article>
                            <div id="readEmptyState" class="text-xs md:text-sm text-gray-500 py-8 md:py-10 text-center">当前项目暂无可阅读的已生成章节，请先在"写作"页生成正文。</div>
                        </div>
                    </section>
                </div>
            </div>
        `;
        initReadMode(projectId);
    } else if (tab === 'export') {
        contentEl.innerHTML = `
            <div class="space-y-3 md:space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                    <button onclick="exportFullText(${projectId})" class="px-4 py-2.5 bg-green-600 text-white rounded text-sm mobile-tap-target">导出全文(Markdown)</button>
                    <button onclick="exportFullProject(${projectId})" class="px-4 py-2.5 bg-blue-600 text-white rounded text-sm mobile-tap-target">导出完整项目(含所有设定)</button>
                </div>
                <div class="border rounded p-3 bg-slate-50 dark:bg-gray-700">
                    <div class="font-medium text-sm md:text-base text-slate-800 dark:text-slate-200 mb-2">项目导入/导出（JSON包）</div>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="downloadProjectBundle(${projectId})" class="px-3 py-2 bg-indigo-600 text-white rounded text-sm mobile-tap-target">导出项目JSON</button>
                        <input id="importProjectFile" type="file" accept=".json,application/json" class="text-xs md:text-sm" />
                        <button onclick="importProjectBundle()" class="px-3 py-2 bg-emerald-600 text-white rounded text-sm mobile-tap-target">导入为新项目</button>
                    </div>
                    <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 mt-2">导入不会覆盖当前项目，会新建一个"xxx-导入"项目。</div>
                </div>
                <div id="exportContent" class="mt-4 hidden">
                    <textarea id="fullTextArea" class="w-full h-48 md:h-64 p-2 border rounded bg-gray-50 dark:bg-gray-700 text-sm" readonly></textarea>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <button onclick="copyFullText()" class="px-3 py-1.5 bg-gray-600 text-white rounded text-sm mobile-tap-target">复制</button>
                        <button onclick="downloadFullText(${projectId})" class="px-3 py-1.5 bg-gray-600 text-white rounded text-sm mobile-tap-target">下载全文</button>
                    </div>
                </div>
                <div id="exportProjectContent" class="mt-4 hidden">
                    <textarea id="fullProjectArea" class="w-full h-48 md:h-64 p-2 border rounded bg-gray-50 dark:bg-gray-700 text-sm" readonly></textarea>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <button onclick="copyFullProject()" class="px-3 py-1.5 bg-gray-600 text-white rounded text-sm mobile-tap-target">复制</button>
                         <button onclick="downloadFullProject(${projectId})" class="px-3 py-1.5 bg-gray-600 text-white rounded text-sm mobile-tap-target">下载项目</button>
                    </div>
                </div>
            </div>
        `;
    }
}


function updateOutlineViewButtons() {
    const volBtn = document.getElementById('outlineViewVolumeBtn');
    const chBtn = document.getElementById('outlineViewChapterBtn');
    if (!volBtn || !chBtn) return;
    if (outlineViewMode === 'chapter') {
        chBtn.className = 'px-3 py-2 rounded text-sm bg-indigo-600 text-white';
        volBtn.className = 'px-3 py-2 rounded text-sm border';
    } else {
        volBtn.className = 'px-3 py-2 rounded text-sm bg-indigo-600 text-white';
        chBtn.className = 'px-3 py-2 rounded text-sm border';
    }
}

async function setOutlineViewMode(mode, projectId) {
    outlineViewMode = mode === 'chapter' ? 'chapter' : 'volume';
    updateOutlineViewButtons();
    await loadOutline(projectId);
}

async function tuneCurrentTab(projectId, module) {
    const instruction = await uiPrompt('请输入微调指令（将基于当前页内容做最小改动）');
    if (instruction === null) return;
    if (!instruction.trim()) {
        await uiAlert('微调指令不能为空');
        return;
    }
    try {
        const res = await apiRequest(`/api/workbench/${projectId}/${module}/tune-current`, {
            method: 'POST',
            body: JSON.stringify({ instruction: instruction.trim() })
        });
        await uiAlert(`微调完成，已生成新版本 v${res.new_version_no}`);
        if (module === 'creative_profile') {
            await loadCreativeProfile(projectId);
            await loadWorkbench(projectId, 'creative_profile');
        } else if (module === 'master_outline') {
            await loadMasterOutline(projectId);
            await loadWorkbench(projectId, 'master_outline');
        } else if (module === 'characters') {
            await loadCharacters(projectId);
            await loadWorkbench(projectId, 'characters');
        } else if (module === 'outline') {
            await loadOutline(projectId);
            await loadWorkbench(projectId, 'outline');
        }
    } catch (e) {
        await uiAlert('微调失败: ' + e.message);
    }
}

async function openManualEditCurrentTab(projectId, module) {
    try {
        const state = await apiRequest(`/api/workbench/${projectId}/${module}`);
        const current = state.current || {};
        showManualEditModal(projectId, module, current);
    } catch (e) {
        await uiAlert('加载当前内容失败: ' + e.message);
    }
}

function showManualEditModal(projectId, module, currentData) {
    const modalId = 'manualEditModal';
    const old = document.getElementById(modalId);
    if (old) old.remove();
    const title = `手动编辑 · ${moduleDisplayName(module)}`;
    const isJsonOnly = module === 'characters' || module === 'outline' || Array.isArray(currentData);
    const fieldsHtml = isJsonOnly ? '' : renderManualEditFields(module, currentData || {});
    const jsonValue = JSON.stringify(currentData || {}, null, 2);
    const html = `
      <div id="${modalId}" class="fixed inset-0 bg-black/55 flex items-center justify-center z-[99]">
        <div class="bg-white rounded-xl p-4 max-w-5xl w-[95%] max-h-[90vh] overflow-y-auto border border-slate-200 shadow-2xl">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-slate-800">${escapeHtml(title)}</h3>
            <button onclick="document.getElementById('${modalId}').remove()" class="px-2 py-1 border rounded">关闭</button>
          </div>
          <div class="mb-3">
            <label class="block text-sm text-slate-600 mb-1">版本摘要</label>
            <input id="manualEditSummary" class="w-full px-3 py-2 border rounded" value="手动微调" />
          </div>
          ${!isJsonOnly ? `
          <div class="mb-3">
            <label class="block text-sm text-slate-600 mb-2">结构化编辑</label>
            <div id="manualFieldWrap" class="space-y-3">${fieldsHtml}</div>
          </div>` : `
          <div class="mb-3 text-xs text-slate-500 bg-slate-50 border rounded px-2 py-1">当前模块为列表/复杂结构，建议直接编辑 JSON。</div>`}
          <div class="mb-3">
            <label class="block text-sm text-slate-600 mb-1">JSON 编辑（保存时以此内容为准）</label>
            <textarea id="manualEditJson" class="w-full min-h-[280px] px-3 py-2 border rounded font-mono text-sm whitespace-pre">${escapeHtml(jsonValue)}</textarea>
          </div>
          <div class="flex justify-end gap-2">
            ${!isJsonOnly ? `<button onclick="syncManualFieldsToJson('${module}')" class="px-3 py-2 border rounded">同步结构化到JSON</button>` : ''}
            <button onclick="saveManualEditCurrentTab(${projectId}, '${module}')" class="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">保存为新版本并设为当前</button>
          </div>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
}

function renderManualEditFields(module, data) {
    const field = (key, label, value) => `
      <div>
        <label class="block text-sm text-slate-600 mb-1">${label}</label>
        <textarea data-manual-key="${key}" class="w-full min-h-[72px] px-3 py-2 border rounded whitespace-pre-wrap">${escapeHtml(value || '')}</textarea>
      </div>
    `;
    if (module === 'creative_profile') {
        return [
            field('core_contrast', '核心反差', data.core_contrast),
            field('cheat_cost', '金手指代价', data.cheat_cost),
            field('reader_promise', '读者承诺', data.reader_promise),
            field('unique_mechanism', '独特机制', data.unique_mechanism),
        ].join('');
    }
    if (module === 'master_outline') {
        const dynamicActs = extractMasterOutlineActs(data || {});
        const actFields = dynamicActs.length
            ? dynamicActs.map((txt, idx) => field(`act${idx + 1}`, `第${idx + 1}幕`, txt))
            : [
                field('act1', '第一幕', data.act1),
                field('act2', '第二幕', data.act2),
                field('act3', '第三幕', data.act3),
                field('act4', '第四幕', data.act4),
                field('act5', '第五幕', data.act5),
            ];
        return [
            field('core_promise', '核心承诺', data.core_promise),
            field('target_reader', '目标读者', data.target_reader),
            field('ending', '故事终局', data.ending),
            field('ultimate_truth', '终极真相', data.ultimate_truth),
            field('character_endings', '角色终局', data.character_endings),
            ...actFields,
            field('master_outline', '串联总纲', data.master_outline),
        ].join('');
    }
    if (module === 'world') {
        return [
            field('background', '背景', data.background),
            field('power_system', '力量体系', data.power_system),
            field('geography', '地理', data.geography),
            field('factions', '势力', data.factions),
            field('rules', '规则', data.rules),
        ].join('');
    }
    if (module === 'character_system') {
        return [
            field('arc_design', '主配角成长弧', data.arc_design),
            field('ending_plan', '角色终局规划', data.ending_plan),
            field('taskcard_rule', '任务卡规则', data.taskcard_rule),
        ].join('');
    }
    if (module === 'world_system') {
        return [
            field('rules', '世界规则', data.rules),
            field('costs', '力量代价', data.costs),
            field('resources', '资源系统', data.resources),
            field('limits', '限制条件', data.limits),
        ].join('');
    }
    return '';
}

function syncManualFieldsToJson(module) {
    const wrap = document.getElementById('manualFieldWrap');
    const jsonEl = document.getElementById('manualEditJson');
    if (!wrap || !jsonEl) return;
    const payload = {};
    wrap.querySelectorAll('[data-manual-key]').forEach((el) => {
        payload[el.getAttribute('data-manual-key')] = (el.value || '').trim();
    });
    jsonEl.value = JSON.stringify(payload, null, 2);
}

async function saveManualEditCurrentTab(projectId, module) {
    const summaryEl = document.getElementById('manualEditSummary');
    const jsonEl = document.getElementById('manualEditJson');
    if (!jsonEl) return;
    let content = null;
    try {
        content = JSON.parse(jsonEl.value || '{}');
    } catch (e) {
        await uiAlert('JSON 格式不正确，请先修正再保存');
        return;
    }
    const summary = (summaryEl && summaryEl.value ? summaryEl.value : '手动微调').trim() || '手动微调';
    try {
        const res = await apiRequest(`/api/workbench/${projectId}/${module}/save-current-version`, {
            method: 'POST',
            body: JSON.stringify({ content, summary })
        });
        const modal = document.getElementById('manualEditModal');
        if (modal) modal.remove();
        await uiAlert(`保存成功，已生成新版本 v${res.new_version_no}`);
        if (module === 'creative_profile' || module === 'world') {
            await loadCreativeProfile(projectId);
            await loadWorkbench(projectId, 'creative_profile');
        } else if (module === 'master_outline') {
            await loadMasterOutline(projectId);
            await loadWorkbench(projectId, 'master_outline');
        } else if (module === 'characters') {
            await loadCharacters(projectId);
            await loadWorkbench(projectId, 'characters');
        } else if (module === 'outline') {
            await loadOutline(projectId);
            await loadWorkbench(projectId, 'outline');
        } else if (module === 'character_system') {
            await loadWorkbench(projectId, 'character_system');
        } else if (module === 'world_system') {
            await loadWorkbench(projectId, 'world_system');
        }
    } catch (e) {
        await uiAlert('保存失败: ' + e.message);
    }
}

function toggleOutlineAdvanced() {
    const box = document.getElementById('outlineAdvancedBox');
    if (!box) return;
    box.classList.toggle('hidden');
}

// ========== 项目创建 ==========
function showCreateProject() {
    document.getElementById('createProjectModal').classList.remove('hidden');
}

function hideCreateProject() {
    document.getElementById('createProjectModal').classList.add('hidden');
}

async function createProject(e) {
    e.preventDefault();
    const data = {
        title: document.getElementById('projectTitle').value,
        description: document.getElementById('projectDescription').value,
        genre: document.getElementById('projectGenre').value,
        enable_review: document.getElementById('enableReview').checked,
        target_words_per_chapter: parseInt(document.getElementById('targetWords').value) || 2000,
        user_prompt: document.getElementById('projectDescription').value
    };

    try {
        await apiRequest('/api/projects/', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        hideCreateProject();
        loadProjects();
        uiAlert('创建成功！');
    } catch (e) {
        uiAlert('创建失败: ' + e.message);
    }
}

// ========== 世界观 ==========
async function loadWorldSetting(projectId) {
    const el = document.getElementById('worldSettingBody');
    if (!el) return;
    try {
        const world = await apiRequest(`/api/projects/${projectId}/world`);
        let html = '';

        if (world.background) {
            html += `<div class="mb-3">
                <div class="font-medium text-sm text-gray-600 mb-1">背景历史</div>
                <div class="p-3 bg-gray-50 rounded whitespace-pre-wrap">${escapeHtml(world.background)}</div>
            </div>`;
        }
        if (world.power_system) {
            html += `<div class="mb-3">
                <div class="font-medium text-sm text-gray-600 mb-1">力量体系</div>
                <div class="p-3 bg-gray-50 rounded whitespace-pre-wrap">${escapeHtml(world.power_system)}</div>
            </div>`;
        }
        if (world.geography) {
            html += `<div class="mb-3">
                <div class="font-medium text-sm text-gray-600 mb-1">地理设定</div>
                <div class="p-3 bg-gray-50 rounded whitespace-pre-wrap">${escapeHtml(world.geography)}</div>
            </div>`;
        }
        if (world.factions) {
            html += `<div class="mb-3">
                <div class="font-medium text-sm text-gray-600 mb-1">势力组织</div>
                <div class="p-3 bg-gray-50 rounded whitespace-pre-wrap">${escapeHtml(world.factions)}</div>
            </div>`;
        }
        if (world.rules) {
            html += `<div class="mb-3">
                <div class="font-medium text-sm text-gray-600 mb-1">世界规则</div>
                <div class="p-3 bg-gray-50 rounded whitespace-pre-wrap">${escapeHtml(world.rules)}</div>
            </div>`;
        }

        if (html === '') {
            html = `<p class="text-gray-500 italic">尚未生成世界观设定</p>`;
        }

        html += `<button onclick="editWorldSetting(${projectId})" class="mt-2 px-3 py-1 border border-indigo-600 text-indigo-600 rounded hover:bg-indigo-50 transition">编辑</button>`;
        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = `<p class="text-gray-500 italic">${e.message}</p>`;
    }
}

async function loadMasterOutline(projectId) {
    const el = document.getElementById('masterOutlineBody');
    if (!el) return;
    try {
        const project = await apiRequest(`/api/projects/${projectId}`);
        const text = (project.master_outline || '').trim();
        if (!text) {
            el.innerHTML = `<p class="text-gray-500 italic">当前还没有正式总纲。请在下方工作台中对话生成并设为正式版。</p>`;
            return;
        }
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) {}
        if (parsed && typeof parsed === 'object') {
            const dynamicActs = extractMasterOutlineActs(parsed);
            const rows = [
                { k: '核心承诺', v: parsed.core_promise || '' },
                { k: '目标读者', v: parsed.target_reader || '' },
                { k: '故事终局', v: parsed.ending || '' },
                { k: '世界终极真相', v: parsed.ultimate_truth || '' },
                { k: '角色终局', v: parsed.character_endings || '' },
            ];
            dynamicActs.forEach((a, idx) => rows.push({ k: `第${idx + 1}幕`, v: a }));
            let html = `
                <div class="mb-2 flex items-center justify-between">
                    <h3 class="font-semibold text-gray-800">当前正式总纲</h3>
                    <span class="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">已生效</span>
                </div>
            `;
            rows.forEach(r => {
                if (!r.v) return;
                html += `<div class="mb-2 border rounded p-3 bg-gray-50">
                    <div class="text-sm font-medium text-gray-700 mb-1">${r.k}</div>
                    <div class="text-sm whitespace-pre-wrap">${escapeHtml(r.v)}</div>
                </div>`;
            });
            if (parsed.master_outline) {
                html += `<div class="mt-2 border rounded p-3 bg-white">
                    <div class="text-sm font-medium text-gray-700 mb-1">串联总纲</div>
                    <div class="text-sm whitespace-pre-wrap">${escapeHtml(parsed.master_outline)}</div>
                </div>`;
            }
            el.innerHTML = html;
            return;
        }
        el.innerHTML = `
            <div class="mb-2 flex items-center justify-between">
                <h3 class="font-semibold text-gray-800">当前正式总纲</h3>
                <span class="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">已生效</span>
            </div>
            <div class="p-3 bg-gray-50 border rounded whitespace-pre-wrap text-sm">${escapeHtml(text)}</div>
        `;
    } catch (e) {
        el.innerHTML = `<p class="text-red-600 text-sm">加载总纲失败：${escapeHtml(e.message || '')}</p>`;
    }
}

async function loadCreativeProfile(projectId) {
    try {
        const profile = await apiRequest(`/api/projects/${projectId}/creative-profile`);
        const el = document.getElementById('worldSettingBody');
        if (!el) return;
        const rows = [
            { k: '核心反差', v: profile.core_contrast || '' },
            { k: '金手指代价', v: profile.cheat_cost || '' },
            { k: '读者承诺', v: profile.reader_promise || '' },
            { k: '独特机制', v: profile.unique_mechanism || '' },
        ];
        let html = '';
        rows.forEach(r => {
            html += `<div class="mb-3">
                <div class="font-medium text-sm text-gray-600 mb-1">${r.k}</div>
                <div class="p-3 bg-gray-50 rounded whitespace-pre-wrap">${escapeHtml(r.v || '（未填写）')}</div>
            </div>`;
        });
        el.innerHTML = html;
    } catch (e) {
        const el = document.getElementById('worldSettingBody');
        if (el) el.innerHTML = `<p class="text-red-600 text-sm">加载题材定位失败：${escapeHtml(e.message || '')}</p>`;
    }
}

async function generateWorld(projectId) {
    if (!await uiConfirm('确定要生成世界观吗？会覆盖已有的内容。')) return;

    const btn = document.getElementById('btnGenerateWorld');
    const oldHtml = btn.innerHTML;
    showLoading(btn);

    const userPrompt = await uiPrompt('请输入额外要求（留空使用项目描述）：') || '';

    try {
        await apiRequest(`/api/projects/${projectId}/generate-world?user_prompt=${encodeURIComponent(userPrompt)}`, {
            method: 'POST'
        });
        loadWorldSetting(projectId);
        uiAlert('生成成功！切换到下一步继续。');
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        hideLoading(btn, oldHtml);
    }
}

// ========== 角色 ==========
async function loadCharacters(projectId) {
    try {
        const chars = await apiRequest(`/api/characters/${projectId}`);
        const el = document.getElementById('characterListBody');
        let html = '';
        if (chars.length === 0) {
            html += `<p class="text-gray-500 italic text-sm">尚未生成角色</p>`;
        } else {
            html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">';
            chars.forEach(c => {
                const badge = c.is_main ? '<span class="ml-2 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-[10px] md:text-xs">主角</span>' : '';
                html += `
                    <div class="border rounded p-2.5 md:p-3 hover:shadow-sm transition bg-white dark:bg-gray-800">
                        <div class="font-medium flex items-center justify-between gap-2">
                            <span class="text-sm md:text-base truncate">${escapeHtml(c.name)}${badge}</span>
                            <div class="flex gap-1 shrink-0">
                                <button onclick="editCharacter(${projectId}, ${c.id})" class="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-[10px] md:text-xs rounded mobile-tap-target">编辑</button>
                                <button onclick="deleteCharacter(${c.id}, ${projectId})" class="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-[10px] md:text-xs rounded mobile-tap-target">删除</button>
                            </div>
                        </div>
                        ${c.role ? `<div class="text-xs md:text-sm mt-1"><span class="text-gray-600 dark:text-gray-400">定位：</span>${escapeHtml(c.role)}</div>` : ''}
                        ${c.avatar ? `<div class="text-xs md:text-sm mt-1"><span class="text-gray-600 dark:text-gray-400">外貌：</span>${escapeHtml(c.avatar)}</div>` : ''}
                        ${c.personality ? `<div class="text-xs md:text-sm mt-1"><span class="text-gray-600 dark:text-gray-400">性格：</span>${escapeHtml(c.personality)}</div>` : ''}
                        ${c.background ? `<div class="text-xs md:text-sm mt-1 line-clamp-2"><span class="text-gray-600 dark:text-gray-400">背景：</span>${escapeHtml(c.background)}</div>` : ''}
                        ${c.relationships ? `<div class="text-xs md:text-sm mt-1 line-clamp-2"><span class="text-gray-600 dark:text-gray-400">关系：</span>${escapeHtml(c.relationships)}</div>` : ''}
                    </div>
                `;
            });
            html += '</div>';
        }

        html += `
            <div class="mt-4 md:mt-6 border rounded-lg p-3 md:p-4 bg-gray-50 dark:bg-gray-700">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="font-semibold text-sm md:text-base text-gray-800 dark:text-gray-200">关系图管理（群像）</h3>
                    <button onclick="loadCharacterRelationships(${projectId})" class="px-2 md:px-3 py-1 text-[10px] md:text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded mobile-tap-target">刷新关系</button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
                    <select id="relSource" class="px-2 py-1.5 border rounded text-xs md:text-sm mobile-tap-target"></select>
                    <select id="relTarget" class="px-2 py-1.5 border rounded text-xs md:text-sm mobile-tap-target"></select>
                    <input id="relType" type="text" value="ally" placeholder="关系类型 ally/enemy/family..." class="px-2 py-1.5 border rounded text-xs md:text-sm">
                    <input id="relIntensity" type="number" min="0" max="1" step="0.1" value="0.7" class="px-2 py-1.5 border rounded text-xs md:text-sm">
                    <button onclick="createCharacterRelationship(${projectId})" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs md:text-sm mobile-tap-target">新增/覆盖关系</button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    <input id="relStatus" type="text" value="stable" placeholder="状态，如 stable/hostile/trust-broken" class="px-2 py-1.5 border rounded text-xs md:text-sm">
                    <input id="relNotes" type="text" placeholder="备注（可选）" class="px-2 py-1.5 border rounded text-xs md:text-sm">
                </div>
                <div id="relationshipListBody" class="space-y-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                    <p class="text-gray-500 italic">尚未加载关系</p>
                </div>
            </div>
        `;

        el.innerHTML = html;
        populateRelationshipCharacterOptions(chars);
        await loadCharacterRelationships(projectId, chars);
    } catch (e) {
        console.error(e);
    }
}

function populateRelationshipCharacterOptions(chars) {
    const sourceEl = document.getElementById('relSource');
    const targetEl = document.getElementById('relTarget');
    if (!sourceEl || !targetEl) return;
    sourceEl.innerHTML = '';
    targetEl.innerHTML = '';

    if (!chars || chars.length === 0) {
        sourceEl.innerHTML = '<option value="">请先创建角色</option>';
        targetEl.innerHTML = '<option value="">请先创建角色</option>';
        return;
    }

    chars.forEach(c => {
        const label = `${c.name}${c.is_main ? '（主角）' : ''}`;
        const s = document.createElement('option');
        s.value = c.id;
        s.textContent = label;
        sourceEl.appendChild(s);

        const t = document.createElement('option');
        t.value = c.id;
        t.textContent = label;
        targetEl.appendChild(t);
    });
}

function relationLabelById(chars, id) {
    const hit = (chars || []).find(c => c.id === id);
    return hit ? hit.name : `#${id}`;
}

async function loadCharacterRelationships(projectId, chars = null) {
    try {
        const listEl = document.getElementById('relationshipListBody');
        if (!listEl) return;
        const resolvedChars = chars || await apiRequest(`/api/characters/${projectId}`);
        const edges = await apiRequest(`/api/characters/relationships/${projectId}`);
        if (!edges.length) {
            listEl.innerHTML = '<p class="text-gray-500 italic">暂无关系边，先在上面新增一条。</p>';
            return;
        }

        let html = '';
        edges.forEach(e => {
            html += `
                <div class="border rounded p-2 bg-white">
                    <div class="flex justify-between items-center gap-2">
                        <div>
                            <span class="font-medium">${escapeHtml(relationLabelById(resolvedChars, e.source_character_id))}</span>
                            <span class="mx-1 text-gray-500">→</span>
                            <span class="font-medium">${escapeHtml(relationLabelById(resolvedChars, e.target_character_id))}</span>
                            <span class="ml-2 px-2 py-0.5 bg-gray-100 rounded text-xs">${escapeHtml(e.relation_type || 'relation')}</span>
                            <span class="ml-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">强度 ${Number(e.intensity || 0).toFixed(1)}</span>
                            <span class="ml-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs">${escapeHtml(e.status || 'stable')}</span>
                        </div>
                        <div class="space-x-1">
                            <button onclick="quickEditRelationship(${e.id}, ${projectId})" class="px-2 py-1 bg-gray-100 text-xs rounded hover:bg-gray-200">编辑</button>
                            <button onclick="deleteRelationship(${e.id}, ${projectId})" class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200">删除</button>
                        </div>
                    </div>
                    ${e.notes ? `<div class="mt-1 text-xs text-gray-600">备注：${escapeHtml(e.notes)}</div>` : ''}
                </div>
            `;
        });
        listEl.innerHTML = html;
    } catch (e) {
        console.error(e);
    }
}

async function createCharacterRelationship(projectId) {
    const sourceId = parseInt(document.getElementById('relSource')?.value || '0', 10);
    const targetId = parseInt(document.getElementById('relTarget')?.value || '0', 10);
    const relationType = (document.getElementById('relType')?.value || '').trim() || 'ally';
    const intensity = parseFloat(document.getElementById('relIntensity')?.value || '0.7');
    const status = (document.getElementById('relStatus')?.value || '').trim() || 'stable';
    const notes = (document.getElementById('relNotes')?.value || '').trim();

    if (!sourceId || !targetId) {
        uiAlert('请选择关系两端角色');
        return;
    }
    if (sourceId === targetId) {
        uiAlert('关系两端不能是同一角色');
        return;
    }

    try {
        await apiRequest(`/api/characters/relationships/${projectId}`, {
            method: 'POST',
            body: JSON.stringify({
                source_character_id: sourceId,
                target_character_id: targetId,
                relation_type: relationType,
                intensity: Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0.7)),
                status: status,
                notes: notes
            })
        });
        await loadCharacterRelationships(projectId);
    } catch (e) {
        uiAlert('新增关系失败: ' + e.message);
    }
}

async function quickEditRelationship(relationshipId, projectId) {
    const relationType = await uiPrompt('关系类型（ally/enemy/family/love/rival...）');
    if (relationType === null) return;
    const intensityInput = await uiPrompt('关系强度 0~1（如 0.8）');
    if (intensityInput === null) return;
    const status = await uiPrompt('关系状态（stable/hostile/trust-broken...）', 'stable');
    if (status === null) return;
    const notes = await uiPrompt('备注（可选）', '');
    if (notes === null) return;

    const intensity = parseFloat(intensityInput);
    if (!Number.isFinite(intensity)) {
        uiAlert('强度格式错误');
        return;
    }

    try {
        await apiRequest(`/api/characters/relationships/${relationshipId}`, {
            method: 'PUT',
            body: JSON.stringify({
                relation_type: relationType.trim() || 'ally',
                intensity: Math.max(0, Math.min(1, intensity)),
                status: status.trim() || 'stable',
                notes: notes
            })
        });
        await loadCharacterRelationships(projectId);
    } catch (e) {
        uiAlert('更新关系失败: ' + e.message);
    }
}

async function deleteRelationship(relationshipId, projectId) {
    if (!await uiConfirm('确定删除这条关系吗？')) return;
    try {
        await apiRequest(`/api/characters/relationships/${relationshipId}`, {
            method: 'DELETE'
        });
        await loadCharacterRelationships(projectId);
    } catch (e) {
        uiAlert('删除关系失败: ' + e.message);
    }
}

async function generateCharacters(projectId) {
    if (!await uiConfirm('确定要生成角色吗？会添加新角色。')) return;

    const btn = document.getElementById('btnGenerateChars');
    const oldHtml = btn.innerHTML;
    showLoading(btn);

    const userPrompt = await uiPrompt('请输入额外要求（留空使用项目描述）：') || '';

    try {
        await apiRequest(`/api/characters/${projectId}/generate?user_prompt=${encodeURIComponent(userPrompt)}`, {
            method: 'POST'
        });
        loadCharacters(projectId);
        uiAlert('生成成功！切换到下一步继续。');
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        hideLoading(btn, oldHtml);
    }
}

// ========== 大纲 - 分步生成 ==========
async function generateNextVolumeSkeleton(projectId) {
    const totalChapters = parseInt(document.getElementById('totalChapters').value) || 50;

    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        const nextVolumeIndex = volumes.length + 1;

        if (!await uiConfirm(`确定要生成第 ${nextVolumeIndex} 卷骨架吗？\n\n总章节数：${totalChapters}\n生成骨架后再分批生成章节。`)) return;

        const btn = document.getElementById('btnGenerateSkeleton');
        const oldHtml = btn.innerHTML;
        showLoading(btn, `正在生成卷骨架...`);

        const response = await apiRequest('/api/outline/generate-volume-skeleton', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                volume_index: nextVolumeIndex,
                total_chapters: totalChapters
            })
        });

        loadOutline(projectId);
        uiAlert(response.message || '生成骨架成功！现在点击"生成下一批章节"继续。');
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        hideLoading(document.getElementById('btnGenerateSkeleton'), '1. 生成卷骨架');
    }
}

async function generateNextBatch(projectId) {
    const batchSize = parseInt(document.getElementById('batchSize').value) || 10;

    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        if (volumes.length === 0) {
            uiAlert('请先生成卷骨架！');
            return;
        }

        const selectedVolume = getSelectedBatchVolume() || (outlineVolumeProgressCache[0] || volumes[0]);
        if (!selectedVolume) {
            uiAlert('未找到可用卷，请先生成卷骨架。');
            return;
        }
        const existingChapters = await apiRequest(`/api/outline/${projectId}/volumes/${selectedVolume.id}/chapters`);
        const totalChapters = parseInt(document.getElementById('totalChapters').value) || 50;
        const nextStartChapter = getNextMissingChapterIndex(existingChapters, totalChapters);

        if (nextStartChapter > totalChapters) {
            uiAlert('本卷已经生成完所有章节了！');
            return;
        }

        const remaining = totalChapters - nextStartChapter + 1;
        const batchEnd = Math.min(nextStartChapter + batchSize - 1, totalChapters);
        const batchCount = batchEnd - nextStartChapter + 1;

        if (!await uiConfirm(`确定要生成第 ${selectedVolume.volume_index} 卷的第 ${nextStartChapter}-${batchEnd} 章吗？\n\n共 ${batchCount} 章，剩余 ${remaining - batchCount} 章。`)) return;

        const btn = document.getElementById('btnGenerateBatch');
        const oldHtml = btn.innerHTML;
        showLoading(btn, `正在生成第 ${nextStartChapter}-${batchEnd} 章...`);

        const response = await apiRequest('/api/outline/generate-volume-chapters', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                volume_id: selectedVolume.id,
                volume_index: selectedVolume.volume_index,
                start_chapter: nextStartChapter,
                end_chapter: batchEnd,
                total_chapters: totalChapters
            })
        });

        loadOutline(projectId);
        uiAlert(response.message || `生成成功！还剩 ${remaining - batchCount} 章。`);
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        hideLoading(document.getElementById('btnGenerateBatch'), '2. 生成下一批章节');
    }
}

async function generateAllRemainingChapters(projectId) {
    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        if (volumes.length === 0) {
            uiAlert('请先生成卷骨架！');
            return;
        }
        const selectedVolume = getSelectedBatchVolume() || (outlineVolumeProgressCache[0] || volumes[0]);
        if (!selectedVolume) {
            uiAlert('未找到可用卷，请先生成卷骨架。');
            return;
        }
        const existingChapters = await apiRequest(`/api/outline/${projectId}/volumes/${selectedVolume.id}/chapters`);
        const totalChapters = parseInt(document.getElementById('totalChapters').value) || 50;
        const nextStartChapter = getNextMissingChapterIndex(existingChapters, totalChapters);
        if (nextStartChapter > totalChapters) {
            uiAlert('本卷已经生成完所有章节了！');
            return;
        }

        if (!await uiConfirm(`确定一键补齐第 ${selectedVolume.volume_index} 卷剩余章节吗？\n\n范围：第 ${nextStartChapter}-${totalChapters} 章\n后端会自动分批生成并合并。`)) return;

        const btn = document.getElementById('btnGenerateAllRemaining');
        const oldHtml = btn.innerHTML;
        showLoading(btn, `正在生成第 ${nextStartChapter}-${totalChapters} 章...`);

        const response = await apiRequest('/api/outline/generate-volume-chapters', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                volume_id: selectedVolume.id,
                volume_index: selectedVolume.volume_index,
                start_chapter: nextStartChapter,
                end_chapter: totalChapters,
                total_chapters: totalChapters
            })
        });

        loadOutline(projectId);
        uiAlert(response.message || `已完成第 ${nextStartChapter}-${totalChapters} 章生成。`);
        hideLoading(btn, oldHtml);
    } catch (e) {
        uiAlert('一键补齐失败: ' + e.message);
        const btn = document.getElementById('btnGenerateAllRemaining');
        if (btn) hideLoading(btn, '3. 一键补齐本卷剩余章节');
    }
}

// ========== 大纲 - 一次性生成 ==========
async function generateNextVolume(projectId) {
    const chaptersPerVolume = parseInt(document.getElementById('chaptersPerVolume').value) || 30;

    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        const nextVolumeIndex = volumes.length + 1;

        if (!await uiConfirm(`确定要生成第 ${nextVolumeIndex} 卷，共 ${chaptersPerVolume} 章吗？\n\n生成需要一点时间，请耐心等待。`)) return;

        const btn = document.getElementById('btnGenerateVolume');
        const oldHtml = btn.innerHTML;
        showLoading(btn, `正在生成第 ${nextVolumeIndex} 卷...`);

        const response = await apiRequest('/api/outline/generate-volume', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                volume_index: nextVolumeIndex,
                chapters_per_volume: chaptersPerVolume
            })
        });

        loadOutline(projectId);
        uiAlert(response.message || '生成成功！');
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        hideLoading(document.getElementById('btnGenerateVolume'), '生成下一卷');
    }
}

async function loadOutline(projectId) {
    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        const el = document.getElementById('outlineContent');
        if (!el) return; // tab not open

        if (volumes.length === 0) {
            el.innerHTML = `<p class="text-gray-500 italic">尚未生成大纲，点击上方按钮开始逐卷生成</p>`;
            return;
        }

        // 统计进度
        let totalChapters = 0;
        let doneChapters = 0;
        const volumeProgressRows = [];

        let html = '';
        // 添加进度条
        for (const vol of volumes) {
            const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
            totalChapters += chapters.length;
            const done = chapters.filter(c => c.is_generated).length;
            doneChapters += done;
            volumeProgressRows.push({
                id: vol.id,
                volume_index: Number(vol.volume_index) || 0,
                title: vol.title || '',
                total: chapters.length,
                done
            });
        }
        outlineVolumeProgressCache = volumeProgressRows.sort((a, b) => (a.volume_index || 0) - (b.volume_index || 0));
        refreshBatchVolumeSelector();

        if (totalChapters > 0) {
            const percent = Math.round((doneChapters / totalChapters) * 100);
            html += `<div class="mb-3">
                <div class="text-sm text-gray-600 mb-1">进度：${doneChapters} / ${totalChapters} 章已生成</div>
                <div class="bg-gray-100 rounded-full h-2.5">
                    <div class="bg-indigo-600 h-2.5 rounded-full" style="width: ${percent}%"></div>
                </div>
            </div>`;
        }

        html += `<div class="space-y-3">`;
        if (outlineViewMode === 'chapter') {
            const allRows = [];
            for (let vpos = 0; vpos < volumes.length; vpos++) {
                const vol = volumes[vpos];
                const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
                const displayVolumeIndex = (Number.isFinite(Number(vol.volume_index)) && Number(vol.volume_index) > 0)
                    ? Number(vol.volume_index)
                    : (vpos + 1);
                for (const chap of chapters) {
                    allRows.push({ vol, chap, displayVolumeIndex });
                }
            }
            allRows.sort((a, b) => {
                if (a.displayVolumeIndex !== b.displayVolumeIndex) return a.displayVolumeIndex - b.displayVolumeIndex;
                return (a.chap.chapter_index || 0) - (b.chap.chapter_index || 0);
            });
            html += `<div class="border rounded p-3 bg-indigo-50 text-sm text-indigo-800">按章视图：可直接逐章生成/编辑，不需要先展开卷。</div>`;
            for (const row of allRows) {
                const { vol, chap, displayVolumeIndex } = row;
                const statusClass = chap.is_generated ? 'border-green-400 bg-green-50' : 'border-gray-200';
                const targetWordsDisplay = (Number.isFinite(Number(chap.target_words)) && Number(chap.target_words) > 0)
                    ? Number(chap.target_words)
                    : parseTargetWordsFromReference(chap.word_count_reference, (currentProject && currentProject.target_words_per_chapter) ? Number(currentProject.target_words_per_chapter) : 2000);
                const actionBtn = chap.is_generated
                    ? `<button onclick="openChapter(${projectId}, ${chap.id})" class="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition">查看/编辑</button>`
                    : `<button onclick="generateChapter(${projectId}, ${chap.id}, this, ${Number(chap.target_words || 0)})" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition">生成</button>`;
                html += `
                    <div class="pl-3 border-l-2 ${statusClass} py-2 bg-white rounded">
                        <div class="flex justify-between items-center gap-2">
                            <div>
                                <div class="text-xs text-gray-500">第${displayVolumeIndex}卷 · ${escapeHtml(vol.title || '')}</div>
                                <div class="font-medium text-sm">第${chap.chapter_index}章：${escapeHtml(chap.title)}</div>
                                <div class="text-xs text-gray-500 mt-1">目标字数：${targetWordsDisplay}</div>
                            </div>
                            <div class="flex items-center gap-2">
                                <button onclick="quickEditChapterTargetWords(${projectId}, ${chap.id}, ${targetWordsDisplay})" class="px-2 py-1 border text-xs rounded hover:bg-gray-100">改字数</button>
                                ${actionBtn}
                            </div>
                        </div>
                        ${chap.outline ? `<p class="text-xs text-gray-600 mt-1">${escapeHtml(chap.outline)}</p>` : ''}
                    </div>
                `;
            }
        } else {
            for (let vpos = 0; vpos < volumes.length; vpos++) {
                const vol = volumes[vpos];
                const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
                const displayVolumeIndex = (Number.isFinite(Number(vol.volume_index)) && Number(vol.volume_index) > 0)
                    ? Number(vol.volume_index)
                    : (vpos + 1);

                html += `
                    <div class="border rounded overflow-hidden">
                        <div class="bg-gray-50 dark:bg-gray-800 p-3 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                             onclick="toggleVolume(${vol.id})">
                            <div>
                                <span class="font-semibold">第${displayVolumeIndex}卷：${escapeHtml(vol.title)}</span>
                                <span class="text-sm text-gray-500 ml-2">${chapters.length}章 / ${chapters.filter(c => c.is_generated).length}已生成</span>
                            </div>
                            <span id="volumeArrow-${vol.id}">▶</span>
                        </div>
                        <div id="volumeContent-${vol.id}" class="p-3 hidden">
                            <div class="mb-3 pb-3 border-b">
                                ${vol.title ? `<p><span class="font-semibold">卷标题：</span> ${escapeHtml(vol.title)}</p>` : ''}
                                ${vol.summary ? `<p class="mt-1"><span class="font-semibold">卷概要：</span> <span class="text-gray-600 text-sm">${escapeHtml(vol.summary)}</span></p>` : ''}
                                ${vol.beat_sheet ? `<p class="mt-1"><span class="font-semibold">节拍表：</span> <span class="text-gray-600 text-sm">${escapeHtml(vol.beat_sheet)}</span></p>` : ''}
                                ${vol.core_conflict ? `<p class="mt-1"><span class="font-semibold">核心冲突：</span> <span class="text-gray-600 text-sm">${escapeHtml(vol.core_conflict)}</span></p>` : ''}
                                ${vol.climax ? `<p class="mt-1"><span class="font-semibold">高潮：</span> <span class="text-gray-600 text-sm">${escapeHtml(vol.climax)}</span></p>` : ''}
                                <button onclick="editVolume(${projectId}, ${vol.id})" class="mt-2 px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition">编辑卷信息</button>
                            </div>
                            <div class="space-y-2">
                `;

                for (const chap of chapters) {
                    const statusClass = chap.is_generated ? 'border-green-400 bg-green-50' : 'border-gray-200';
                    const targetWordsDisplay = (Number.isFinite(Number(chap.target_words)) && Number(chap.target_words) > 0)
                        ? Number(chap.target_words)
                        : parseTargetWordsFromReference(chap.word_count_reference, (currentProject && currentProject.target_words_per_chapter) ? Number(currentProject.target_words_per_chapter) : 2000);
                    const statusText = chap.is_generated
                        ? `<button onclick="openChapter(${projectId}, ${chap.id})" class="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition">查看/编辑</button>`
                        : `<button onclick="generateChapter(${projectId}, ${chap.id}, this, ${Number(chap.target_words || 0)})" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition">生成</button>`;

                    html += `
                        <div class="pl-3 border-l-2 ${statusClass} py-2">
                            <div class="flex justify-between items-center gap-2">
                                <span class="font-medium text-sm">
                                    第${chap.chapter_index}章：${escapeHtml(chap.title)}
                                </span>
                                <div class="flex items-center gap-2">
                                    <span class="text-xs text-gray-500">目标字数：${targetWordsDisplay}</span>
                                    <button onclick="quickEditChapterTargetWords(${projectId}, ${chap.id}, ${targetWordsDisplay})" class="px-2 py-1 border text-xs rounded hover:bg-gray-100">改字数</button>
                                    ${statusText}
                                </div>
                            </div>
                            ${chap.outline ? `<p class="text-xs text-gray-600 mt-1">${escapeHtml(chap.outline)}</p>` : ''}
                        </div>
                    `;
                }

                html += `</div></div></div>`;
            }
        }
        html += '</div>';

        el.innerHTML = html;
    } catch (e) {
        console.error(e);
    }
}

function toggleVolume(volumeId) {
    const content = document.getElementById(`volumeContent-${volumeId}`);
    const arrow = document.getElementById(`volumeArrow-${volumeId}`);
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        arrow.innerHTML = '▼';
    } else {
        content.classList.add('hidden');
        arrow.innerHTML = '▶';
    }
}

function getNextMissingChapterIndex(existingChapters, totalChapters) {
    const used = new Set((existingChapters || [])
        .map(c => parseInt(c.chapter_index || 0, 10))
        .filter(n => Number.isFinite(n) && n > 0));
    for (let i = 1; i <= totalChapters; i++) {
        if (!used.has(i)) return i;
    }
    return totalChapters + 1;
}

function getSelectedBatchVolume() {
    const select = document.getElementById('batchTargetVolume');
    if (!select) return null;
    const vid = parseInt(select.value || '0', 10);
    if (!Number.isFinite(vid) || vid <= 0) return null;
    return (outlineVolumeProgressCache || []).find(v => Number(v.id) === vid) || null;
}

function refreshBatchVolumeSelector() {
    const select = document.getElementById('batchTargetVolume');
    if (!select) return;
    const rows = outlineVolumeProgressCache || [];
    if (!rows.length) {
        select.innerHTML = '<option value="">暂无卷</option>';
        return;
    }
    let html = '';
    rows.forEach(v => {
        const label = `第${v.volume_index}卷：${v.title || '未命名卷'}（${v.done}/${v.total}已生成）`;
        html += `<option value="${v.id}">${escapeHtml(label)}</option>`;
    });
    select.innerHTML = html;
    const firstUnfinished = rows.find(v => v.done < v.total) || rows[0];
    if (firstUnfinished) select.value = String(firstUnfinished.id);
}

// ========== 章节生成 ==========
function parseTargetWordsFromReference(refValue, fallback = 2000) {
    const fb = Number.isFinite(Number(fallback)) ? Number(fallback) : 2000;
    const txt = String(refValue || '').trim();
    if (!txt) return fb;
    const norm = txt.replace(/[,，]/g, '');
    const rangeMatch = norm.match(/(\d{3,6})\s*[-~～至到]\s*(\d{3,6})/);
    if (rangeMatch) {
        const a = parseInt(rangeMatch[1], 10);
        const b = parseInt(rangeMatch[2], 10);
        if (Number.isFinite(a) && Number.isFinite(b)) {
            return Math.round((Math.min(a, b) + Math.max(a, b)) / 2);
        }
    }
    const singleMatch = norm.match(/(\d{3,6})/);
    if (singleMatch) return parseInt(singleMatch[1], 10);
    return fb;
}

async function quickEditChapterTargetWords(projectId, chapterId, currentValue = 2000) {
    const val = await uiPrompt('请输入本章目标字数（500-20000，留空则恢复为自动）', String(currentValue || 2000), '修改章节字数');
    if (val === null) return;
    const txt = String(val || '').trim();
    let payloadValue = null;
    if (txt) {
        const n = parseInt(txt, 10);
        if (!Number.isFinite(n) || n < 500 || n > 20000) {
            await uiAlert('字数范围应在 500-20000');
            return;
        }
        payloadValue = n;
    }
    try {
        await apiRequest(`/api/outline/chapters/${chapterId}`, {
            method: 'PUT',
            body: JSON.stringify({
                target_words: payloadValue
            })
        });
        await uiAlert('章节目标字数已更新');
        await loadOutline(projectId);
        if (currentTab === 'write') {
            await loadGeneratedChapters(projectId);
        }
    } catch (e) {
        await uiAlert('更新失败: ' + e.message);
    }
}

async function generateChapter(projectId, chapterId, btnEl = null, targetWordsHint = 0) {
    if (!await uiConfirm('确定要生成这一章吗？')) return;

    try {
        const btn = btnEl;
        const oldHtml = btn ? btn.innerHTML : '';
        if (btn) showLoading(btn, '生成中...');

        const chapter = await apiRequest('/api/write/chapter', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                chapter_id: chapterId,
                target_words: (Number.isFinite(Number(targetWordsHint)) && Number(targetWordsHint) > 0)
                    ? Number(targetWordsHint)
                    : null
            })
        });
        uiAlert('生成成功！');
        openChapter(projectId, chapterId);
        loadOutline(projectId);
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

function openChapter(projectId, chapterId) {
    currentChapter = chapterId;
    apiRequest(`/api/write/chapter/${chapterId}`)
        .then(chapter => {
            const fallbackTarget = (currentProject && currentProject.target_words_per_chapter) ? Number(currentProject.target_words_per_chapter) : 2000;
            const resolvedTargetWords = (chapter.target_words && Number(chapter.target_words) > 0)
                ? Number(chapter.target_words)
                : parseTargetWordsFromReference(chapter.word_count_reference, fallbackTarget);

            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.id = 'chapterModal';
            modal.onclick = (e) => {
                if (e.target === modal) closeChapter();
            };

            modal.innerHTML = `
                <div class="bg-white rounded-lg max-w-4xl w-full mx-4 max-h-[85vh] overflow-y-auto">
                    <div class="p-4 border-b flex justify-between items-center">
                        <h3 class="text-lg font-bold">${escapeHtml(chapter.title)}</h3>
                        <button onclick="closeChapter()" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
                    </div>
                    <div class="p-4">
                        <div class="grid grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">章节标题</label>
                                <input id="editChapterTitle" type="text" value="${escapeHtml(chapter.title)}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">视角(POV)</label>
                                <input id="editChapterPov" type="text" value="${escapeHtml(chapter.pov || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="比如：主角">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">本章目标</label>
                                <input id="editChapterGoal" type="text" value="${escapeHtml(chapter.goal || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">核心冲突</label>
                                <input id="editChapterConflict" type="text" value="${escapeHtml(chapter.conflict || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">目标字数（强限制）</label>
                                <input id="editChapterTargetWords" type="number" min="500" max="20000" step="100" value="${resolvedTargetWords}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                <div class="text-xs text-gray-500 mt-1">优先读取章节JSON字数参考；生成/重生时会强约束传给后端。</div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">字数参考(JSON)</label>
                                <input id="editChapterWordCountReference" type="text" value="${escapeHtml(chapter.word_count_reference || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="例如：3000-5000">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">主角代价</label>
                                <input id="editChapterCost" type="text" value="${escapeHtml(chapter.cost || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">反派层级</label>
                                <input id="editChapterAntagonistLevel" type="text" value="${escapeHtml(chapter.antagonist_level || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="小/中/大">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">剧情线(Strand)</label>
                                <input id="editChapterStrand" type="text" value="${escapeHtml(chapter.strand || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Quest/Fire/Constellation">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">爽点类型</label>
                                <input id="editChapterCoolPointType" type="text" value="${escapeHtml(chapter.cool_point_type || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="block text-sm font-medium text-gray-700 mb-1">章末钩子</label>
                            <input id="editChapterHook" type="text" value="${escapeHtml(chapter.hook || '')}" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        </div>
                        <div class="mb-3">
                            <label class="block text-sm font-medium text-gray-700 mb-1">内容概要</label>
                            <textarea id="editChapterOutline" rows="2" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">${escapeHtml(chapter.outline)}</textarea>
                        </div>
                        <div class="mb-3">
                            <div class="flex justify-between items-center mb-1">
                                <label class="block text-sm font-medium text-gray-700">正文</label>
                                <span id="editChapterWordCount" class="text-sm text-gray-500">字数：${chapter.word_count || 0}</span>
                            </div>
                            <div class="mb-2 p-2 border rounded bg-slate-50">
                                <div class="flex items-center justify-between">
                                    <div class="text-sm font-medium text-slate-700">质量评分（7维）</div>
                                    <div class="space-x-1">
                                        <button onclick="analyzeChapterQuality(${projectId}, ${chapterId}, this)" class="px-2 py-1 text-xs border rounded hover:bg-gray-100">分析评分</button>
                                        <button onclick="optimizeLowScore(${projectId}, ${chapterId}, this)" class="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700">低分段落增强</button>
                                    </div>
                                </div>
                                <div id="chapterQualityBox" class="mt-2 text-xs text-slate-600">尚未分析</div>
                                <div id="chapterQualityDelta" class="mt-2 text-xs text-slate-600"></div>
                            </div>
                            <textarea id="editChapterContent" rows="20" class="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">${escapeHtml(chapter.content)}</textarea>
                        </div>
                        <div class="mb-3 pt-3 border-t">
                            <p class="text-sm font-medium text-gray-700 mb-2">AI优化：</p>
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'deepen_conflict', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">深化冲突</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'add_foreshadowing', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">增加伏笔</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'strengthen_emotion', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">强化感情</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'optimize_pacing', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">优化节奏</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'expand_details', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">扩充细节</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'enhance_climax', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">提升高潮</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'improve_dialogue', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">完善对话</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'polish', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">润色升华</button>
                            </div>
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'optimize_style', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">优化文笔</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'change_pov', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">修正视角</button>
                                <button onclick="optimizeChapter(${projectId}, ${chapterId}, 'remove_lecturing', this)" class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">去除说教</button>
                                <button onclick="regenerateChapter(${projectId}, ${chapterId}, this)" class="px-2 py-1 text-xs bg-yellow-600 text-white hover:bg-yellow-700 rounded transition">重新生成</button>
                            </div>
                        </div>
                        <div class="flex justify-between">
                            <div>
                                <button onclick="clearChapterContent(${projectId}, ${chapterId})" class="ml-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition">清空内容</button>
                            </div>
                            <div>
                                <button onclick="saveChapter(${projectId}, ${chapterId})" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition">保存</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
        });
}

function closeChapter() {
    const modal = document.getElementById('chapterModal');
    if (modal) modal.remove();
    loadOutline(currentProject.id);
    // 刷新写作tab
    if (currentTab === 'write' && currentProject) {
        loadGeneratedChapters(currentProject.id);
    }
}

async function saveChapter(projectId, chapterId) {
    const content = document.getElementById('editChapterContent').value;
    const title = document.getElementById('editChapterTitle').value;
    const outline = document.getElementById('editChapterOutline').value;
    const goal = document.getElementById('editChapterGoal').value;
    const conflict = document.getElementById('editChapterConflict').value;
    const cost = document.getElementById('editChapterCost').value;
    const strand = document.getElementById('editChapterStrand').value;
    const cool_point_type = document.getElementById('editChapterCoolPointType').value;
    const hook = document.getElementById('editChapterHook').value;
    const antagonist_level = document.getElementById('editChapterAntagonistLevel').value;
    const pov = document.getElementById('editChapterPov').value;
    const target_words = parseInt(document.getElementById('editChapterTargetWords').value || '0', 10);
    const word_count_reference = document.getElementById('editChapterWordCountReference').value;

    try {
        await apiRequest(`/api/outline/chapters/${chapterId}`, {
            method: 'PUT',
            body: JSON.stringify({
                title: title,
                content: content,
                outline: outline,
                goal: goal,
                conflict: conflict,
                cost: cost,
                strand: strand,
                cool_point_type: cool_point_type,
                hook: hook,
                antagonist_level: antagonist_level,
                pov: pov
                ,
                target_words: (Number.isFinite(target_words) && target_words > 0) ? target_words : null,
                word_count_reference: word_count_reference
            })
        });
        uiAlert('保存成功！');
        closeChapter();
        loadOutline(projectId);
    } catch (e) {
        uiAlert('保存失败: ' + e.message);
    }
}

async function optimizeChapter(projectId, chapterId, optimizeType, btnEl = null) {
    const btn = btnEl;
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) showLoading(btn, '优化中...');

    try {
        const chapter = await apiRequest('/api/write/optimize-chapter', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                chapter_id: chapterId,
                optimize_type: optimizeType
            })
        });
        document.getElementById('editChapterContent').value = chapter.content;
        document.getElementById('editChapterWordCount').textContent = `字数：${chapter.word_count}`;
        uiAlert('优化成功！请保存修改。');
    } catch (e) {
        uiAlert('优化失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

function renderChapterQualityBox(quality) {
    const box = document.getElementById('chapterQualityBox');
    if (!box) return;
    const scores = (quality && quality.scores) || {};
    const keys = [
        ['hook_strength', '钩子强度'],
        ['pacing', '节奏'],
        ['conflict_intensity', '冲突强度'],
        ['info_gain', '信息增量'],
        ['ending_cliff', '结尾钩子'],
        ['character_arc_consistency', '角色弧线一致性'],
        ['world_rule_consistency', '世界规则一致性'],
    ];
    const rows = keys.map(([k, label]) => {
        const raw = Number(scores[k] || 0);
        const v = Number.isFinite(raw) ? raw : 0;
        const c = v >= 4 ? 'text-green-700' : (v >= 3 ? 'text-amber-700' : 'text-red-700');
        return `<div class="flex items-center justify-between border-b py-1"><span>${label}</span><span class="${c} font-medium">${v.toFixed(1)}</span></div>`;
    }).join('');
    const weak = (quality.weak_dimensions || []).join(', ');
    const feedback = quality.feedback || '';
    box.innerHTML = `
      <div class="bg-white border rounded p-2">
        ${rows}
        ${weak ? `<div class="mt-2 text-amber-700">弱项：${escapeHtml(weak)}</div>` : ''}
        ${feedback ? `<div class="mt-1 text-slate-600">建议：${escapeHtml(feedback)}</div>` : ''}
      </div>
    `;
}

function renderChapterQualityDelta(before, after) {
    const box = document.getElementById('chapterQualityDelta');
    if (!box) return;
    if (!before || !after) {
        box.innerHTML = '';
        return;
    }
    const keys = [
        ['hook_strength', '钩子'],
        ['pacing', '节奏'],
        ['conflict_intensity', '冲突'],
        ['info_gain', '增量'],
        ['ending_cliff', '结尾钩子'],
        ['character_arc_consistency', '角色一致性'],
        ['world_rule_consistency', '规则一致性'],
    ];
    const rows = keys.map(([k, label]) => {
        const b = Number((before.scores || {})[k] || 0);
        const a = Number((after.scores || {})[k] || 0);
        const d = a - b;
        const sign = d > 0 ? '+' : '';
        const c = d > 0 ? 'text-green-700' : (d < 0 ? 'text-red-700' : 'text-slate-500');
        const wBefore = Math.max(0, Math.min(100, b * 20));
        const wAfter = Math.max(0, Math.min(100, a * 20));
        const barColor = d > 0 ? 'bg-green-500' : (d < 0 ? 'bg-red-500' : 'bg-slate-400');
        return `<div class="flex items-center justify-between border-b py-0.5">
          <div class="w-[46%]">
            <div>${label}</div>
            <div class="mt-1 h-2 rounded bg-slate-200 relative overflow-hidden">
              <div class="absolute left-0 top-0 h-2 bg-slate-400/70" style="width:${wBefore}%"></div>
              <div class="absolute left-0 top-0 h-2 ${barColor}" style="width:${wAfter}%"></div>
            </div>
          </div>
          <span>${b.toFixed(1)} → ${a.toFixed(1)} <span class="${c} ml-1">${sign}${d.toFixed(1)}</span></span>
        </div>`;
    }).join('');
    box.innerHTML = `
      <div class="bg-white border rounded p-2">
        <div class="font-medium text-slate-700 mb-1">增强前后对比（趋势条）</div>
        <div class="text-[11px] text-slate-500 mb-1">灰色=增强前，彩色=增强后</div>
        ${rows}
      </div>
    `;
}

async function fetchChapterQuality(projectId, chapterId) {
    return apiRequest('/api/write/chapter-quality', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, chapter_id: chapterId })
    });
}

async function analyzeChapterQuality(projectId, chapterId, btnEl = null) {
    const btn = btnEl;
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) showLoading(btn, '分析中...');
    try {
        const quality = await fetchChapterQuality(projectId, chapterId);
        renderChapterQualityBox(quality);
        renderChapterQualityDelta(null, null);
    } catch (e) {
        await uiAlert('质量分析失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

async function optimizeLowScore(projectId, chapterId, btnEl = null) {
    const ok = await uiConfirm('确认对低分段落做自动增强吗？');
    if (!ok) return;
    const btn = btnEl;
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) showLoading(btn, '增强中...');
    try {
        const before = await fetchChapterQuality(projectId, chapterId);
        const chapter = await apiRequest('/api/write/optimize-low-score', {
            method: 'POST',
            body: JSON.stringify({ project_id: projectId, chapter_id: chapterId })
        });
        document.getElementById('editChapterContent').value = chapter.content;
        document.getElementById('editChapterWordCount').textContent = `字数：${chapter.word_count}`;
        const after = await fetchChapterQuality(projectId, chapterId);
        renderChapterQualityBox(after);
        renderChapterQualityDelta(before, after);
    } catch (e) {
        await uiAlert('低分增强失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

async function regenerateChapter(projectId, chapterId, btnEl = null) {
    const povInput = document.getElementById('editChapterPov');
    const dynamicHero = (povInput && povInput.value && povInput.value.trim()) ? povInput.value.trim() : '【主角名】';
    const defaultConstraintTemplate = [
        `严格遵守：`,
        `1) ${dynamicHero} 说话风格保持克制，避免现代网络梗（如需口头禅请与人设一致）。`,
        `2) 本章只推进一个核心冲突，不开启新支线。`,
        `3) 每 400-600 字必须有一次有效推进（信息增量/关系变化/危险升级三选一）。`,
        `4) 禁止总结式说教，用动作与对话呈现观点。`,
        `5) 章末必须留下明确钩子，且与下一章主冲突直接相关。`
    ].join('\\n');
    const userPrompt = await uiPrompt('请输入额外修改要求（可选）。可直接使用模板：', defaultConstraintTemplate) || '';
    if (!await uiConfirm('确定要重新生成吗？会覆盖当前内容。')) return;

    const btn = btnEl;
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) showLoading(btn, '生成中...');
    const target_words = parseInt((document.getElementById('editChapterTargetWords')?.value || '0'), 10);

    try {
        const chapter = await apiRequest(`/api/write/chapter/${chapterId}/regenerate`, {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                user_prompt: userPrompt,
                target_words: (Number.isFinite(target_words) && target_words > 0) ? target_words : null
            })
        });
        document.getElementById('editChapterContent').value = chapter.content;
        document.getElementById('editChapterWordCount').textContent = `字数：${chapter.word_count || 0}`;
        uiAlert('重新生成成功！');
    } catch (e) {
        uiAlert('生成失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

async function clearChapterContent(projectId, chapterId) {
    if (!await uiConfirm('确定要清空内容吗？')) return;

    try {
        await apiRequest(`/api/write/chapter/${chapterId}/content`, {
            method: 'DELETE'
        });
        document.getElementById('editChapterContent').value = '';
        uiAlert('已清空');
        closeChapter();
        loadOutline(projectId);
    } catch (e) {
        uiAlert('操作失败: ' + e.message);
    }
}

// ========== 删除项目 ==========
async function deleteProject(projectId) {
    if (!await uiConfirm('确定要删除这个项目吗？此操作不可撤销。')) return;

    try {
        await apiRequest(`/api/projects/${projectId}`, {
            method: 'DELETE'
        });
        currentProject = null;
        loadProjects();
        document.getElementById('mainContent').innerHTML = `
            <div class="bg-white rounded-lg shadow p-6 text-center">
                <h2 class="text-2xl font-bold text-gray-800 mb-3">欢迎使用 AI 小说写作工具</h2>
                <p class="text-gray-600 mb-4">从左侧选择一个项目或创建新项目开始创作</p>
            </div>
        `;
        uiAlert('删除成功');
    } catch (e) {
        uiAlert('删除失败: ' + e.message);
    }
}

// ========== 导出 ==========
async function exportFullText(projectId) {
    try {
        const result = await apiRequest(`/api/write/full-text/${projectId}`);
        document.getElementById('exportContent').classList.remove('hidden');
        document.getElementById('fullTextArea').value = result.full_text;
        uiAlert(`导出成功！共 ${result.word_count} 字，${result.chapter_count} 章`);
    } catch (e) {
        uiAlert('导出失败: ' + e.message);
    }
}

function copyFullText() {
    const textarea = document.getElementById('fullTextArea');
    textarea.select();
    document.execCommand('copy');
    uiAlert('已复制到剪贴板');
}

function downloadFullText(projectId) {
    const text = document.getElementById('fullTextArea').value;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportFullProject(projectId) {
    try {
        // 获取项目完整信息
        const project = await apiRequest(`/api/projects/${projectId}`);
        const world = await apiRequest(`/api/projects/${projectId}/world`);
        const characters = await apiRequest(`/api/characters/${projectId}`);
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);

        const fullProject = {
            project: project,
            world_setting: world,
            characters: characters,
            volumes: await Promise.all(volumes.map(async vol => {
                const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
                return {...vol, chapters: chapters};
            }))
        };

        const jsonStr = JSON.stringify(fullProject, null, 2);
        document.getElementById('exportProjectContent').classList.remove('hidden');
        document.getElementById('fullProjectArea').value = jsonStr;
        const totalChapters = volumes.reduce((sum, vol) => sum + (vol.chapters ? vol.chapters.length : 0), 0);
        uiAlert(`项目导出成功！共 ${volumes.length} 卷 ${totalChapters} 章`);
    } catch (e) {
        uiAlert('导出失败: ' + e.message);
    }
}

async function downloadProjectBundle(projectId) {
    try {
        const data = await apiRequest(`/api/projects/${projectId}/export`);
        const title = (data?.project?.title || `project-${projectId}`).replace(/[\\/:*?"<>|]/g, '_');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}-bundle.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        await uiAlert('项目JSON导出成功');
    } catch (e) {
        await uiAlert('导出项目JSON失败: ' + e.message);
    }
}

async function importProjectBundle() {
    const input = document.getElementById('importProjectFile');
    if (!input || !input.files || !input.files[0]) {
        await uiAlert('请先选择一个JSON文件');
        return;
    }
    try {
        const text = await input.files[0].text();
        let payload = null;
        try {
            payload = JSON.parse(text);
        } catch (_) {
            throw new Error('文件不是合法JSON');
        }
        const data = await apiRequest('/api/projects/import', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        await uiAlert(`导入成功：${data.title}`);
        input.value = '';
        await loadProjects();
    } catch (e) {
        await uiAlert('导入失败: ' + e.message);
    }
}

function triggerGlobalImportProject() {
    let input = document.getElementById('globalImportProjectFile');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.id = 'globalImportProjectFile';
        input.className = 'hidden';
        input.onchange = async () => {
            if (!input.files || !input.files[0]) return;
            try {
                const text = await input.files[0].text();
                let payload = null;
                try {
                    payload = JSON.parse(text);
                } catch (_) {
                    throw new Error('文件不是合法JSON');
                }
                const data = await apiRequest('/api/projects/import', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                await uiAlert(`导入成功：${data.title}`);
                await loadProjects();
            } catch (e) {
                await uiAlert('导入失败: ' + e.message);
            } finally {
                input.value = '';
            }
        };
        document.body.appendChild(input);
    }
    input.click();
}

// ========== 模型配置 ==========
let llmProfilesState = { active_profile_id: '', profiles: [] };

function refreshActiveModelBadge() {
    const badge = document.getElementById('activeModelBadge');
    if (!badge) return;
    const active = (llmProfilesState.profiles || []).find(p => p.id === llmProfilesState.active_profile_id);
    if (!active) {
        badge.textContent = '当前模型：未设置';
        return;
    }
    const provider = active.provider || 'unknown';
    const model = active.model || '未填写';
    const name = active.name || '未命名配置';
    badge.textContent = `当前模型：${name} · ${provider} / ${model}`;
}

function safeJsonText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
}

function getCurrentLLMProfileId() {
    return document.getElementById('llmProfileSelect').value || '';
}

function getCurrentLLMProfile() {
    const id = getCurrentLLMProfileId();
    return llmProfilesState.profiles.find(p => p.id === id);
}

function fillLLMForm(profile) {
    if (!profile) return;
    document.getElementById('llmProfileName').value = profile.name || '';
    document.getElementById('llmProvider').value = profile.provider || 'anthropic';
    document.getElementById('llmApiKey').value = profile.api_key || '';
    document.getElementById('llmBaseUrl').value = profile.base_url || '';
    document.getElementById('llmModel').value = profile.model || '';
    document.getElementById('llmMaxTokens').value = profile.max_tokens || 16384;
    document.getElementById('llmValidateResult').textContent = '';
}

function renderLLMProfiles(state) {
    llmProfilesState = state || { active_profile_id: '', profiles: [] };
    const select = document.getElementById('llmProfileSelect');
    if (!select) {
        // 首页没有模型配置表单，也需要刷新顶部“当前模型”徽标
        refreshActiveModelBadge();
        return;
    }

    select.innerHTML = '';
    (llmProfilesState.profiles || []).forEach(p => {
        const activeMark = p.id === llmProfilesState.active_profile_id ? ' (当前使用)' : '';
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name}${activeMark}`;
        select.appendChild(option);
    });

    if (llmProfilesState.active_profile_id) {
        select.value = llmProfilesState.active_profile_id;
    }
    fillLLMForm(getCurrentLLMProfile());
    refreshActiveModelBadge();
    renderLLMProfileCards();
}

function renderLLMProfileCards() {
    const box = document.getElementById('llmProfileCards');
    if (!box) return;
    const activeId = llmProfilesState.active_profile_id;
    const profiles = llmProfilesState.profiles || [];
    if (!profiles.length) {
        box.innerHTML = '<p class="text-gray-500 italic text-xs">暂无配置</p>';
        return;
    }

    let html = '';
    profiles.forEach(p => {
        const isActive = p.id === activeId;
        const enabled = p.enabled !== false;
        const check = p.last_check || {};
        const checkText = check.ok === true
            ? `可用 · ${check.latency_ms || '-'}ms`
            : (check.message ? check.message : '未检查');
        const checkColor = check.ok === true ? 'text-green-700 bg-green-50' : 'text-gray-700 bg-gray-100';
        const statusBadge = enabled ? '启用' : '禁用';
        const statusColor = enabled ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700';
        const tags = Array.isArray(p.tags) ? p.tags : [];

        html += `
            <div class="border rounded p-2 bg-white ${isActive ? 'ring-2 ring-indigo-300' : ''}">
                <div class="flex items-center justify-between gap-2">
                    <div class="font-medium text-sm">${escapeHtml(p.name || '未命名配置')}</div>
                    <div class="flex items-center gap-1">
                        ${isActive ? '<span class="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded">当前</span>' : ''}
                        <span class="px-2 py-0.5 text-xs rounded ${statusColor}">${statusBadge}</span>
                    </div>
                </div>
                <div class="text-xs text-gray-600 mt-1">${escapeHtml((p.provider || '') + ' / ' + (p.model || ''))}</div>
                <div class="text-xs text-gray-500 mt-1 break-all">${escapeHtml(p.base_url || '')}</div>
                <div class="mt-2 flex items-center justify-between gap-1">
                    <span class="px-2 py-0.5 text-xs rounded ${checkColor}">${escapeHtml(checkText)}</span>
                    <div class="space-x-1">
                        <button onclick="selectProfileInForm('${p.id}')" class="px-2 py-1 text-xs border rounded hover:bg-gray-50">编辑</button>
                        <button onclick="checkProfileHealth('${p.id}')" class="px-2 py-1 text-xs border rounded hover:bg-gray-50">检查</button>
                        ${!isActive ? `<button onclick="activateSpecificProfile('${p.id}')" class="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700">切换</button>` : ''}
                    </div>
                </div>
                <div class="mt-2 flex items-center gap-1">
                    <input id="tags-${p.id}" type="text" value="${escapeHtml(tags.join(','))}" placeholder="标签，逗号分隔" class="flex-1 px-2 py-1 border rounded text-xs">
                    <button onclick="saveProfileTags('${p.id}')" class="px-2 py-1 text-xs border rounded hover:bg-gray-50">存标签</button>
                    <button onclick="toggleProfileEnabled('${p.id}', ${enabled ? 'false' : 'true'})" class="px-2 py-1 text-xs border rounded hover:bg-gray-50">${enabled ? '禁用' : '启用'}</button>
                </div>
            </div>
        `;
    });
    box.innerHTML = html;
}

async function refreshLLMCallLogs() {
    const box = document.getElementById('llmCallLogs');
    if (!box) return;
    try {
        const data = await apiRequest('/api/settings/llm/call-logs?limit=20');
        const logs = (data && data.logs) ? data.logs : [];
        if (!logs.length) {
            box.innerHTML = '<p class="text-gray-500 italic">暂无日志</p>';
            return;
        }
        box.innerHTML = logs.map(l => {
            const ok = l.ok ? 'OK' : 'ERR';
            const color = l.ok ? 'text-green-700' : 'text-red-700';
            return `<div class="border-b pb-1">
                <span class="${color} font-medium">${ok}</span>
                <span class="ml-1">${escapeHtml(l.provider || '')}/${escapeHtml(l.model || '')}</span>
                <span class="ml-1 text-gray-500">${escapeHtml(String(l.latency_ms || 0))}ms</span>
                ${l.error ? `<div class="text-red-600 mt-0.5">${escapeHtml(l.error)}</div>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = `<p class="text-red-600">日志加载失败：${escapeHtml(e.message || '')}</p>`;
    }
}

function selectProfileInForm(profileId) {
    const select = document.getElementById('llmProfileSelect');
    if (!select) return;
    select.value = profileId;
    onLLMProfileChange();
}

async function activateSpecificProfile(profileId) {
    try {
        const state = await apiRequest(`/api/settings/llm/active/${profileId}`, { method: 'PUT' });
        renderLLMProfiles(state);
        await refreshLLMCallLogs();
    } catch (e) {
        uiAlert('切换失败: ' + e.message);
    }
}

async function checkProfileHealth(profileId) {
    try {
        const state = await apiRequest(`/api/settings/llm/profiles/${profileId}/check`, { method: 'POST' });
        renderLLMProfiles(state);
    } catch (e) {
        uiAlert('检查失败: ' + e.message);
    }
}

async function toggleProfileEnabled(profileId, enabled) {
    try {
        const state = await apiRequest(`/api/settings/llm/profiles/${profileId}/meta`, {
            method: 'PUT',
            body: JSON.stringify({ enabled: !!enabled })
        });
        renderLLMProfiles(state);
    } catch (e) {
        uiAlert('更新启用状态失败: ' + e.message);
    }
}

async function saveProfileTags(profileId) {
    const el = document.getElementById(`tags-${profileId}`);
    if (!el) return;
    const tags = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
    try {
        const state = await apiRequest(`/api/settings/llm/profiles/${profileId}/meta`, {
            method: 'PUT',
            body: JSON.stringify({ tags })
        });
        renderLLMProfiles(state);
    } catch (e) {
        uiAlert('保存标签失败: ' + e.message);
    }
}

async function refreshLLMConsole() {
    await loadLLMSettings();
    await refreshLLMCallLogs();
}

async function loadLLMSettings() {
    try {
        const state = await apiRequest('/api/settings/llm/profiles');
        renderLLMProfiles(state);
        await refreshLLMCallLogs();
    } catch (e) {
        console.warn('加载模型配置失败', e);
        const badge = document.getElementById('activeModelBadge');
        if (badge) badge.textContent = '当前模型：加载失败';
    }
}

function openLLMSettings() {
    const modal = document.getElementById('llmSettingsModal');
    modal.classList.remove('hidden');
    refreshLLMConsole();
}

function closeLLMSettings() {
    const modal = document.getElementById('llmSettingsModal');
    modal.classList.add('hidden');
}

function onLLMProviderChange() {
    const provider = document.getElementById('llmProvider').value;
    const baseUrlEl = document.getElementById('llmBaseUrl');
    const modelEl = document.getElementById('llmModel');

    const hasBase = baseUrlEl.value.trim().length > 0;
    const hasModel = modelEl.value.trim().length > 0;

    if (!hasBase) {
        baseUrlEl.value = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
    }
    if (!hasModel) {
        modelEl.value = provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini';
    }
}

function applyFastModePreset() {
    const provider = document.getElementById('llmProvider').value;
    const baseUrlEl = document.getElementById('llmBaseUrl');
    const modelEl = document.getElementById('llmModel');
    const maxTokensEl = document.getElementById('llmMaxTokens');
    const resultEl = document.getElementById('llmValidateResult');

    if (!baseUrlEl.value.trim()) {
        baseUrlEl.value = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
    }
    if (!modelEl.value.trim()) {
        modelEl.value = provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini';
    }
    maxTokensEl.value = 4096;

    resultEl.textContent = '已应用快速模式参数：max_tokens=4096。建议同时把项目“每章目标字数”设为 1200-1500。';
    resultEl.className = 'mt-3 text-sm text-amber-700';
}

function onLLMProfileChange() {
    fillLLMForm(getCurrentLLMProfile());
}

async function newLLMProfile() {
    const defaultName = `配置${(llmProfilesState.profiles || []).length + 1}`;
    const name = await uiPrompt('请输入新配置名称：', defaultName);
    if (!name) return;
    try {
        const state = await apiRequest('/api/settings/llm/profiles', {
            method: 'POST',
            body: JSON.stringify({
                name: name.trim(),
                provider: 'anthropic',
                api_key: '',
                base_url: '',
                model: '',
                max_tokens: 16384
            })
        });
        renderLLMProfiles(state);
        const created = state.profiles[state.profiles.length - 1];
        if (created) {
            document.getElementById('llmProfileSelect').value = created.id;
            fillLLMForm(created);
        }
    } catch (e) {
        uiAlert('新建失败: ' + e.message);
    }
}

async function deleteCurrentLLMProfile() {
    const current = getCurrentLLMProfile();
    if (!current) return;
    if (!await uiConfirm(`确定删除配置「${current.name}」吗？`)) return;
    try {
        const state = await apiRequest(`/api/settings/llm/profiles/${current.id}`, {
            method: 'DELETE'
        });
        renderLLMProfiles(state);
        uiAlert('删除成功');
    } catch (e) {
        uiAlert('删除失败: ' + e.message);
    }
}

async function activateCurrentLLMProfile() {
    const current = getCurrentLLMProfile();
    if (!current) return;
    try {
        const state = await apiRequest(`/api/settings/llm/active/${current.id}`, {
            method: 'PUT'
        });
        renderLLMProfiles(state);
        uiAlert(`已切换为：${current.name}`);
    } catch (e) {
        uiAlert('切换失败: ' + e.message);
    }
}

async function validateCurrentLLMConfig() {
    const resultEl = document.getElementById('llmValidateResult');
    const payload = {
        provider: document.getElementById('llmProvider').value,
        api_key: document.getElementById('llmApiKey').value.trim(),
        base_url: document.getElementById('llmBaseUrl').value.trim(),
        model: document.getElementById('llmModel').value.trim(),
        max_tokens: parseInt(document.getElementById('llmMaxTokens').value, 10) || 1024
    };

    resultEl.textContent = '正在校验...';
    resultEl.className = 'mt-3 text-sm text-gray-600';

    try {
        const res = await apiRequest('/api/settings/llm/validate', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            resultEl.textContent = `✅ ${res.message}`;
            resultEl.className = 'mt-3 text-sm text-green-600';
        } else {
            resultEl.textContent = `❌ ${res.message}`;
            resultEl.className = 'mt-3 text-sm text-red-600';
        }
    } catch (e) {
        resultEl.textContent = `❌ 校验异常: ${e.message}`;
        resultEl.className = 'mt-3 text-sm text-red-600';
    }
}

async function saveLLMSettings(event) {
    event.preventDefault();
    const current = getCurrentLLMProfile();
    if (!current) {
        uiAlert('请先新建一个配置');
        return;
    }

    const payload = {
        name: document.getElementById('llmProfileName').value.trim(),
        provider: document.getElementById('llmProvider').value,
        api_key: document.getElementById('llmApiKey').value.trim(),
        base_url: document.getElementById('llmBaseUrl').value.trim(),
        model: document.getElementById('llmModel').value.trim(),
        max_tokens: parseInt(document.getElementById('llmMaxTokens').value, 10) || 16384
    };

    if (!payload.name) {
        uiAlert('请填写配置名称');
        return;
    }
    if (!payload.api_key) {
        uiAlert('请填写 API Key');
        return;
    }
    if (!payload.model) {
        uiAlert('请填写 Model');
        return;
    }

    try {
        const state = await apiRequest(`/api/settings/llm/profiles/${current.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        renderLLMProfiles(state);
        document.getElementById('llmProfileSelect').value = current.id;
        fillLLMForm(getCurrentLLMProfile());
        uiAlert('配置已保存');
    } catch (e) {
        uiAlert('保存失败: ' + e.message);
    }
}

function copyFullProject() {
    const textarea = document.getElementById('fullProjectArea');
    textarea.select();
    document.execCommand('copy');
    uiAlert('已复制到剪贴板');
}

function downloadFullProject(projectId) {
    const text = document.getElementById('fullProjectArea').value;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.title}-project.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ========== 写作tab加载已生成章节 ==========
let writeGeneratedItems = [];
let writeCurrentPage = 1;
const WRITE_PAGE_SIZE = 5;
const writeExpanded = {};
let writeVolumeProgressCache = [];
let writeFailedQueue = [];
let writeRetryContext = { projectId: null, volumeId: null, targetWords: null };

function setWriteBatchButtonsDisabled(disabled) {
    const ids = ['btnWriteBatchNext', 'btnWriteBatchAll', 'btnWriteRetryFailed'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !!disabled;
    });
}

function resetWriteBatchProgress() {
    const wrap = document.getElementById('writeBatchProgressWrap');
    const text = document.getElementById('writeBatchProgressText');
    const pct = document.getElementById('writeBatchProgressPercent');
    const bar = document.getElementById('writeBatchProgressBar');
    if (wrap) wrap.classList.add('hidden');
    if (text) text.textContent = '准备中...';
    if (pct) pct.textContent = '0%';
    if (bar) bar.style.width = '0%';
}

function updateWriteBatchProgress(current, total, label = '') {
    const wrap = document.getElementById('writeBatchProgressWrap');
    const text = document.getElementById('writeBatchProgressText');
    const pct = document.getElementById('writeBatchProgressPercent');
    const bar = document.getElementById('writeBatchProgressBar');
    if (wrap) wrap.classList.remove('hidden');
    const safeTotal = Math.max(1, Number(total || 1));
    const safeCurrent = Math.max(0, Math.min(safeTotal, Number(current || 0)));
    const percent = Math.round((safeCurrent / safeTotal) * 100);
    if (text) text.textContent = `${label || '批量生成'}：${safeCurrent}/${safeTotal}`;
    if (pct) pct.textContent = `${percent}%`;
    if (bar) bar.style.width = `${percent}%`;
}

function renderWriteFailedQueue() {
    const box = document.getElementById('writeBatchFailedBox');
    const list = document.getElementById('writeBatchFailedList');
    if (!box || !list) return;
    if (!writeFailedQueue.length) {
        box.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    box.classList.remove('hidden');
    list.innerHTML = writeFailedQueue.map(item => {
        const idx = Number(item.chapter_index || 0);
        const title = item.title || '';
        const err = String(item.error || '未知错误');
        return `<div>第${idx}章 ${escapeHtml(title)}：${escapeHtml(err)}</div>`;
    }).join('');
}

async function requestGenerateChapter(projectId, chapterId, targetWords = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5分钟超时
    try {
        const result = await apiRequest('/api/write/chapter', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                chapter_id: chapterId,
                target_words: (Number.isFinite(Number(targetWords)) && Number(targetWords) > 0)
                    ? Number(targetWords)
                    : null
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return result;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            throw new Error('生成超时（超过5分钟），请稍后重试或降低目标字数');
        }
        throw e;
    }
}

async function requestBatchGenerate(projectId, volumeId, batchSize, targetWords = null) {
    return apiRequest('/api/write/batch-generate', {
        method: 'POST',
        body: JSON.stringify({
            project_id: projectId,
            volume_id: volumeId,
            batch_size: batchSize,
            target_words: (Number.isFinite(Number(targetWords)) && Number(targetWords) > 0)
                ? Number(targetWords)
                : null
        })
    });
}

async function pollBatchProgress(taskId) {
    return apiRequest(`/api/write/batch-progress/${taskId}`);
}

function getSelectedWriteBatchVolume() {
    const select = document.getElementById('writeBatchVolume');
    if (!select) return null;
    const vid = parseInt(select.value || '0', 10);
    if (!Number.isFinite(vid) || vid <= 0) return null;
    return (writeVolumeProgressCache || []).find(v => Number(v.id) === vid) || null;
}

function clampWriteBatchSize(v) {
    const n = parseInt(String(v || '5'), 10);
    if (!Number.isFinite(n)) return 5;
    return Math.max(1, Math.min(10, n));
}

function getWriteBatchTargetWords() {
    const input = document.getElementById('writeBatchTargetWords');
    if (!input) return null;
    const val = parseInt(String(input.value || '0'), 10);
    return (Number.isFinite(val) && val > 0) ? Math.max(500, Math.min(20000, val)) : null;
}

function renderWriteBatchPendingInfo() {
    const infoEl = document.getElementById('writeBatchPendingInfo');
    if (!infoEl) return;
    const row = getSelectedWriteBatchVolume();
    if (!row) {
        infoEl.textContent = '暂无可用卷。';
        return;
    }
    const batchSize = clampWriteBatchSize(document.getElementById('writeBatchSize')?.value || 5);
    const pending = Math.max(0, Number(row.total || 0) - Number(row.done || 0));
    if (pending <= 0 || row.next_start === null || row.next_start === undefined) {
        infoEl.textContent = `第${row.volume_index}卷正文已完成（${row.done}/${row.total}）。`;
        return;
    }
    const end = Math.min(Number(row.next_start) + batchSize - 1, Number(row.max_index || row.total || row.next_start));
    infoEl.textContent = `第${row.volume_index}卷待生成 ${pending} 章，本批建议范围：第${row.next_start}-${end}章。`;
}

async function loadWriteBatchPanel(projectId) {
    try {
        const select = document.getElementById('writeBatchVolume');
        if (!select) return;

        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        if (!volumes.length) {
            writeVolumeProgressCache = [];
            select.innerHTML = '<option value="">暂无卷（请先生成卷纲）</option>';
            renderWriteBatchPendingInfo();
            return;
        }

        const rows = [];
        for (const vol of volumes) {
            const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
            const sorted = (chapters || []).slice().sort((a, b) => (a.chapter_index || 0) - (b.chapter_index || 0));
            const total = sorted.length;
            const done = sorted.filter(c => c.is_generated).length;
            const nextPending = sorted.find(c => !c.is_generated);
            const maxIndex = sorted.reduce((mx, c) => Math.max(mx, Number(c.chapter_index || 0)), 0);
            rows.push({
                id: vol.id,
                volume_index: Number(vol.volume_index) || 0,
                title: vol.title || '',
                total,
                done,
                next_start: nextPending ? Number(nextPending.chapter_index || 0) : null,
                max_index: maxIndex
            });
        }

        writeVolumeProgressCache = rows.sort((a, b) => (a.volume_index || 0) - (b.volume_index || 0));

        select.innerHTML = writeVolumeProgressCache.map(v => {
            const label = `第${v.volume_index}卷：${v.title || '未命名卷'}（${v.done}/${v.total}已生成）`;
            return `<option value="${v.id}">${escapeHtml(label)}</option>`;
        }).join('');

        const unfinished = writeVolumeProgressCache.find(v => Number(v.done) < Number(v.total));
        select.value = String((unfinished || writeVolumeProgressCache[0]).id);
        select.onchange = () => renderWriteBatchPendingInfo();

        const batchInput = document.getElementById('writeBatchSize');
        if (batchInput) {
            batchInput.onchange = () => {
                batchInput.value = String(clampWriteBatchSize(batchInput.value));
                renderWriteBatchPendingInfo();
            };
        }

        renderWriteBatchPendingInfo();
    } catch (e) {
        console.error('加载正文批量面板失败', e);
    }
}

async function generateWriteNextBatch(projectId) {
    const btn = document.getElementById('btnWriteBatchNext');
    const oldHtml = btn ? btn.innerHTML : '';
    try {
        const selected = getSelectedWriteBatchVolume();
        if (!selected) {
            await uiAlert('请先选择目标卷');
            return;
        }

        const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${selected.id}/chapters`);
        const sorted = (chapters || []).slice().sort((a, b) => (a.chapter_index || 0) - (b.chapter_index || 0));
        const pending = sorted.filter(c => !c.is_generated);
        if (!pending.length) {
            await uiAlert(`第${selected.volume_index}卷正文已经全部生成完成。`);
            await loadWriteBatchPanel(projectId);
            return;
        }

        const batchSize = clampWriteBatchSize(document.getElementById('writeBatchSize')?.value || 5);
        const targets = pending.slice(0, batchSize);
        const start = Number(targets[0]?.chapter_index || 1);
        const end = Number(targets[targets.length - 1]?.chapter_index || start);
        const rangePendingCount = targets.length;
        const afterPending = Math.max(0, pending.length - rangePendingCount);
        const targetWords = getWriteBatchTargetWords();

        const ok = await uiConfirm(
            `确定生成第${selected.volume_index}卷第${start}-${end}章正文吗？\n\n本批预计生成 ${rangePendingCount} 章，完成后剩余 ${afterPending} 章。\n每章约需1-3分钟，页面会自动刷新进度。`
        );
        if (!ok) return;

        if (btn) showLoading(btn, `生成中（第${start}-${end}章）...`);
        setWriteBatchButtonsDisabled(true);
        writeFailedQueue = [];
        writeRetryContext = { projectId, volumeId: selected.id, targetWords };
        renderWriteFailedQueue();
        updateWriteBatchProgress(0, targets.length, `第${selected.volume_index}卷批量正文`);
        const resultEl = document.getElementById('writeBatchResult');
        if (resultEl) resultEl.textContent = '正在启动批量生成任务...';

        // 调用批量接口获取任务ID
        const batchResult = await requestBatchGenerate(projectId, selected.id, batchSize, targetWords);

        if (!batchResult.task_id) {
            // 没有需要生成的章节
            if (resultEl) resultEl.textContent = batchResult.message || '没有需要生成的章节';
            setWriteBatchButtonsDisabled(false);
            if (btn) hideLoading(btn, oldHtml || '生成下一批正文');
            return;
        }

        const taskId = batchResult.task_id;
        if (resultEl) resultEl.textContent = '批量生成任务已启动，正在轮询进度...';

        // 轮询进度
        let pollCount = 0;
        const maxPolls = 600; // 最多轮询600次（约10分钟）
        const pollInterval = 5000; // 每5秒轮询一次

        const pollTimer = setInterval(async () => {
            pollCount++;
            if (pollCount > maxPolls) {
                clearInterval(pollTimer);
                setWriteBatchButtonsDisabled(false);
                if (btn) hideLoading(btn, oldHtml || '生成下一批正文');
                await uiAlert('轮询超时，请刷新页面查看结果');
                return;
            }

            try {
                const progress = await pollBatchProgress(taskId);

                // 更新进度条
                updateWriteBatchProgress(progress.current || 0, progress.total || targets.length, `第${selected.volume_index}卷批量正文`);

                if (resultEl) {
                    resultEl.textContent = progress.message || `进度：${progress.current || 0}/${progress.total || 0}`;
                }

                // 任务完成
                if (progress.status === 'completed') {
                    clearInterval(pollTimer);
                    writeFailedQueue = progress.failed || [];
                    renderWriteFailedQueue();

                    if (resultEl) {
                        resultEl.textContent = progress.message || `本批完成：成功 ${progress.generated_count || 0} 章，失败 ${writeFailedQueue.length} 章。`;
                    }

                    if (writeFailedQueue.length) {
                        await uiAlert(`本批生成完成：成功 ${progress.generated_count || 0} 章，失败 ${writeFailedQueue.length} 章。可点击”重试失败章节”。`);
                    } else {
                        await uiAlert(`本批生成完成：成功 ${progress.generated_count || 0} 章。`);
                    }

                    setWriteBatchButtonsDisabled(false);
                    if (btn) hideLoading(btn, oldHtml || '生成下一批正文');
                    await loadWriteBatchPanel(projectId);
                    await loadGeneratedChapters(projectId);
                    await loadOutline(projectId);
                }

                // 任务失败
                if (progress.status === 'failed') {
                    clearInterval(pollTimer);
                    setWriteBatchButtonsDisabled(false);
                    if (btn) hideLoading(btn, oldHtml || '生成下一批正文');
                    await uiAlert('批量生成失败: ' + (progress.error || '未知错误'));
                }
            } catch (e) {
                console.error('轮询进度失败:', e);
                // 轮询失败不中断，继续尝试
            }
        }, pollInterval);

    } catch (e) {
        await uiAlert('批量生成失败: ' + e.message);
        setWriteBatchButtonsDisabled(false);
        if (btn) hideLoading(btn, oldHtml || '生成下一批正文');
    }
}

async function generateWriteAllRemaining(projectId) {
    const btn = document.getElementById('btnWriteBatchAll');
    const oldHtml = btn ? btn.innerHTML : '';
    try {
        const selected = getSelectedWriteBatchVolume();
        if (!selected) {
            await uiAlert('请先选择目标卷');
            return;
        }

        const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${selected.id}/chapters`);
        const sorted = (chapters || []).slice().sort((a, b) => (a.chapter_index || 0) - (b.chapter_index || 0));
        const pending = sorted.filter(c => !c.is_generated);
        if (!pending.length) {
            await uiAlert(`第${selected.volume_index}卷正文已经全部生成完成。`);
            await loadWriteBatchPanel(projectId);
            return;
        }

        const start = Number(pending[0].chapter_index || 1);
        const end = Number(pending[pending.length - 1]?.chapter_index || start);
        const batchSize = clampWriteBatchSize(document.getElementById('writeBatchSize')?.value || 5);
        const targetWords = getWriteBatchTargetWords();
        const ok = await uiConfirm(
            `确定一键补齐第${selected.volume_index}卷剩余正文吗？\n\n范围：第${start}-${end}章，共 ${pending.length} 章。\n每章约需1-3分钟，页面会自动刷新进度。`
        );
        if (!ok) return;

        if (btn) showLoading(btn, '补齐中，请稍候...');
        setWriteBatchButtonsDisabled(true);
        writeFailedQueue = [];
        writeRetryContext = { projectId, volumeId: selected.id, targetWords };
        renderWriteFailedQueue();
        updateWriteBatchProgress(0, pending.length, `第${selected.volume_index}卷补齐正文`);
        const resultEl = document.getElementById('writeBatchResult');
        if (resultEl) resultEl.textContent = '正在启动批量生成任务...';

        // 调用批量接口获取任务ID
        const batchResult = await requestBatchGenerate(projectId, selected.id, pending.length, targetWords);

        if (!batchResult.task_id) {
            if (resultEl) resultEl.textContent = batchResult.message || '没有需要生成的章节';
            setWriteBatchButtonsDisabled(false);
            if (btn) hideLoading(btn, oldHtml || '一键补齐本卷剩余正文');
            return;
        }

        const taskId = batchResult.task_id;
        if (resultEl) resultEl.textContent = '批量生成任务已启动，正在轮询进度...';

        // 轮询进度
        let pollCount = 0;
        const maxPolls = 600;
        const pollInterval = 5000;

        const pollTimer = setInterval(async () => {
            pollCount++;
            if (pollCount > maxPolls) {
                clearInterval(pollTimer);
                setWriteBatchButtonsDisabled(false);
                if (btn) hideLoading(btn, oldHtml || '一键补齐本卷剩余正文');
                await uiAlert('轮询超时，请刷新页面查看结果');
                return;
            }

            try {
                const progress = await pollBatchProgress(taskId);

                updateWriteBatchProgress(progress.current || 0, progress.total || pending.length, `第${selected.volume_index}卷补齐正文`);

                if (resultEl) {
                    resultEl.textContent = progress.message || `进度：${progress.current || 0}/${progress.total || 0}`;
                }

                if (progress.status === 'completed') {
                    clearInterval(pollTimer);
                    writeFailedQueue = progress.failed || [];
                    renderWriteFailedQueue();

                    if (resultEl) {
                        resultEl.textContent = progress.message || `补齐完成：成功 ${progress.generated_count || 0} 章，失败 ${writeFailedQueue.length} 章。`;
                    }

                    if (writeFailedQueue.length) {
                        await uiAlert(`补齐完成：成功 ${progress.generated_count || 0} 章，失败 ${writeFailedQueue.length} 章。可点击”重试失败章节”。`);
                    } else {
                        await uiAlert(`补齐完成：成功 ${progress.generated_count || 0} 章。`);
                    }

                    setWriteBatchButtonsDisabled(false);
                    if (btn) hideLoading(btn, oldHtml || '一键补齐本卷剩余正文');
                    await loadWriteBatchPanel(projectId);
                    await loadGeneratedChapters(projectId);
                    await loadOutline(projectId);
                }

                if (progress.status === 'failed') {
                    clearInterval(pollTimer);
                    setWriteBatchButtonsDisabled(false);
                    if (btn) hideLoading(btn, oldHtml || '一键补齐本卷剩余正文');
                    await uiAlert('批量生成失败: ' + (progress.error || '未知错误'));
                }
            } catch (e) {
                console.error('轮询进度失败:', e);
            }
        }, pollInterval);

    } catch (e) {
        await uiAlert('一键补齐失败: ' + e.message);
        setWriteBatchButtonsDisabled(false);
        if (btn) hideLoading(btn, oldHtml || '一键补齐本卷剩余正文');
    }
}

async function retryWriteFailedChapters() {
    if (!writeFailedQueue.length) {
        await uiAlert('当前没有失败章节需要重试。');
        return;
    }
    const projectId = Number(writeRetryContext.projectId || (currentProject && currentProject.id));
    if (!projectId) {
        await uiAlert('缺少项目信息，无法重试。');
        return;
    }
    const queue = writeFailedQueue.slice();
    const ok = await uiConfirm(`确定重试失败章节吗？共 ${queue.length} 章。`);
    if (!ok) return;

    const btn = document.getElementById('btnWriteRetryFailed');
    const oldHtml = btn ? btn.innerHTML : '';
    try {
        if (btn) showLoading(btn, '重试中...');
        setWriteBatchButtonsDisabled(true);
        writeFailedQueue = [];
        renderWriteFailedQueue();
        updateWriteBatchProgress(0, queue.length, '重试失败章节');
        const resultEl = document.getElementById('writeBatchResult');
        if (resultEl) resultEl.textContent = '开始重试失败章节...';

        let successCount = 0;
        for (let i = 0; i < queue.length; i++) {
            const t = queue[i];
            const tw = (Number.isFinite(Number(t.target_words)) && Number(t.target_words) > 0)
                ? Number(t.target_words)
                : ((Number.isFinite(Number(writeRetryContext.targetWords)) && Number(writeRetryContext.targetWords) > 0)
                    ? Number(writeRetryContext.targetWords)
                    : null);
            try {
                await requestGenerateChapter(projectId, t.chapter_id, tw);
                successCount += 1;
            } catch (e) {
                writeFailedQueue.push({
                    chapter_id: t.chapter_id,
                    chapter_index: t.chapter_index,
                    title: t.title || '',
                    target_words: tw,
                    error: e.message || '生成失败'
                });
            }
            updateWriteBatchProgress(i + 1, queue.length, '重试失败章节');
        }

        if (resultEl) resultEl.textContent = `重试完成：成功 ${successCount} 章，失败 ${writeFailedQueue.length} 章。`;
        renderWriteFailedQueue();
        if (writeFailedQueue.length) {
            await uiAlert(`重试完成：成功 ${successCount} 章，仍失败 ${writeFailedQueue.length} 章。`);
        } else {
            await uiAlert(`重试完成：全部成功（${successCount}章）。`);
        }
        await loadWriteBatchPanel(projectId);
        await loadGeneratedChapters(projectId);
        await loadOutline(projectId);
    } catch (e) {
        await uiAlert('重试失败: ' + e.message);
    } finally {
        setWriteBatchButtonsDisabled(false);
        if (btn) hideLoading(btn, oldHtml || '重试失败章节');
    }
}

async function loadGeneratedChapters(projectId) {
    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        writeGeneratedItems = [];
        writeCurrentPage = 1;
        Object.keys(writeExpanded).forEach(k => delete writeExpanded[k]);

        for (const vol of volumes) {
            const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
            const generatedChapters = chapters.filter(c => c.is_generated);

            if (generatedChapters.length > 0) {
                for (const chap of generatedChapters) {
                    writeGeneratedItems.push({
                        ...chap,
                        volume_index: vol.volume_index,
                        volume_title: vol.title || ''
                    });
                }
            }
        }

        if (writeGeneratedItems.length > 0) {
            document.getElementById('writeEmpty').classList.add('hidden');
            document.getElementById('generatedChapters').classList.remove('hidden');
            renderWriteGeneratedPage(projectId);
        } else {
            document.getElementById('writeEmpty').classList.remove('hidden');
            document.getElementById('generatedChapters').classList.add('hidden');
            document.getElementById('generatedChapters').innerHTML = '';
        }
    } catch (e) {
        console.error(e);
    }
}

function renderWriteGeneratedPage(projectId) {
    const container = document.getElementById('generatedChapters');
    if (!container) return;
    const total = writeGeneratedItems.length;
    const totalPages = Math.max(1, Math.ceil(total / WRITE_PAGE_SIZE));
    writeCurrentPage = Math.max(1, Math.min(totalPages, writeCurrentPage));
    const start = (writeCurrentPage - 1) * WRITE_PAGE_SIZE;
    const end = start + WRITE_PAGE_SIZE;
    const pageItems = writeGeneratedItems.slice(start, end);

    let html = `
        <div class="flex items-center justify-between mb-3">
            <div class="text-sm text-gray-600">共 ${total} 章 · 第 ${writeCurrentPage}/${totalPages} 页（每页 ${WRITE_PAGE_SIZE} 章）</div>
            <div class="space-x-2">
                <button onclick="changeWritePage(${projectId}, -1)" class="px-3 py-1 border rounded text-sm hover:bg-gray-50" ${writeCurrentPage <= 1 ? 'disabled' : ''}>上一页</button>
                <button onclick="changeWritePage(${projectId}, 1)" class="px-3 py-1 border rounded text-sm hover:bg-gray-50" ${writeCurrentPage >= totalPages ? 'disabled' : ''}>下一页</button>
            </div>
        </div>
    `;

    html += `<div class="space-y-3">`;
    pageItems.forEach(chap => {
        const expanded = !!writeExpanded[chap.id];
        html += `
            <div class="border rounded overflow-hidden">
                <div class="bg-gray-50 px-4 py-3 flex items-center justify-between">
                    <div>
                        <div class="text-xs text-gray-500">第${chap.volume_index}卷</div>
                        <h4 class="font-semibold">${escapeHtml(chap.title)}</h4>
                    </div>
                    <div class="space-x-2">
                        <button onclick="toggleWriteChapter(${projectId}, ${chap.id})" class="px-3 py-1 border rounded text-sm hover:bg-gray-100">${expanded ? '折叠' : '展开'}</button>
                        <button onclick="openChapter(${projectId}, ${chap.id})" class="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition">编辑</button>
                    </div>
                </div>
                <div id="write-chapter-body-${chap.id}" class="${expanded ? '' : 'hidden'} p-4">
                    <div class="text-gray-700 prose max-w-none prose-p:my-2 prose-headings:my-4" id="chapter-content-${chap.id}"></div>
                </div>
            </div>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;

    // 仅为当前页展开章节渲染markdown
    pageItems.forEach(chap => {
        if (!writeExpanded[chap.id]) return;
        const el = document.getElementById(`chapter-content-${chap.id}`);
        if (el && chap.content) {
            el.innerHTML = marked.parse(chap.content);
        }
    });
}

function changeWritePage(projectId, delta) {
    writeCurrentPage += delta;
    renderWriteGeneratedPage(projectId);
}

function toggleWriteChapter(projectId, chapterId) {
    writeExpanded[chapterId] = !writeExpanded[chapterId];
    renderWriteGeneratedPage(projectId);
}

// ========== 阅读模式 ==========
function normalizeReadChapterRows(volumes, chaptersByVolume) {
    const rows = [];
    (volumes || []).forEach((vol, pos) => {
        const displayVolumeIndex = (Number.isFinite(Number(vol.volume_index)) && Number(vol.volume_index) > 0)
            ? Number(vol.volume_index)
            : (pos + 1);
        const chapters = Array.isArray(chaptersByVolume?.[vol.id]) ? chaptersByVolume[vol.id] : [];
        chapters.forEach(chap => {
            rows.push({
                ...chap,
                volume_id: vol.id,
                volume_index: displayVolumeIndex,
                volume_title: vol.title || `第${displayVolumeIndex}卷`
            });
        });
    });
    rows.sort((a, b) => {
        if (Number(a.volume_index || 0) !== Number(b.volume_index || 0)) {
            return Number(a.volume_index || 0) - Number(b.volume_index || 0);
        }
        return Number(a.chapter_index || 0) - Number(b.chapter_index || 0);
    });
    return rows;
}

function getReadCurrentChapter() {
    const rows = readingState.chapters || [];
    if (!rows.length) return null;
    const hit = rows.find(ch => Number(ch.id) === Number(readingState.currentChapterId));
    return hit || rows[0];
}

function getReadChapterIndexById(chapterId) {
    return (readingState.chapters || []).findIndex(ch => Number(ch.id) === Number(chapterId));
}

function ensureReadCurrentChapterId() {
    const rows = readingState.chapters || [];
    if (!rows.length) {
        readingState.currentChapterId = null;
        return;
    }
    const idx = getReadChapterIndexById(readingState.currentChapterId);
    if (idx >= 0) return;
    const firstGenerated = rows.find(ch => ch.is_generated);
    readingState.currentChapterId = Number((firstGenerated || rows[0]).id);
}

function applyReaderTextStyle() {
    const article = document.getElementById('readChapterBody');
    if (!article) return;
    const settings = readingState.settings || {};
    const fontSize = Math.max(14, Math.min(34, Number(settings.fontSize || 20)));
    const lineHeight = Math.max(1.4, Math.min(2.8, Number(settings.lineHeight || 1.95)));
    const maxWidth = Math.max(560, Math.min(1100, Number(settings.width || 840)));
    article.style.fontSize = `${fontSize}px`;
    article.style.lineHeight = `${lineHeight}`;
    article.style.maxWidth = `${maxWidth}px`;
}

function updateReaderSettings() {
    const fsEl = document.getElementById('readerFontSize');
    const lhEl = document.getElementById('readerLineHeight');
    const wdEl = document.getElementById('readerWidth');
    if (!fsEl || !lhEl || !wdEl) return;
    readingState.settings = {
        fontSize: Math.max(14, Math.min(34, Number(fsEl.value || 20))),
        lineHeight: Math.max(1.4, Math.min(2.8, Number(lhEl.value || 1.95))),
        width: Math.max(560, Math.min(1100, Number(wdEl.value || 840)))
    };
    fsEl.value = String(readingState.settings.fontSize);
    lhEl.value = String(readingState.settings.lineHeight);
    wdEl.value = String(readingState.settings.width);
    persistReaderSettings();
    applyReaderTextStyle();
}

function renderReadToc() {
    const desktop = document.getElementById('readTocList');
    const mobile = document.getElementById('readTocListMobile');
    if (!desktop || !mobile) return;
    const rows = readingState.chapters || [];
    if (!rows.length) {
        const empty = `<div class="text-xs text-gray-500 p-2">暂无章节</div>`;
        desktop.innerHTML = empty;
        mobile.innerHTML = empty;
        return;
    }

    const selectedVolumeId = Number(document.getElementById('readVolumeSelect')?.value || 0);
    const filtered = selectedVolumeId > 0 ? rows.filter(r => Number(r.volume_id) === selectedVolumeId) : rows;

    const html = filtered.map(chap => {
        const active = Number(chap.id) === Number(readingState.currentChapterId);
        const title = chap.title || `第${Number(chap.chapter_index || 0)}章`;
        const status = chap.is_generated ? '' : '<span class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">未生成</span>';
        return `
            <button
                onclick="openReadChapter(${Number(chap.id)})"
                class="w-full text-left px-2 py-2 rounded border ${active ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-transparent hover:border-slate-200 hover:bg-slate-50'}"
            >
                <div class="text-[11px] text-slate-500">第${Number(chap.volume_index || 0)}卷 · 第${Number(chap.chapter_index || 0)}章</div>
                <div class="text-sm text-slate-800 mt-0.5 break-all">${escapeHtml(title)}${status}</div>
            </button>
        `;
    }).join('');

    desktop.innerHTML = html;
    mobile.innerHTML = html;
    mobile.classList.toggle('hidden', !readingState.mobileTocOpen);
}

function updateReadHeader(chap) {
    const titleEl = document.getElementById('readChapterTitle');
    const metaEl = document.getElementById('readChapterMeta');
    if (!titleEl || !metaEl) return;
    if (!chap) {
        titleEl.textContent = '请选择章节';
        metaEl.textContent = '未选择';
        return;
    }
    const chapterTitle = chap.title || `第${Number(chap.chapter_index || 0)}章`;
    const status = chap.is_generated ? '已生成' : '未生成';
    const wc = Number(chap.word_count || 0);
    titleEl.textContent = chapterTitle;
    metaEl.textContent = `第${Number(chap.volume_index || 0)}卷 · 第${Number(chap.chapter_index || 0)}章 · ${status}${wc > 0 ? ` · ${wc}字` : ''}`;
}

function renderReadCurrentChapter(scrollTop = false) {
    const article = document.getElementById('readChapterBody');
    const emptyEl = document.getElementById('readEmptyState');
    const wrap = document.getElementById('readChapterBodyWrap');
    if (!article || !emptyEl || !wrap) return;

    ensureReadCurrentChapterId();
    const chap = getReadCurrentChapter();
    updateReadHeader(chap);
    applyReaderTextStyle();

    if (!chap) {
        article.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }

    if (chap.is_generated && chap.content && String(chap.content).trim()) {
        emptyEl.classList.add('hidden');
        article.innerHTML = marked.parse(chap.content);
    } else {
        emptyEl.classList.remove('hidden');
        const fallback = String(chap.outline || chap.goal || '').trim();
        article.innerHTML = fallback
            ? `<div class="text-sm text-slate-600 bg-slate-100 border rounded p-3">本章尚未生成正文。<br>章节概要：${escapeHtml(fallback)}</div>`
            : `<div class="text-sm text-slate-600 bg-slate-100 border rounded p-3">本章尚未生成正文。</div>`;
    }

    if (scrollTop) {
        wrap.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function openReadChapter(chapterId, closeMobileToc = true) {
    if (!chapterId) return;
    readingState.currentChapterId = Number(chapterId);
    const current = getReadCurrentChapter();
    const volSelect = document.getElementById('readVolumeSelect');
    if (current && volSelect && Number(volSelect.value || 0) !== Number(current.volume_id)) {
        volSelect.value = String(current.volume_id);
    }
    if (closeMobileToc) {
        readingState.mobileTocOpen = false;
    }
    renderReadToc();
    renderReadCurrentChapter(true);
}

function gotoReadChapterByOffset(offset) {
    const rows = readingState.chapters || [];
    if (!rows.length) return;
    ensureReadCurrentChapterId();
    const idx = getReadChapterIndexById(readingState.currentChapterId);
    if (idx < 0) return;
    const nextIdx = Math.max(0, Math.min(rows.length - 1, idx + Number(offset || 0)));
    const next = rows[nextIdx];
    if (!next) return;
    openReadChapter(next.id);
}

function gotoPrevReadChapter() {
    gotoReadChapterByOffset(-1);
}

function gotoNextReadChapter() {
    gotoReadChapterByOffset(1);
}

function toggleReadMobileToc() {
    readingState.mobileTocOpen = !readingState.mobileTocOpen;
    renderReadToc();
}

function handleReadVolumeChange() {
    const selectedVolumeId = Number(document.getElementById('readVolumeSelect')?.value || 0);
    const rows = (readingState.chapters || []).filter(r => Number(r.volume_id) === selectedVolumeId);
    if (rows.length) {
        const generated = rows.find(r => r.is_generated);
        readingState.currentChapterId = Number((generated || rows[0]).id);
    }
    renderReadToc();
    renderReadCurrentChapter(true);
}

async function initReadMode(projectId) {
    if (!projectId || !currentProject) return;
    if (readingState.loading) return;
    readingState.loading = true;
    readingState.projectId = Number(projectId);
    readingState.mobileTocOpen = false;

    const volumeSelect = document.getElementById('readVolumeSelect');
    const emptyEl = document.getElementById('readEmptyState');
    if (emptyEl) emptyEl.classList.remove('hidden');

    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        const chaptersByVolume = {};
        for (const vol of (volumes || [])) {
            chaptersByVolume[vol.id] = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
        }
        readingState.chapters = normalizeReadChapterRows(volumes, chaptersByVolume);
        ensureReadCurrentChapterId();

        if (volumeSelect) {
            if (!volumes.length) {
                volumeSelect.innerHTML = '<option value="">暂无卷</option>';
            } else {
                volumeSelect.innerHTML = volumes.map((vol, idx) => {
                    const displayVolumeIndex = (Number.isFinite(Number(vol.volume_index)) && Number(vol.volume_index) > 0)
                        ? Number(vol.volume_index)
                        : (idx + 1);
                    const volRows = readingState.chapters.filter(ch => Number(ch.volume_id) === Number(vol.id));
                    const generatedCount = volRows.filter(ch => ch.is_generated).length;
                    const label = `第${displayVolumeIndex}卷：${vol.title || '未命名卷'}（${generatedCount}/${volRows.length}已生成）`;
                    return `<option value="${Number(vol.id)}">${escapeHtml(label)}</option>`;
                }).join('');
                const current = getReadCurrentChapter();
                const firstVolumeId = current?.volume_id || volumes[0]?.id;
                if (firstVolumeId) volumeSelect.value = String(firstVolumeId);
            }
        }

        renderReadToc();
        renderReadCurrentChapter(true);
        updateReaderSettings();
    } catch (e) {
        console.error('加载阅读模式失败', e);
        await uiAlert('加载阅读模式失败: ' + e.message);
    } finally {
        readingState.loading = false;
    }
}

// ========== 工具 ==========
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== 角色增删改 ==========
function showAddCharacter(projectId) {
    document.getElementById('addCharacterModal').classList.remove('hidden');
    // 清空表单
    document.getElementById('addCharacterName').value = '';
    document.getElementById('addCharacterRole').value = '';
    document.getElementById('addCharacterAvatar').value = '';
    document.getElementById('addCharacterPersonality').value = '';
    document.getElementById('addCharacterBackground').value = '';
    document.getElementById('addCharacterAbilities').value = '';
    document.getElementById('addCharacterRelationships').value = '';
    document.getElementById('addCharacterIsMain').checked = false;
    window.currentAddCharacterProjectId = projectId;
}

function hideAddCharacter() {
    document.getElementById('addCharacterModal').classList.add('hidden');
}

async function saveNewCharacter(event) {
    event.preventDefault();
    const projectId = window.currentAddCharacterProjectId;
    const data = {
        name: document.getElementById('addCharacterName').value,
        role: document.getElementById('addCharacterRole').value,
        avatar: document.getElementById('addCharacterAvatar').value,
        personality: document.getElementById('addCharacterPersonality').value,
        background: document.getElementById('addCharacterBackground').value,
        abilities: document.getElementById('addCharacterAbilities').value,
        relationships: document.getElementById('addCharacterRelationships').value,
        is_main: document.getElementById('addCharacterIsMain').checked
    };

    try {
        await apiRequest(`/api/characters/${projectId}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        hideAddCharacter();
        loadCharacters(projectId);
    } catch (e) {
        uiAlert('添加失败: ' + e.message);
    }
}

async function editCharacter(projectId, characterId) {
    // 获取角色详情然后填充表单
    try {
        const char = await apiRequest(`/api/characters/${projectId}/${characterId}`);
        document.getElementById('editCharacterId').value = characterId;
        document.getElementById('editCharacterName').value = char.name;
        document.getElementById('editCharacterRole').value = char.role || '';
        document.getElementById('editCharacterAvatar').value = char.avatar || '';
        document.getElementById('editCharacterPersonality').value = char.personality || '';
        document.getElementById('editCharacterBackground').value = char.background || '';
        document.getElementById('editCharacterAbilities').value = char.abilities || '';
        document.getElementById('editCharacterRelationships').value = char.relationships || '';
        document.getElementById('editCharacterIsMain').checked = char.is_main;
        document.getElementById('editCharacterModal').classList.remove('hidden');
        window.currentEditProjectId = projectId;
    } catch (e) {
        uiAlert('获取角色信息失败: ' + e.message);
    }
}

function hideEditCharacter() {
    document.getElementById('editCharacterModal').classList.add('hidden');
}

async function saveCharacter(event) {
    event.preventDefault();
    const characterId = document.getElementById('editCharacterId').value;
    const projectId = window.currentEditProjectId;
    const data = {
        name: document.getElementById('editCharacterName').value,
        role: document.getElementById('editCharacterRole').value,
        avatar: document.getElementById('editCharacterAvatar').value,
        personality: document.getElementById('editCharacterPersonality').value,
        background: document.getElementById('editCharacterBackground').value,
        abilities: document.getElementById('editCharacterAbilities').value,
        relationships: document.getElementById('editCharacterRelationships').value,
        is_main: document.getElementById('editCharacterIsMain').checked
    };

    try {
        await apiRequest(`/api/characters/${characterId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        hideEditCharacter();
        loadCharacters(projectId);
    } catch (e) {
        uiAlert('保存失败: ' + e.message);
    }
}

async function deleteCharacter(characterId, projectId) {
    if (!await uiConfirm('确定要删除这个角色吗？此操作不可撤销。')) return;

    try {
        await apiRequest(`/api/characters/${characterId}`, {
            method: 'DELETE'
        });
        loadCharacters(projectId);
    } catch (e) {
        uiAlert('删除失败: ' + e.message);
    }
}

async function deleteAllCharacters(projectId) {
    if (!await uiConfirm('⚠️ 确定要删除这个项目的所有角色吗？此操作不可撤销。')) return;

    try {
        const response = await apiRequest(`/api/characters/${projectId}/all`, {
            method: 'DELETE'
        });
        uiAlert(response.message || '删除成功');
        loadCharacters(projectId);
    } catch (e) {
        uiAlert('删除失败: ' + e.message);
    }
}

// ========== 编辑卷信息 ==========
async function editVolume(projectId, volumeId) {
    // 弹出编辑弹窗
    const vol = await apiRequest(`/api/outline/volumes/${volumeId}`);
    const html = `
        <div id="editVolumeModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h2 class="text-xl font-bold mb-4">编辑卷信息</h2>
                <form onsubmit="saveVolume(event, ${projectId}, ${volumeId})">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">卷标题</label>
                            <input type="text" id="editVolumeTitle" class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">卷概要</label>
                            <textarea id="editVolumeSummary" rows="2" class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">节拍表</label>
                            <textarea id="editVolumeBeatSheet" rows="2" class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="催化事件 → 危机1 → 危机2 → 反转 → 低谷 → 高潮"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">核心冲突</label>
                            <textarea id="editVolumeCoreConflict" rows="2" class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">卷高潮</label>
                            <textarea id="editVolumeClimax" rows="2" class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
                        </div>
                    </div>
                    <div class="flex justify-end space-x-3 mt-6">
                        <button type="button" onclick="closeEditVolume()" class="px-4 py-2 text-gray-600 border rounded hover:bg-gray-50 transition">取消</button>
                        <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition">保存</button>
                    </div>
                </form>
        </div>
    `;
    const div = document.createElement('div');
    div.id = 'editVolumeContainer';
    div.innerHTML = html;
    document.body.appendChild(div);

    // 填充数据
    document.getElementById('editVolumeTitle').value = vol.title || '';
    document.getElementById('editVolumeSummary').value = vol.summary || '';
    document.getElementById('editVolumeBeatSheet').value = vol.beat_sheet || '';
    document.getElementById('editVolumeCoreConflict').value = vol.core_conflict || '';
    document.getElementById('editVolumeClimax').value = vol.climax || '';
}

function closeEditVolume() {
    const container = document.getElementById('editVolumeContainer');
    if (container) container.remove();
}

async function saveVolume(event, projectId, volumeId) {
    event.preventDefault();
    const data = {
        title: document.getElementById('editVolumeTitle').value,
        summary: document.getElementById('editVolumeSummary').value,
        beat_sheet: document.getElementById('editVolumeBeatSheet').value,
        core_conflict: document.getElementById('editVolumeCoreConflict').value,
        climax: document.getElementById('editVolumeClimax').value
    };

    try {
        await apiRequest(`/api/outline/volumes/${volumeId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        closeEditVolume();
        loadOutline(projectId);
    } catch (e) {
        uiAlert('保存失败: ' + e.message);
    }
}

// ========== 对话式工作台（世界观/角色/大纲） ==========
function renderWorkbenchShell(module) {
    const titleMap = { creative_profile: '题材定位工作台', world: '世界观工作台', world_system: '世界观系统工作台', master_outline: '总纲工作台', character_system: '角色系统工作台', characters: '角色工作台', outline: '大纲工作台' };
    const tipsMap = {
        creative_profile: '可连续对话定义核心反差、金手指代价、读者承诺、独特机制，并保存版本。',
        world: '可连续对话细化背景、力量体系、势力规则，并保存版本。',
        world_system: '可连续对话定义规则、代价、资源与限制，并作为写作硬约束。',
        master_outline: '围绕主线、终局、角色成长弧持续对话，沉淀为正式总纲。',
        character_system: '可连续对话设计角色弧线、角色终局与任务卡规则，并注入章节生成。',
        characters: '可连续对话优化群像分工、角色弧线与冲突关系，并保存版本。',
        outline: '可连续对话优化节奏、爆点与章节结构，并保存版本。'
    };
    const focusHints = (module === 'outline' || module === 'master_outline')
      ? `<div class="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 mb-2">对话是主流程：每轮先聊需求 -> 点“符合预期，整理成一版大纲” -> 看大纲再继续微调 -> 满意后“设为正式版”。</div>`
      : '';
    return `
        <div class="border rounded-lg p-4 bg-slate-50">
            <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">${titleMap[module]}</h3>
                <span class="text-xs text-slate-500">支持历史版本对比 / 回滚</span>
            </div>
            <p class="text-sm text-slate-600 mb-3">${tipsMap[module]}</p>
            ${focusHints}
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div class="lg:col-span-2">
                    <div id="wbMessages" class="h-64 overflow-y-auto bg-white border rounded p-3 space-y-2"></div>
                    <div class="mt-2 flex gap-2">
                        <input id="wbInput" type="text" placeholder="输入优化要求，例如：把冲突前置并增加群像任务分工" class="flex-1 px-3 py-2 border rounded">
                        <button id="wbSendBtn" onclick="sendWorkbenchMessage()" class="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">发送并生成候选</button>
                    </div>
                </div>
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <div class="font-medium text-sm text-slate-700">历史版本</div>
                        <button onclick="loadWorkbench(currentProject.id, currentWorkbenchModule)" class="text-xs px-2 py-1 border rounded">刷新</button>
                    </div>
                    <div id="wbVersions" class="h-64 overflow-y-auto bg-white border rounded p-2 space-y-2"></div>
                </div>
            </div>
        </div>
    `;
}

async function loadWorkbench(projectId, module) {
    currentWorkbenchModule = module;
    const panel = document.getElementById('workbenchPanel');
    if (!panel) return;
    panel.innerHTML = renderWorkbenchShell(module);
    try {
        const state = await apiRequest(`/api/workbench/${projectId}/${module}`);
        renderWorkbenchMessages(state.messages || []);
        renderWorkbenchVersions(state.versions || []);
    } catch (e) {
        panel.innerHTML = `<div class="p-3 border rounded bg-red-50 text-red-700 text-sm">工作台加载失败：${escapeHtml(e.message)}</div>`;
    }
}

function renderWorkbenchMessages(messages) {
    const el = document.getElementById('wbMessages');
    if (!el) return;
    if (!messages.length) {
        el.innerHTML = '<p class="text-sm text-slate-500">还没有对话，先输入一条优化指令。</p>';
        return;
    }
    el.innerHTML = messages.map(m => {
        const isUser = m.role === 'user';
        const base = isUser ? 'bg-indigo-50 border-indigo-200' : 'bg-emerald-50 border-emerald-200';
        let action = '';
        if (!isUser && m.has_proposal) {
            action += `<button onclick="applyWorkbenchProposal(${m.id})" class="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700">应用此候选</button>`;
        }
        if (!isUser && (currentWorkbenchModule === 'outline' || currentWorkbenchModule === 'master_outline')) {
            const btnText = currentWorkbenchModule === 'master_outline' ? '符合预期，整理成一版总纲' : '符合预期，整理成一版大纲';
            action += `<button onclick="finalizeFromConversation()" class="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 ml-1">${btnText}</button>`;
            action += `<button onclick="focusWorkbenchInput()" class="text-xs px-2 py-1 border rounded ml-1">继续调整</button>`;
        }
        return `<div class="border rounded p-2 ${base}">
            <div class="text-xs text-slate-500">${isUser ? '你' : 'AI'} · ${new Date(m.created_at).toLocaleString()}</div>
            <div class="text-sm whitespace-pre-wrap break-words">${escapeHtml(m.content || '')}</div>
            ${m.summary ? `<div class="text-xs text-slate-600 mt-1">摘要：${escapeHtml(m.summary)}</div>` : ''}
            ${action ? `<div class="mt-1">${action}</div>` : ''}
        </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
}

function renderWorkbenchVersions(versions) {
    const el = document.getElementById('wbVersions');
    if (!el) return;
    if (!versions.length) {
        el.innerHTML = '<p class="text-sm text-slate-500">暂无版本记录</p>';
        return;
    }
    el.innerHTML = versions.map(v => `
        <div class="border rounded p-2">
            <div class="text-xs text-slate-500">v${v.version_no} · ${new Date(v.created_at).toLocaleString()}</div>
            <div class="text-sm text-slate-700">${escapeHtml(v.summary || '未命名版本')} ${v.is_official ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">正式版</span>' : ''}</div>
            <div class="mt-1 flex gap-1">
                <button onclick="diffWorkbenchVersion(${v.id})" class="text-xs px-2 py-1 border rounded">对比</button>
                <button onclick="restoreWorkbenchVersion(${v.id})" class="text-xs px-2 py-1 bg-slate-700 text-white rounded">回滚</button>
                ${currentWorkbenchModule === 'outline' ? `<button onclick="previewWorkbenchVersionMerge(${v.id})" class="text-xs px-2 py-1 border rounded">预览增量</button><button onclick="publishWorkbenchVersionMerge(${v.id})" class="text-xs px-2 py-1 bg-teal-600 text-white rounded hover:bg-teal-700">增量设正式版</button>` : ''}
                ${(currentWorkbenchModule === 'outline' || currentWorkbenchModule === 'master_outline') ? `<button onclick="publishWorkbenchVersion(${v.id})" class="text-xs px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700">设为正式版</button>` : ''}
            </div>
        </div>
    `).join('');
}

function focusWorkbenchInput() {
    const input = document.getElementById('wbInput');
    if (input) input.focus();
}

async function sendWorkbenchMessage() {
    const input = document.getElementById('wbInput');
    const btn = document.getElementById('wbSendBtn');
    if (!input || !btn || !currentProject || !currentWorkbenchModule) return;
    const message = input.value.trim();
    if (!message) return;
    showLoading(btn, '生成候选中...');
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/chat`, {
            method: 'POST',
            body: JSON.stringify({ message, save_version: true })
        });
        input.value = '';
        await loadWorkbench(currentProject.id, currentWorkbenchModule);
    } catch (e) {
        uiAlert('发送失败: ' + e.message);
    } finally {
        hideLoading(btn, '发送并生成候选');
    }
}

async function applyWorkbenchProposal(messageId) {
    if (!currentProject || !currentWorkbenchModule) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/apply`, {
            method: 'POST',
            body: JSON.stringify({ message_id: messageId, summary: '从对话候选应用' })
        });
        if (currentWorkbenchModule === 'creative_profile') {
            await loadCreativeProfile(currentProject.id);
        } else if (currentWorkbenchModule === 'world') {
            await loadWorldSetting(currentProject.id);
        } else if (currentWorkbenchModule === 'characters') {
            await loadCharacters(currentProject.id);
        } else if (currentWorkbenchModule === 'outline') {
            await loadOutline(currentProject.id);
        }
        await loadWorkbench(currentProject.id, currentWorkbenchModule);
        uiAlert('已应用候选内容');
    } catch (e) {
        uiAlert('应用失败: ' + e.message);
    }
}

async function restoreWorkbenchVersion(versionId) {
    if (!currentProject || !currentWorkbenchModule) return;
    if (!await uiConfirm('确认回滚到这个版本吗？当前内容会被覆盖。')) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/versions/${versionId}/restore`, {
            method: 'POST'
        });
        if (currentWorkbenchModule === 'creative_profile') {
            await loadCreativeProfile(currentProject.id);
        } else if (currentWorkbenchModule === 'world') {
            await loadWorldSetting(currentProject.id);
        } else if (currentWorkbenchModule === 'characters') {
            await loadCharacters(currentProject.id);
        } else if (currentWorkbenchModule === 'outline') {
            await loadOutline(currentProject.id);
        }
        await loadWorkbench(currentProject.id, currentWorkbenchModule);
        uiAlert('回滚成功');
    } catch (e) {
        uiAlert('回滚失败: ' + e.message);
    }
}

async function finalizeFromConversation() {
    if (!currentProject || !(currentWorkbenchModule === 'outline' || currentWorkbenchModule === 'master_outline')) return;
    const objText = currentWorkbenchModule === 'master_outline' ? '总纲' : '大纲';
    const ok = await uiConfirm(`确认把当前对话整理为一版新${objText}吗？`);
    if (!ok) return;
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/finalize`, { method: 'POST' });
        await loadWorkbench(currentProject.id, currentWorkbenchModule);
        if (currentWorkbenchModule === 'outline') {
            await loadOutline(currentProject.id);
        } else {
            await loadMasterOutline(currentProject.id);
        }
        await uiAlert(`已整理为版本 v${res.version_no}：${res.summary}`);
    } catch (e) {
        await uiAlert('整理失败: ' + e.message);
    }
}

async function publishWorkbenchVersion(versionId) {
    if (!currentProject || !currentWorkbenchModule) return;
    const ok = await uiConfirm('确认设为正式版并覆盖当前大纲吗？');
    if (!ok) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/versions/${versionId}/publish`, {
            method: 'POST'
        });
        if (currentWorkbenchModule === 'outline') {
            await loadOutline(currentProject.id);
        } else if (currentWorkbenchModule === 'master_outline') {
            await loadMasterOutline(currentProject.id);
        }
        await loadWorkbench(currentProject.id, currentWorkbenchModule);
        await uiAlert('已设为正式版');
    } catch (e) {
        await uiAlert('设为正式版失败: ' + e.message);
    }
}

async function publishWorkbenchVersionMerge(versionId) {
    if (!currentProject || currentWorkbenchModule !== 'outline') return;
    const ok = await uiConfirm('确认按“增量合并”设为正式版吗？仅更新本版本涉及的卷/章。');
    if (!ok) return;
    try {
        await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/versions/${versionId}/publish-merge`, {
            method: 'POST'
        });
        await loadOutline(currentProject.id);
        await loadWorkbench(currentProject.id, currentWorkbenchModule);
        await uiAlert('已按增量合并设为正式版');
    } catch (e) {
        await uiAlert('增量设正式版失败: ' + e.message);
    }
}

async function previewWorkbenchVersionMerge(versionId) {
    if (!currentProject || currentWorkbenchModule !== 'outline') return;
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/versions/${versionId}/publish-merge-preview`);
        const p = (res && res.preview) || {};
        const rows = Array.isArray(p.volumes) ? p.volumes : [];
        const lines = rows.length
            ? rows.map(v => `第${v.volume_index}卷 ${v.volume_title}：新增${v.add_chapters}章，覆盖${v.update_chapters}章（输入${v.incoming_chapters}章）`).join('\n')
            : '未识别到可合并的卷章数据';
        await uiAlert(`增量发布预览：\n\n${lines}\n\n合计：新增${p.total_add_chapters || 0}章，覆盖${p.total_update_chapters || 0}章`);
    } catch (e) {
        await uiAlert('预览失败: ' + e.message);
    }
}

async function diffWorkbenchVersion(versionId) {
    if (!currentProject || !currentWorkbenchModule) return;
    try {
        const res = await apiRequest(`/api/workbench/${currentProject.id}/${currentWorkbenchModule}/versions/${versionId}/diff`);
        const diff = res.diff || '无差异';
        const modalHtml = `
            <div id="wbDiffModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div class="bg-white rounded-lg p-4 max-w-4xl w-full mx-4 max-h-[85vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="font-semibold">版本差异（当前 vs 历史）</h3>
                        <button onclick="document.getElementById('wbDiffModal').remove()" class="px-2 py-1 border rounded">关闭</button>
                    </div>
                    <pre class="text-xs bg-slate-900 text-slate-100 p-3 rounded overflow-x-auto">${escapeHtml(diff)}</pre>
                </div>
            </div>
        `;
        const holder = document.createElement('div');
        holder.innerHTML = modalHtml;
        document.body.appendChild(holder.firstElementChild);
    } catch (e) {
        uiAlert('获取diff失败: ' + e.message);
    }
}
