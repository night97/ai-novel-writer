let currentProject = null;
let currentChapter = null;
let currentTab = 'world';

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
            themeText.textContent = '☀️ 浅色';
        }
    } else {
        document.documentElement.classList.remove('dark');
        const themeText = document.getElementById('themeText');
        if (themeText) {
            themeText.textContent = '🌙 深色';
        }
    }
}

// DOM加载后应用保存的主题
document.addEventListener('DOMContentLoaded', applyTheme);

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
        const listEl = document.getElementById('projectList');
        listEl.innerHTML = '';
        projects.forEach(p => {
            const item = document.createElement('div');
            item.className = `p-2 border rounded cursor-pointer hover:bg-indigo-50 transition ${currentProject && currentProject.id === p.id ? 'bg-indigo-100 border-indigo-500' : ''}`;
            item.innerHTML = `
                <div class="font-medium">${escapeHtml(p.title)}</div>
                <div class="text-xs text-gray-500">${p.genre} · ${new Date(p.updated_at).toLocaleDateString()}</div>
            `;
            item.onclick = () => selectProject(p);
            listEl.appendChild(item);
        });
    } catch (e) {
        console.error('加载项目列表失败', e);
    }
}

// 选择项目
async function selectProject(project) {
    currentProject = project;
    currentChapter = null;
    currentTab = 'world';
    loadProjects();
    renderProjectDetail(project);
}

// 渲染项目详情
function renderProjectDetail(project) {
    const content = `
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-start">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800">${escapeHtml(project.title)}</h2>
                    <p class="text-gray-500 mt-1">${project.genre} · ${project.enable_review ? '审查开启' : '审查关闭'} · 每章${project.target_words_per_chapter}字</p>
                    ${project.description ? `<p class="text-gray-700 mt-2">${escapeHtml(project.description)}</p>` : ''}
                </div>
                <button onclick="deleteProject(${project.id})" class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition">删除项目</button>
            </div>
        </div>

        <!-- Tab 导航 -->
        <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="flex border-b">
                <button class="flex-1 py-3 px-4 font-medium ${currentTab === 'world' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}" onclick="switchTab('world')">
                    1. 世界观
                </button>
                <button class="flex-1 py-3 px-4 font-medium ${currentTab === 'characters' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}" onclick="switchTab('characters')">
                    2. 角色
                </button>
                <button class="flex-1 py-3 px-4 font-medium ${currentTab === 'outline' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}" onclick="switchTab('outline')">
                    3. 大纲
                </button>
                <button class="flex-1 py-3 px-4 font-medium ${currentTab === 'write' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}" onclick="switchTab('write')">
                    4. 写作
                </button>
                <button class="flex-1 py-3 px-4 font-medium ${currentTab === 'export' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}" onclick="switchTab('export')">
                    5. 导出
                </button>
            </div>
            <div id="tabContent" class="p-4">
                <!-- 内容由switchTab填充 -->
            </div>
        </div>
    `;

    document.getElementById('mainContent').innerHTML = content;
    switchTab(currentTab);
}

// 切换Tab
function switchTab(tab) {
    currentTab = tab;

    // 更新按钮样式
    document.querySelector('#tabContent').parentElement.querySelectorAll('.flex > button').forEach((btn, index) => {
        const tabNames = ['world', 'characters', 'outline', 'write', 'export'];
        const btnTab = tabNames[index];
        if (btnTab === tab) {
            btn.className = "flex-1 py-3 px-4 font-medium bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600";
        } else {
            btn.className = "flex-1 py-3 px-4 font-medium text-gray-500 hover:bg-gray-50";
        }
    });

    const contentEl = document.getElementById('tabContent');
    const projectId = currentProject.id;

    if (tab === 'world') {
        contentEl.innerHTML = `
            <div class="mb-4 flex justify-end">
                <button onclick="generateWorld(${projectId})" id="btnGenerateWorld" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition">
                    AI生成世界观
                </button>
            </div>
            <div id="worldSettingBody">
                <p class="text-gray-500 italic">尚未生成世界观设定，点击上方按钮让AI生成</p>
            </div>
        `;
        loadWorldSetting(projectId);
    } else if (tab === 'characters') {
        contentEl.innerHTML = `
            <div class="mb-4 flex justify-end gap-2">
                <button onclick="showAddCharacter(${projectId})" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition">
                    添加角色
                </button>
                <button onclick="generateCharacters(${projectId})" id="btnGenerateChars" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition">
                    AI生成角色
                </button>
                <button onclick="deleteAllCharacters(${projectId})" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition">
                    清空所有
                </button>
            </div>
            <div id="characterListBody">
                <p class="text-gray-500 italic">尚未生成角色</p>
            </div>
        `;
        loadCharacters(projectId);
    } else if (tab === 'outline') {
        contentEl.innerHTML = `
            <div class="mb-4 bg-blue-50 p-3 rounded">
                <p class="text-sm text-blue-800">💡 提示：对于50章大卷，推荐使用<strong>分步生成</strong>：先生成卷骨架，再分批生成每10章，更稳定不易失败。</p>
            </div>
            <div class="flex gap-4 mb-4 items-end">
                <div>
                    <label class="block text-sm text-gray-600 mb-1">总章节数</label>
                    <input type="number" id="totalChapters" value="50" min="10" max="100" class="w-24 px-2 py-1 border rounded">
                </div>
                <div>
                    <label class="block text-sm text-gray-600 mb-1">每批生成</label>
                    <input type="number" id="batchSize" value="10" min="5" max="30" class="w-20 px-2 py-1 border rounded">
                </div>
            </div>
            <div class="flex gap-2 mb-4">
                <button onclick="generateNextVolumeSkeleton(${projectId})" id="btnGenerateSkeleton" class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition">
                    1. 生成卷骨架
                </button>
                <button onclick="generateNextBatch(${projectId})" id="btnGenerateBatch" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition">
                    2. 生成下一批章节
                </button>
            </div>
            <div id="outlineContent" class="space-y-3">
                <p class="text-gray-500 italic">尚未生成大纲，点击上方按钮开始分步生成</p>
            </div>
        `;
        loadOutline(projectId);
    } else if (tab === 'write') {
        contentEl.innerHTML = `
            <div id="writeContent" class="space-y-3">
                <div class="text-center py-8 text-gray-500" id="writeEmpty">
                    <p>请先生成大纲和章节，生成好的正文会显示在这里</p>
                </div>
                <div id="generatedChapters" class="hidden space-y-4"></div>
            </div>
        `;
        loadGeneratedChapters(projectId);
    } else if (tab === 'export') {
        contentEl.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <button onclick="exportFullText(${projectId})" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition">导出全文(Markdown)</button>
                    <button onclick="exportFullProject(${projectId})" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">导出完整项目(含所有设定)</button>
                </div>
                <div id="exportContent" class="mt-4 hidden">
                    <textarea id="fullTextArea" class="w-full h-64 p-2 border rounded bg-gray-50" readonly></textarea>
                    <div class="mt-2 space-x-2">
                        <button onclick="copyFullText()" class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition">复制</button>
                        <button onclick="downloadFullText(${projectId})" class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition">下载全文</button>
                    </div>
                </div>
                <div id="exportProjectContent" class="mt-4 hidden">
                    <textarea id="fullProjectArea" class="w-full h-64 p-2 border rounded bg-gray-50" readonly></textarea>
                    <div class="mt-2 space-x-2">
                        <button onclick="copyFullProject()" class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition">复制</button>
                         <button onclick="downloadFullProject(${projectId})" class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition">下载项目</button>
                    </div>
                </div>
            </div>
        `;
    }
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
        alert('创建成功！');
    } catch (e) {
        alert('创建失败: ' + e.message);
    }
}

// ========== 世界观 ==========
async function loadWorldSetting(projectId) {
    try {
        const world = await apiRequest(`/api/projects/${projectId}/world`);
        const el = document.getElementById('worldSettingBody');
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
        document.getElementById('worldSettingBody').innerHTML = `<p class="text-gray-500 italic">${e.message}</p>`;
    }
}

async function generateWorld(projectId) {
    if (!confirm('确定要生成世界观吗？会覆盖已有的内容。')) return;

    const btn = document.getElementById('btnGenerateWorld');
    const oldHtml = btn.innerHTML;
    showLoading(btn);

    const userPrompt = prompt('请输入额外要求（留空使用项目描述）：') || '';

    try {
        await apiRequest(`/api/projects/${projectId}/generate-world?user_prompt=${encodeURIComponent(userPrompt)}`, {
            method: 'POST'
        });
        loadWorldSetting(projectId);
        alert('生成成功！切换到下一步继续。');
    } catch (e) {
        alert('生成失败: ' + e.message);
    } finally {
        hideLoading(btn, oldHtml);
    }
}

// ========== 角色 ==========
async function loadCharacters(projectId) {
    try {
        const chars = await apiRequest(`/api/characters/${projectId}`);
        const el = document.getElementById('characterListBody');
        if (chars.length === 0) {
            el.innerHTML = `<p class="text-gray-500 italic">尚未生成角色</p>`;
            return;
        }

        let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
        chars.forEach(c => {
            const badge = c.is_main ? '<span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">主角</span>' : '';
            html += `
                <div class="border rounded p-3 hover:shadow-sm transition">
                    <div class="font-medium flex items-center justify-between">
                        <span>${escapeHtml(c.name)}${badge}</span>
                        <div class="space-x-1">
                            <button onclick="editCharacter(${projectId}, ${c.id})" class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 transition">编辑</button>
                            <button onclick="deleteCharacter(${c.id}, ${projectId})" class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200 transition">删除</button>
                        </div>
                    </div>
                    ${c.role ? `<div class="text-sm mt-1"><span class="text-gray-600">定位：</span>${escapeHtml(c.role)}</div>` : ''}
                    ${c.avatar ? `<div class="text-sm mt-1"><span class="text-gray-600">外貌：</span>${escapeHtml(c.avatar)}</div>` : ''}
                    ${c.personality ? `<div class="text-sm mt-1"><span class="text-gray-600">性格：</span>${escapeHtml(c.personality)}</div>` : ''}
                    ${c.background ? `<div class="text-sm mt-1"><span class="text-gray-600">背景：</span>${escapeHtml(c.background)}</div>` : ''}
                    ${c.relationships ? `<div class="text-sm mt-1"><span class="text-gray-600">关系：</span>${escapeHtml(c.relationships)}</div>` : ''}
                </div>
            `;
        });
        html += '</div>';
        el.innerHTML = html;
    } catch (e) {
        console.error(e);
    }
}

async function generateCharacters(projectId) {
    if (!confirm('确定要生成角色吗？会添加新角色。')) return;

    const btn = document.getElementById('btnGenerateChars');
    const oldHtml = btn.innerHTML;
    showLoading(btn);

    const userPrompt = prompt('请输入额外要求（留空使用项目描述）：') || '';

    try {
        await apiRequest(`/api/characters/${projectId}/generate?user_prompt=${encodeURIComponent(userPrompt)}`, {
            method: 'POST'
        });
        loadCharacters(projectId);
        alert('生成成功！切换到下一步继续。');
    } catch (e) {
        alert('生成失败: ' + e.message);
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

        if (!confirm(`确定要生成第 ${nextVolumeIndex} 卷骨架吗？\n\n总章节数：${totalChapters}\n生成骨架后再分批生成章节。`)) return;

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
        alert(response.message || '生成骨架成功！现在点击"生成下一批章节"继续。');
    } catch (e) {
        alert('生成失败: ' + e.message);
    } finally {
        hideLoading(document.getElementById('btnGenerateSkeleton'), '1. 生成卷骨架');
    }
}

async function generateNextBatch(projectId) {
    const batchSize = parseInt(document.getElementById('batchSize').value) || 10;

    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        if (volumes.length === 0) {
            alert('请先生成卷骨架！');
            return;
        }

        // 找到最后一个卷
        const lastVolume = volumes[volumes.length - 1];
        const existingChapters = await apiRequest(`/api/outline/${projectId}/volumes/${lastVolume.id}/chapters`);
        const nextStartChapter = existingChapters.length + 1;
        const totalChapters = parseInt(document.getElementById('totalChapters').value) || 50;

        if (existingChapters.length >= totalChapters) {
            alert('本卷已经生成完所有章节了！');
            return;
        }

        const remaining = totalChapters - existingChapters.length;
        const batchEnd = Math.min(existingChapters.length + batchSize, totalChapters);
        const batchCount = batchEnd - existingChapters.length;

        if (!confirm(`确定要生成第 ${lastVolume.volume_index} 卷的第 ${nextStartChapter}-${batchEnd} 章吗？\n\n共 ${batchCount} 章，剩余 ${remaining - batchCount} 章。`)) return;

        const btn = document.getElementById('btnGenerateBatch');
        const oldHtml = btn.innerHTML;
        showLoading(btn, `正在生成第 ${nextStartChapter}-${batchEnd} 章...`);

        const response = await apiRequest('/api/outline/generate-volume-chapters', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                volume_id: lastVolume.id,
                volume_index: lastVolume.volume_index,
                start_chapter: nextStartChapter,
                end_chapter: batchEnd,
                total_chapters: totalChapters
            })
        });

        loadOutline(projectId);
        alert(response.message || `生成成功！还剩 ${remaining - batchCount} 章。`);
    } catch (e) {
        alert('生成失败: ' + e.message);
    } finally {
        hideLoading(document.getElementById('btnGenerateBatch'), '2. 生成下一批章节');
    }
}

// ========== 大纲 - 一次性生成 ==========
async function generateNextVolume(projectId) {
    const chaptersPerVolume = parseInt(document.getElementById('chaptersPerVolume').value) || 30;

    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        const nextVolumeIndex = volumes.length + 1;

        if (!confirm(`确定要生成第 ${nextVolumeIndex} 卷，共 ${chaptersPerVolume} 章吗？\n\n生成需要一点时间，请耐心等待。`)) return;

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
        alert(response.message || '生成成功！');
    } catch (e) {
        alert('生成失败: ' + e.message);
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

        let html = '';
        // 添加进度条
        for (const vol of volumes) {
            const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
            totalChapters += chapters.length;
            doneChapters += chapters.filter(c => c.is_generated).length;
        }

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
        for (const vol of volumes) {
            const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);

            html += `
                <div class="border rounded overflow-hidden">
                    <div class="bg-gray-50 dark:bg-gray-800 p-3 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                         onclick="toggleVolume(${vol.id})">
                        <div>
                            <span class="font-semibold">第${vol.volume_index}卷：${escapeHtml(vol.title)}</span>
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
                const statusText = chap.is_generated
                    ? `<button onclick="openChapter(${projectId}, ${chap.id})" class="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition">查看/编辑</button>`
                    : `<button onclick="generateChapter(${projectId}, ${chap.id}, this)" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition">生成</button>`;

                html += `
                    <div class="pl-3 border-l-2 ${statusClass} py-2">
                        <div class="flex justify-between items-center gap-2">
                            <span class="font-medium text-sm">
                                第${chap.chapter_index}章：${escapeHtml(chap.title)}
                            </span>
                            ${statusText}
                        </div>
                        ${chap.outline ? `<p class="text-xs text-gray-600 mt-1">${escapeHtml(chap.outline)}</p>` : ''}
                    </div>
                `;
            }

            html += `</div></div></div>`;
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

// ========== 章节生成 ==========
async function generateChapter(projectId, chapterId, btnEl = null) {
    if (!confirm('确定要生成这一章吗？')) return;

    try {
        const btn = btnEl;
        const oldHtml = btn ? btn.innerHTML : '';
        if (btn) showLoading(btn, '生成中...');

        const chapter = await apiRequest('/api/write/chapter', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                chapter_id: chapterId
            })
        });
        alert('生成成功！');
        openChapter(projectId, chapterId);
        loadOutline(projectId);
    } catch (e) {
        alert('生成失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

function openChapter(projectId, chapterId) {
    currentChapter = chapterId;
    apiRequest(`/api/write/chapter/${chapterId}`)
        .then(chapter => {
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
            })
        });
        alert('保存成功！');
        closeChapter();
        loadOutline(projectId);
    } catch (e) {
        alert('保存失败: ' + e.message);
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
        alert('优化成功！请保存修改。');
    } catch (e) {
        alert('优化失败: ' + e.message);
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
    const userPrompt = window.prompt('请输入额外修改要求（可选）。可直接使用模板：', defaultConstraintTemplate) || '';
    if (!confirm('确定要重新生成吗？会覆盖当前内容。')) return;

    const btn = btnEl;
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) showLoading(btn, '生成中...');

    try {
        const chapter = await apiRequest(`/api/write/chapter/${chapterId}/regenerate`, {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                user_prompt: userPrompt
            })
        });
        document.getElementById('editChapterContent').value = chapter.content;
        alert('重新生成成功！');
    } catch (e) {
        alert('生成失败: ' + e.message);
    } finally {
        if (btn) hideLoading(btn, oldHtml);
    }
}

async function clearChapterContent(projectId, chapterId) {
    if (!confirm('确定要清空内容吗？')) return;

    try {
        await apiRequest(`/api/write/chapter/${chapterId}/content`, {
            method: 'DELETE'
        });
        document.getElementById('editChapterContent').value = '';
        alert('已清空');
        closeChapter();
        loadOutline(projectId);
    } catch (e) {
        alert('操作失败: ' + e.message);
    }
}

// ========== 删除项目 ==========
async function deleteProject(projectId) {
    if (!confirm('确定要删除这个项目吗？此操作不可撤销。')) return;

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
        alert('删除成功');
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

// ========== 导出 ==========
async function exportFullText(projectId) {
    try {
        const result = await apiRequest(`/api/write/full-text/${projectId}`);
        document.getElementById('exportContent').classList.remove('hidden');
        document.getElementById('fullTextArea').value = result.full_text;
        alert(`导出成功！共 ${result.word_count} 字，${result.chapter_count} 章`);
    } catch (e) {
        alert('导出失败: ' + e.message);
    }
}

function copyFullText() {
    const textarea = document.getElementById('fullTextArea');
    textarea.select();
    document.execCommand('copy');
    alert('已复制到剪贴板');
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
        alert(`项目导出成功！共 ${volumes.length} 卷 ${totalChapters} 章`);
    } catch (e) {
        alert('导出失败: ' + e.message);
    }
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
    if (!select) return;

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
}

async function loadLLMSettings() {
    try {
        const state = await apiRequest('/api/settings/llm/profiles');
        renderLLMProfiles(state);
    } catch (e) {
        console.warn('加载模型配置失败', e);
        const badge = document.getElementById('activeModelBadge');
        if (badge) badge.textContent = '当前模型：加载失败';
    }
}

function openLLMSettings() {
    const modal = document.getElementById('llmSettingsModal');
    modal.classList.remove('hidden');
    loadLLMSettings();
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
    const name = prompt('请输入新配置名称：', defaultName);
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
        alert('新建失败: ' + e.message);
    }
}

async function deleteCurrentLLMProfile() {
    const current = getCurrentLLMProfile();
    if (!current) return;
    if (!confirm(`确定删除配置「${current.name}」吗？`)) return;
    try {
        const state = await apiRequest(`/api/settings/llm/profiles/${current.id}`, {
            method: 'DELETE'
        });
        renderLLMProfiles(state);
        alert('删除成功');
    } catch (e) {
        alert('删除失败: ' + e.message);
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
        alert(`已切换为：${current.name}`);
    } catch (e) {
        alert('切换失败: ' + e.message);
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
        alert('请先新建一个配置');
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
        alert('请填写配置名称');
        return;
    }
    if (!payload.api_key) {
        alert('请填写 API Key');
        return;
    }
    if (!payload.model) {
        alert('请填写 Model');
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
        alert('配置已保存');
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}

function copyFullProject() {
    const textarea = document.getElementById('fullProjectArea');
    textarea.select();
    document.execCommand('copy');
    alert('已复制到剪贴板');
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
async function loadGeneratedChapters(projectId) {
    try {
        const volumes = await apiRequest(`/api/outline/${projectId}/volumes`);
        let hasGenerated = false;
        let html = '';

        for (const vol of volumes) {
            const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
            const generatedChapters = chapters.filter(c => c.is_generated);

            if (generatedChapters.length > 0) {
                hasGenerated = true;
                html += `<div class="border rounded overflow-hidden">
                    <div class="bg-gray-50 p-3 font-semibold">${escapeHtml(`第${vol.volume_index}卷：${vol.title}`)}</div>
                    <div class="divide-y">`;

                for (const chap of generatedChapters) {
                    html += `
                        <div class="p-4">
                            <div class="flex justify-between items-center mb-2">
                                <h4 class="font-semibold">${escapeHtml(chap.title)}</h4>
                                <button onclick="openChapter(${projectId}, ${chap.id})" class="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition">编辑</button>
                            </div>
                            <div class="text-gray-700 prose max-w-none prose-p:my-2 prose-headings:my-4" id="chapter-content-${chap.id}">
                            </div>
                        </div>
                    `;
                }

                html += `</div></div>`;
            }
        }

        if (hasGenerated) {
            document.getElementById('writeEmpty').classList.add('hidden');
            document.getElementById('generatedChapters').classList.remove('hidden');
            document.getElementById('generatedChapters').innerHTML = html;

            // 渲染markdown
            for (const vol of volumes) {
                const chapters = await apiRequest(`/api/outline/${projectId}/volumes/${vol.id}/chapters`);
                for (const chap of chapters.filter(c => c.is_generated)) {
                    const el = document.getElementById(`chapter-content-${chap.id}`);
                    if (el && chap.content) {
                        el.innerHTML = marked.parse(chap.content);
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
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
        alert('添加失败: ' + e.message);
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
        alert('获取角色信息失败: ' + e.message);
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
        alert('保存失败: ' + e.message);
    }
}

async function deleteCharacter(characterId, projectId) {
    if (!confirm('确定要删除这个角色吗？此操作不可撤销。')) return;

    try {
        await apiRequest(`/api/characters/${characterId}`, {
            method: 'DELETE'
        });
        loadCharacters(projectId);
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

async function deleteAllCharacters(projectId) {
    if (!confirm('⚠️ 确定要删除这个项目的所有角色吗？此操作不可撤销。')) return;

    try {
        const response = await apiRequest(`/api/characters/${projectId}/all`, {
            method: 'DELETE'
        });
        alert(response.message || '删除成功');
        loadCharacters(projectId);
    } catch (e) {
        alert('删除失败: ' + e.message);
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
        alert('保存失败: ' + e.message);
    }
}
