// LLM工具箱 - 前端交互逻辑

// 唯一ID计数器
let idCounter = 0;
function generateId(prefix) {
    return `${prefix}-${Date.now()}-${++idCounter}`;
}

// 状态管理
let currentTool = null;
let currentConversationId = null;
let isStreaming = false;
let uploadedImageUrl = null;
let endpoints = [];
let models = [];

// 流式输出控制
let currentAbortController = null;
let currentStreamReader = null;
let currentAssistantDiv = null;
let currentContent = '';

// ASR状态
let asrPendingFiles = [];
let asrResults = [];
let isASRProcessing = false;
let asrAbortController = null;

// OCR状态
let ocrPendingFiles = [];
let ocrResults = [];
let isOCRProcessing = false;
let ocrAbortController = null;

// 端点模态框状态
let currentEndpointId = null;
let fetchedModels = [];

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', async () => {
    await loadEndpoints();
    await loadModels();
    await loadTools();
    setupEventListeners();
});

function setupEventListeners() {
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    });

    document.getElementById('image-input').addEventListener('change', handleImageUpload);
    document.getElementById('asr-file-input').addEventListener('change', handleASRFileSelect);

    document.querySelectorAll('input[name="tool-type-radio"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateToolPromptTemplate(radio.value);
        });
    });
}

// ========== Toast提示 ==========

let toastTimeout = null;

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    const msg = document.getElementById('toast-message');

    toast.className = `toast-box toast-${type}`;
    icon.textContent = type === 'success' ? '\u2713' : '\u00D7';
    msg.textContent = message;

    // Reset animation
    toast.classList.remove('toast-show');
    void toast.offsetWidth; // Force reflow
    toast.classList.add('toast-show');

    // Clear previous timeout
    if (toastTimeout) clearTimeout(toastTimeout);

    // Auto hide after 2.5s
    toastTimeout = setTimeout(() => {
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
    }, 2500);
}

// ========== 端点管理 ==========

async function loadEndpoints() {
    try {
        const response = await fetch('/api/endpoints');
        endpoints = await response.json();
        renderEndpointList();
        updateEndpointSelect();
    } catch (error) {
        console.error('加载端点失败:', error);
    }
}

function renderEndpointList() {
    const list = document.getElementById('endpoint-list');
    if (endpoints.length === 0) {
        list.innerHTML = '<div class="empty-item">暂无端点</div>';
        return;
    }
    list.innerHTML = endpoints.map(ep => `
        <div class="sidebar-item" onclick="showEndpointModal(${ep.id})" title="${ep.endpoint_type}: ${ep.api_url}">
            <div class="item-left">
                <div class="item-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                </div>
                <span class="item-name">${escapeHtml(ep.name)}</span>
            </div>
            <div class="item-right">
                <span class="badge-count">${ep.model_count}</span>
                <button class="item-btn danger" onclick="deleteEndpoint(${ep.id}, event)" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function updateEndpointSelect() {
    const select = document.getElementById('tool-endpoint');
    if (endpoints.length === 0) {
        select.innerHTML = '<option value="">-- 请先添加端点 --</option>';
        return;
    }
    select.innerHTML = '<option value="">-- 请选择端点 --</option>' +
        endpoints.map(ep => `<option value="${ep.id}">${escapeHtml(ep.name)}</option>`).join('');
}

function showEndpointModal(id = null) {
    const modal = new bootstrap.Modal(document.getElementById('endpointModal'));
    document.getElementById('endpointModalTitle').innerHTML = id
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg> 编辑端点'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg> 添加端点';

    currentEndpointId = id;
    document.getElementById('endpoint-form').reset();
    document.getElementById('fetch-models-btn').disabled = true;
    document.getElementById('model-empty-hint').style.display = 'flex';
    document.getElementById('fetched-models-list').style.display = 'none';
    document.getElementById('saved-models-list').style.display = 'none';
    fetchedModels = [];

    if (id) {
        fetch(`/api/endpoints/${id}`)
            .then(r => r.json())
            .then(endpoint => {
                document.getElementById('endpoint-id').value = endpoint.id;
                document.getElementById('endpoint-name').value = endpoint.name;
                document.querySelector(`input[name="endpoint-type-radio"][value="${endpoint.endpoint_type}"]`).checked = true;
                document.getElementById('endpoint-api-url').value = endpoint.api_url;
                document.getElementById('endpoint-api-key').value = endpoint.api_key || '';
                document.getElementById('fetch-models-btn').disabled = false;
                loadSavedModels(id);
            });
    }

    modal.show();
}

async function saveEndpoint() {
    const id = document.getElementById('endpoint-id').value;
    const data = {
        name: document.getElementById('endpoint-name').value,
        endpoint_type: document.querySelector('input[name="endpoint-type-radio"]:checked').value,
        api_url: document.getElementById('endpoint-api-url').value,
        api_key: document.getElementById('endpoint-api-key').value || null
    };

    try {
        const url = id ? `/api/endpoints/${id}` : '/api/endpoints';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            const saved = await response.json();
            currentEndpointId = saved.id;
            document.getElementById('endpoint-id').value = saved.id;
            document.getElementById('fetch-models-btn').disabled = false;
            showToast('端点保存成功');
            await loadEndpoints();
        } else {
            const error = await response.json();
            showToast(error.detail || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存端点失败:', error);
        showToast('保存失败', 'error');
    }
}

async function testEndpoint() {
    const apiUrl = document.getElementById('endpoint-api-url').value.trim();
    const apiKey = document.getElementById('endpoint-api-key').value.trim();
    const endpointType = document.querySelector('input[name="endpoint-type-radio"]:checked').value;

    if (!apiUrl) {
        showToast('请填写API地址', 'error');
        return;
    }

    const testBtn = document.querySelector('button[onclick="testEndpoint()"]');
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" style="width:12px;height:12px;"></span> 测试中...';

    try {
        const response = await fetch('/api/endpoints/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'test',
                endpoint_type: endpointType,
                api_url: apiUrl,
                api_key: apiKey || null
            })
        });

        if (response.ok) {
            const data = await response.json();
            showToast(`连接成功，发现 ${data.model_count} 个模型`);
        } else {
            const error = await response.json();
            showToast(error.detail || '连接失败', 'error');
        }
    } catch (error) {
        console.error('测试连接失败:', error);
        showToast('连接失败', 'error');
    }

    testBtn.disabled = false;
    testBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg> 测试连接';
}

async function deleteEndpoint(id, event) {
    event.stopPropagation();
    if (!confirm('确定删除此端点？关联的模型也会被删除。')) return;

    try {
        const response = await fetch(`/api/endpoints/${id}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('端点已删除');
            await loadEndpoints();
            await loadModels();
        }
    } catch (error) {
        console.error('删除端点失败:', error);
        showToast('删除失败', 'error');
    }
}

// ========== 模型管理 ==========

async function loadModels() {
    try {
        const response = await fetch('/api/models');
        models = await response.json();
    } catch (error) {
        console.error('加载模型失败:', error);
    }
}

async function loadSavedModels(endpointId) {
    try {
        const response = await fetch('/api/models');
        const allModels = await response.json();
        const savedModels = allModels.filter(m => m.endpoint_id === endpointId);

        if (savedModels.length > 0) {
            document.getElementById('saved-models-list').style.display = 'block';
            document.getElementById('saved-models-container').innerHTML = savedModels.map(m => `
                <div class="saved-model-item">
                    <span class="saved-model-name">${escapeHtml(m.display_name || m.model_name)}${m.display_name ? ` <span style="opacity:0.4">(${escapeHtml(m.model_name)})</span>` : ''}</span>
                    <button class="saved-model-remove" onclick="deleteModel(${m.id})">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `).join('');
        } else {
            document.getElementById('saved-models-list').style.display = 'none';
        }
    } catch (error) {
        console.error('加载已保存模型失败:', error);
    }
}

async function fetchModels() {
    if (!currentEndpointId) {
        showToast('请先保存端点', 'error');
        return;
    }

    const btn = document.getElementById('fetch-models-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" style="width:10px;height:10px;"></span> 拉取中...';

    try {
        const savedResponse = await fetch('/api/models');
        const allModels = await savedResponse.json();
        const savedModels = allModels.filter(m => m.endpoint_id === currentEndpointId);
        const savedModelNames = new Set(savedModels.map(m => m.model_name));

        const response = await fetch(`/api/endpoints/${currentEndpointId}/fetch-models`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok) {
            fetchedModels = data.models;
            const fetchedModelIds = new Set(fetchedModels.map(m => m.id));

            const modelsToRemove = savedModels.filter(m => !fetchedModelIds.has(m.model_name));
            let removedCount = 0;
            for (const model of modelsToRemove) {
                try {
                    const delResponse = await fetch(`/api/models/${model.id}`, { method: 'DELETE' });
                    if (delResponse.ok) removedCount++;
                } catch (e) {
                    console.error(`删除模型 ${model.model_name} 失败:`, e);
                }
            }

            await loadModels();

            document.getElementById('model-empty-hint').style.display = 'none';
            document.getElementById('fetched-models-list').style.display = 'block';

            if (fetchedModels.length === 0) {
                document.getElementById('fetched-models-list').innerHTML =
                    '<div class="empty-item">未找到可用模型</div>';
            } else {
                const updatedSavedModels = models.filter(m => m.endpoint_id === currentEndpointId);
                const updatedSavedNames = new Set(updatedSavedModels.map(m => m.model_name));

                document.getElementById('fetched-models-list').innerHTML = `
                    <div class="select-all-bar">
                        <input type="checkbox" id="select-all-models" onchange="toggleAllModels()">
                        <label for="select-all-models">全选（${fetchedModels.length} 个模型）</label>
                    </div>
                    <div class="model-checkbox-list">
                        ${fetchedModels.map(m => `
                            <div class="model-checkbox-item">
                                <input type="checkbox" class="model-checkbox"
                                       value="${m.id}" data-name="${m.name}" id="model-${m.id}"
                                       ${updatedSavedNames.has(m.name) ? 'checked' : ''}>
                                <label for="model-${m.id}">
                                    ${escapeHtml(m.name)}
                                    ${updatedSavedNames.has(m.name) ? '<span class="badge-mini badge-chat" style="margin-left:6px;">已添加</span>' : ''}
                                </label>
                            </div>
                        `).join('')}
                    </div>
                    <button class="add-selected-btn" onclick="addSelectedModels()">
                        添加选中的模型
                    </button>
                `;
            }

            await loadSavedModels(currentEndpointId);

            let message = `获取到 ${fetchedModels.length} 个模型`;
            if (removedCount > 0) {
                message += `，已删除 ${removedCount} 个不存在的模型`;
            }
            showToast(message);
        } else {
            showToast(data.detail || '拉取失败', 'error');
        }
    } catch (error) {
        console.error('拉取模型失败:', error);
        showToast('连接失败', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 拉取';
}

function toggleAllModels() {
    const checked = document.getElementById('select-all-models').checked;
    document.querySelectorAll('.model-checkbox').forEach(cb => {
        cb.checked = checked;
    });
}

async function addSelectedModels() {
    const selected = [];
    document.querySelectorAll('.model-checkbox:checked').forEach(cb => {
        selected.push(cb.dataset.name);
    });

    if (selected.length === 0) {
        showToast('请选择要添加的模型', 'error');
        return;
    }

    const existingModels = models.filter(m => m.endpoint_id === currentEndpointId);
    const existingNames = new Set(existingModels.map(m => m.model_name));
    const newModels = selected.filter(name => !existingNames.has(name));
    const alreadyAdded = selected.filter(name => existingNames.has(name));

    if (newModels.length === 0) {
        showToast('所选模型均已添加', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/endpoints/${currentEndpointId}/models/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newModels)
        });

        if (response.ok) {
            const data = await response.json();
            await loadModels();
            await loadSavedModels(currentEndpointId);
            document.querySelectorAll('.model-checkbox').forEach(cb => {
                if (newModels.includes(cb.dataset.name)) {
                    cb.checked = true;
                }
            });
            let message = `已添加 ${data.added} 个模型`;
            if (alreadyAdded.length > 0) {
                message += `，${alreadyAdded.length} 个已存在`;
            }
            showToast(message);
        } else {
            const error = await response.json();
            showToast(error.detail || '添加失败', 'error');
        }
    } catch (error) {
        console.error('添加模型失败:', error);
        showToast('添加失败', 'error');
    }
}

async function deleteModel(id) {
    if (!confirm('确定删除此模型？')) return;

    try {
        const response = await fetch(`/api/models/${id}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('模型已删除');
            await loadModels();
            await loadSavedModels(currentEndpointId);
        }
    } catch (error) {
        console.error('删除模型失败:', error);
        showToast('删除失败', 'error');
    }
}

async function loadEndpointModels() {
    const endpointId = document.getElementById('tool-endpoint').value;
    const modelSelect = document.getElementById('tool-model');

    if (!endpointId) {
        modelSelect.innerHTML = '<option value="">-- 请先选择端点 --</option>';
        return;
    }

    const endpointModels = models.filter(m => m.endpoint_id === parseInt(endpointId));

    if (endpointModels.length === 0) {
        modelSelect.innerHTML = '<option value="">-- 该端点暂无模型 --</option>';
        return;
    }

    modelSelect.innerHTML = endpointModels.map(m =>
        `<option value="${m.id}">${escapeHtml(m.display_name || m.model_name)}</option>`
    ).join('');
}

// ========== 工具管理 ==========

async function loadTools() {
    try {
        const response = await fetch('/api/tools');
        const tools = await response.json();
        renderToolList(tools);
    } catch (error) {
        console.error('加载工具失败:', error);
    }
}

function renderToolList(tools) {
    const list = document.getElementById('tool-list');
    if (tools.length === 0) {
        list.innerHTML = '<div class="empty-item">暂无工具</div>';
        return;
    }
    list.innerHTML = tools.map(tool => {
        const model = models.find(m => m.id === tool.model_id);
        const modelName = model ? (model.display_name || model.model_name) : '未知模型';
        const endpointName = model ? (endpoints.find(ep => ep.id === model.endpoint_id)?.name || '') : '';
        const tooltipInfo = `模型: ${modelName}\n端点: ${endpointName}\n类型: ${tool.tool_type}`;
        return `
            <div class="sidebar-item ${currentTool?.id === tool.id ? 'active' : ''}"
                 onclick="selectTool(${tool.id})"
                 title="${tooltipInfo}">
                <div class="item-left">
                    <div class="item-icon">${getToolIconSVG(tool.tool_type)}</div>
                    <span class="item-name">${escapeHtml(tool.name)}</span>
                </div>
                <div class="item-right">
                    <span class="badge-mini badge-${tool.tool_type}">${tool.tool_type}</span>
                    <button class="item-btn" onclick="showToolModal(${tool.id}, event)" title="编辑">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="item-btn danger" onclick="deleteTool(${tool.id}, event)" title="删除">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getToolIconSVG(type) {
    const icons = {
        chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        thinking: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
        ocr: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        asr: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>'
    };
    return icons[type] || '';
}

function showToolModal(id = null, event = null) {
    if (event) {
        event.stopPropagation();
    }
    const modal = new bootstrap.Modal(document.getElementById('toolModal'));
    document.getElementById('toolModalTitle').innerHTML = id
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> 编辑工具'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> 创建工具';
    document.getElementById('tool-id').value = id || '';
    document.getElementById('tool-form').reset();

    document.querySelector('input[name="tool-type-radio"][value="chat"]').checked = true;
    updateToolPromptTemplate('chat');

    if (id) {
        fetch(`/api/tools/${id}`)
            .then(r => r.json())
            .then(tool => {
                document.getElementById('tool-name').value = tool.name;
                document.querySelector(`input[name="tool-type-radio"][value="${tool.tool_type}"]`).checked = true;
                updateToolPromptTemplate(tool.tool_type);
                document.getElementById('tool-prompt').value = tool.system_prompt || '';
                document.getElementById('tool-description').value = tool.description || '';

                const model = models.find(m => m.id === tool.model_id);
                if (model) {
                    document.getElementById('tool-endpoint').value = model.endpoint_id;
                    loadEndpointModels().then(() => {
                        document.getElementById('tool-model').value = tool.model_id;
                    });
                }
            });
    }

    modal.show();
}

function updateToolPromptTemplate(type) {
    const prompts = {
        chat: '你是一个有帮助的助手，请根据用户的问题提供准确、有用的回答。',
        thinking: '请仔细思考这个问题，逐步分析并给出详细的推理过程和结论。',
        ocr: '请识别图片中的内容，提取所有文字信息，并按原始格式整理输出。',
        asr: '请识别音频中的语音内容，转换为文字输出。'
    };
    document.getElementById('tool-prompt').value = prompts[type] || '';
}

async function saveTool() {
    const id = document.getElementById('tool-id').value;
    const modelId = document.getElementById('tool-model').value;

    if (!modelId) {
        showToast('请选择模型', 'error');
        return;
    }

    const data = {
        name: document.getElementById('tool-name').value,
        tool_type: document.querySelector('input[name="tool-type-radio"]:checked').value,
        model_id: parseInt(modelId),
        system_prompt: document.getElementById('tool-prompt').value,
        description: document.getElementById('tool-description').value
    };

    try {
        const url = id ? `/api/tools/${id}` : '/api/tools';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('toolModal')).hide();
            showToast('工具保存成功');
            await loadTools();
        } else {
            const error = await response.json();
            showToast(error.detail || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存工具失败:', error);
        showToast('保存失败', 'error');
    }
}

function editCurrentTool() {
    if (currentTool && currentTool.id) {
        showToolModal(currentTool.id);
    }
}

async function deleteTool(id, event) {
    event.stopPropagation();
    if (!confirm('确定删除此工具？')) return;

    try {
        const response = await fetch(`/api/tools/${id}`, { method: 'DELETE' });
        if (response.ok) {
            if (currentTool?.id === id) {
                currentTool = null;
                resetChatUI();
            }
            showToast('工具已删除');
            await loadTools();
        }
    } catch (error) {
        console.error('删除工具失败:', error);
        showToast('删除失败', 'error');
    }
}

async function selectTool(id) {
    try {
        const response = await fetch(`/api/tools/${id}`);
        const tool = await response.json();

        // 停止当前正在进行的操作
        if (isStreaming && currentAbortController) currentAbortController.abort();
        if (isASRProcessing && asrAbortController) asrAbortController.abort();
        if (isOCRProcessing && ocrAbortController) ocrAbortController.abort();

        currentTool = tool;
        currentConversationId = null;
        asrPendingFiles = [];
        asrResults = [];
        ocrPendingFiles = [];
        ocrResults = [];
        isStreaming = false;
        isASRProcessing = false;
        isOCRProcessing = false;
        currentStreamReader = null;

        renderToolList(await (await fetch('/api/tools')).json());

        document.getElementById('tool-header').style.display = 'flex';
        document.getElementById('current-tool-name').textContent = tool.name;
        document.getElementById('current-tool-type').textContent = tool.tool_type;
        document.getElementById('current-tool-type').className = `tool-type-badge ${tool.tool_type}`;

        if (tool.tool_type === 'asr') {
            document.getElementById('chat-input-area').style.display = 'none';
            document.getElementById('ocr-upload-area').style.display = 'none';
            document.getElementById('asr-upload-area').style.display = 'block';
            updateASRFileList();
        } else if (tool.tool_type === 'ocr') {
            document.getElementById('chat-input-area').style.display = 'none';
            document.getElementById('asr-upload-area').style.display = 'none';
            document.getElementById('ocr-upload-area').style.display = 'block';
            updateOCRFileList();
        } else {
            document.getElementById('asr-upload-area').style.display = 'none';
            document.getElementById('ocr-upload-area').style.display = 'none';
            document.getElementById('chat-input-area').style.display = 'block';
            document.getElementById('chat-input').disabled = false;
            document.getElementById('image-upload-area').style.display = 'none';
            updateSendButtonState();
        }

        clearChat();
        await loadConversations(id);
    } catch (error) {
        console.error('选择工具失败:', error);
    }
}

function resetChatUI() {
    document.getElementById('tool-header').style.display = 'none';
    document.getElementById('chat-input-area').style.display = 'none';
    document.getElementById('asr-upload-area').style.display = 'none';
    document.getElementById('ocr-upload-area').style.display = 'none';
    document.getElementById('chat-messages').innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-grid">
                <div class="welcome-card" onclick="showToolModal()">
                    <div class="card-icon icon-chat">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <span class="card-label">创建工具</span>
                </div>
                <div class="welcome-card" onclick="showEndpointModal()">
                    <div class="card-icon icon-endpoint">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                    </div>
                    <span class="card-label">添加端点</span>
                </div>
            </div>
            <div class="welcome-text">
                <h1>LLM工具箱</h1>
                <p>配置端点，创建工具，开始对话</p>
            </div>
        </div>
    `;
}

// ========== 对话管理 ==========

async function loadConversations(toolId) {
    try {
        const response = await fetch(`/api/conversations?tool_id=${toolId}`);
        const conversations = await response.json();
        renderConversationList(conversations);
    } catch (error) {
        console.error('加载对话失败:', error);
    }
}

function renderConversationList(conversations) {
    const list = document.getElementById('conversation-list');
    if (conversations.length === 0) {
        list.innerHTML = '<div class="empty-item">暂无对话</div>';
        return;
    }
    list.innerHTML = conversations.map(conv => `
        <div class="sidebar-item ${currentConversationId === conv.id ? 'active' : ''}" onclick="loadConversation(${conv.id})" title="${escapeHtml(conv.title || '对话')}">
            <div class="item-left">
                <div class="item-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <span class="item-name">${escapeHtml(conv.title || '对话')}</span>
            </div>
            <div class="item-right">
                <button class="item-btn danger" onclick="deleteConversation(${conv.id}, event)" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

async function loadConversation(id) {
    try {
        const response = await fetch(`/api/conversations/${id}`);
        const conv = await response.json();
        currentConversationId = id;

        const messagesDiv = document.getElementById('chat-messages');
        messagesDiv.innerHTML = '';
        conv.messages.forEach(msg => appendMessage(msg.role, msg.content, false, null));

        renderConversationList(await (await fetch(`/api/conversations?tool_id=${currentTool.id}`)).json());
    } catch (error) {
        console.error('加载对话失败:', error);
    }
}

async function deleteConversation(id, event) {
    event.stopPropagation();
    if (!confirm('确定删除此对话？')) return;

    try {
        const response = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (response.ok) {
            if (currentConversationId === id) {
                currentConversationId = null;
                clearChat();
            }
            showToast('对话已删除');
            await loadConversations(currentTool?.id);
        }
    } catch (error) {
        console.error('删除对话失败:', error);
        showToast('删除失败', 'error');
    }
}

function clearChat() {
    currentConversationId = null;
    asrResults = [];
    ocrResults = [];
    isASRProcessing = false;
    isOCRProcessing = false;
    if (asrAbortController) asrAbortController.abort();
    if (ocrAbortController) ocrAbortController.abort();
    asrPendingFiles = [];
    ocrPendingFiles = [];
    document.getElementById('chat-messages').innerHTML = '';
    removeImage();
    // Reset progress areas
    const asrProgress = document.getElementById('asr-progress-area');
    if (asrProgress) asrProgress.style.display = 'none';
    const ocrProgress = document.getElementById('ocr-progress-area');
    if (ocrProgress) ocrProgress.style.display = 'none';
    updateASRFileList();
    updateOCRFileList();
}

// ========== 图片处理 ==========

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = document.getElementById('image-preview');
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('d-none');
    document.getElementById('remove-image-btn').classList.remove('d-none');

    const reader = new FileReader();
    reader.onload = (e) => { uploadedImageUrl = e.target.result; };
    reader.readAsDataURL(file);
}

function removeImage() {
    uploadedImageUrl = null;
    document.getElementById('image-preview').classList.add('d-none');
    document.getElementById('remove-image-btn').classList.add('d-none');
    document.getElementById('image-input').value = '';
}

// ========== ASR文件处理 ==========

function handleASRFileSelect(event) {
    addASRFiles(event.target.files);
    event.target.value = '';
}

function addASRFiles(files) {
    const supportedFormats = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm', '.aac', '.opus'];

    for (const file of files) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!supportedFormats.includes(ext)) {
            showToast(`不支持的格式: ${file.name}`, 'error');
            continue;
        }
        if (asrPendingFiles.some(f => f.name === file.name && f.size === file.size)) {
            showToast(`文件已存在: ${file.name}`, 'error');
            continue;
        }
        asrPendingFiles.push({
            file, name: file.name, size: file.size,
            status: 'pending', path: null, result: null
        });
    }
    updateASRFileList();
}

function updateASRFileList() {
    const listContainer = document.getElementById('asr-pending-info');
    const fileCountBadge = document.getElementById('asr-file-count');

    if (asrPendingFiles.length === 0) {
        listContainer.style.display = 'none';
        updateASRButtonState();
        return;
    }

    listContainer.style.display = 'flex';
    const pendingCount = asrPendingFiles.filter(f => f.status === 'pending').length;
    fileCountBadge.textContent = pendingCount;
    updateASRButtonState();
}

function removePendingFile(idx) {
    asrPendingFiles.splice(idx, 1);
    updateASRFileList();
}

function clearPendingFiles() {
    asrPendingFiles = [];
    updateASRFileList();
}

// ========== ASR批量处理 ==========

async function startASRBatch() {
    if (!currentTool || isASRProcessing) return;

    const pendingFiles = asrPendingFiles.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) {
        showToast('没有待处理的文件', 'error');
        return;
    }

    isASRProcessing = true;
    asrAbortController = new AbortController();
    asrResults = [];

    const progressArea = document.getElementById('asr-progress-area');
    const progressBar = document.getElementById('asr-progress-bar');
    const progressText = document.getElementById('asr-progress-text');

    progressArea.style.display = 'flex';
    updateASRButtonState();

    const messagesDiv = document.getElementById('chat-messages');
    const welcome = messagesDiv.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    let processedCount = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
        if (!isASRProcessing) {
            progressText.textContent = '已停止';
            break;
        }

        const file = pendingFiles[i];

        progressBar.style.width = `${((i) / pendingFiles.length) * 100}%`;
        progressText.textContent = `${i + 1}/${pendingFiles.length}`;

        file.status = 'uploading';
        updateASRFileList();

        try {
            const formData = new FormData();
            formData.append('file', file.file);

            const uploadResponse = await fetch('/api/audio/upload', {
                method: 'POST',
                body: formData,
                signal: asrAbortController.signal
            });
            const uploadData = await uploadResponse.json();
            if (!uploadResponse.ok) throw new Error(uploadData.detail || '上传失败');

            file.path = uploadData.path;
            file.status = 'processing';
            updateASRFileList();

            const transcribeResponse = await fetch('/api/audio/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool_id: currentTool.id,
                    conversation_id: null,
                    message: '',
                    audio_url: file.path
                }),
                signal: asrAbortController.signal
            });
            const transcribeData = await transcribeResponse.json();
            if (!transcribeResponse.ok) throw new Error(transcribeData.detail || '转录失败');

            file.status = 'done';
            file.result = transcribeData.text;
            asrResults.push({ filename: file.name, text: transcribeData.text });
            appendASRResult(file.name, transcribeData.text);
            processedCount++;

        } catch (error) {
            if (error.name === 'AbortError') {
                file.status = 'pending';
                progressText.textContent = '已停止';
                break;
            }
            console.error(`处理 ${file.name} 失败:`, error);
            file.status = 'error';
            file.result = error.message;
            appendMessage('assistant', `**${file.name}** 处理失败: ${error.message}`, false, null);
        }

        updateASRFileList();
    }

    progressBar.style.width = '100%';
    if (isASRProcessing) {
        progressText.textContent = '已完成';
    }

    setTimeout(() => { progressArea.style.display = 'none'; }, 2000);

    isASRProcessing = false;
    asrAbortController = null;
    updateASRButtonState();
    updateASRFileList();

    if (asrResults.length > 0) {
        showToast(`完成 ${asrResults.length}/${pendingFiles.length} 个文件`);
    }
}

function stopASRBatch() {
    if (!isASRProcessing) return;

    isASRProcessing = false;
    if (asrAbortController) {
        asrAbortController.abort();
    }
    showToast('已停止处理');
}

function updateASRButtonState() {
    const startBtn = document.getElementById('asr-start-btn');
    const stopBtn = document.getElementById('asr-stop-btn');

    if (isASRProcessing) {
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
    } else {
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        startBtn.disabled = asrPendingFiles.filter(f => f.status === 'pending').length === 0;
    }
}

// ========== OCR文件处理 ==========

function handleOCRFileSelect(event) {
    addOCRFiles(event.target.files);
    event.target.value = '';
}

function addOCRFiles(files) {
    const supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

    for (const file of files) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!supportedFormats.includes(ext)) {
            showToast(`不支持的格式: ${file.name}`, 'error');
            continue;
        }
        if (ocrPendingFiles.some(f => f.name === file.name && f.size === file.size)) {
            showToast(`文件已存在: ${file.name}`, 'error');
            continue;
        }
        ocrPendingFiles.push({
            file, name: file.name, size: file.size,
            status: 'pending', result: null
        });
    }
    updateOCRFileList();
}

function updateOCRFileList() {
    const listContainer = document.getElementById('ocr-pending-info');
    const fileCountBadge = document.getElementById('ocr-file-count');

    if (ocrPendingFiles.length === 0) {
        listContainer.style.display = 'none';
        updateOCRButtonState();
        return;
    }

    listContainer.style.display = 'flex';
    const pendingCount = ocrPendingFiles.filter(f => f.status === 'pending').length;
    fileCountBadge.textContent = pendingCount;
    updateOCRButtonState();
}

function removeOCRFile(idx) {
    ocrPendingFiles.splice(idx, 1);
    updateOCRFileList();
}

function clearOCRFiles() {
    ocrPendingFiles = [];
    updateOCRFileList();
}

// ========== OCR批量处理 ==========

async function startOCRBatch() {
    if (!currentTool || isOCRProcessing) return;

    const pendingFiles = ocrPendingFiles.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) {
        showToast('没有待处理的文件', 'error');
        return;
    }

    isOCRProcessing = true;
    ocrAbortController = new AbortController();
    ocrResults = [];

    const progressArea = document.getElementById('ocr-progress-area');
    const progressBar = document.getElementById('ocr-progress-bar');
    const progressText = document.getElementById('ocr-progress-text');

    progressArea.style.display = 'flex';
    updateOCRButtonState();

    const messagesDiv = document.getElementById('chat-messages');
    const welcome = messagesDiv.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    let processedCount = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
        if (!isOCRProcessing) {
            progressText.textContent = '已停止';
            break;
        }

        const file = pendingFiles[i];

        progressBar.style.width = `${((i) / pendingFiles.length) * 100}%`;
        progressText.textContent = `${i + 1}/${pendingFiles.length}`;

        file.status = 'processing';
        updateOCRFileList();

        try {
            const imageData = await readFileAsBase64(file.file);

            const assistantDiv = appendOCRResult(file.name, '', true);
            let content = '';

            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool_id: currentTool.id,
                    conversation_id: null,
                    message: '请识别图片中的内容',
                    image_url: imageData
                }),
                signal: ocrAbortController.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let ocrBuffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                ocrBuffer += decoder.decode(value, { stream: true });
                const lines = ocrBuffer.split('\n');
                ocrBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(trimmed.substring(6));
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            if (data.content) {
                                content += data.content;
                                assistantDiv.querySelector('.message-content').innerHTML =
                                    formatMarkdown(content) + '<span class="typing-indicator">\u258B</span>';
                                scrollToBottom();
                            }
                            if (data.done) {
                                assistantDiv.querySelector('.message-content').innerHTML = formatMarkdown(content);
                            }
                        } catch (e) {
                            if (e.message && !e.name) {
                                throw e; // 重新抛出业务错误
                            }
                            // 忽略解析错误
                        }
                    }
                }
            }

            file.status = 'done';
            file.result = content;
            ocrResults.push({ filename: file.name, text: content });
            updateOCRResultActions(assistantDiv, file.name, content);
            processedCount++;

        } catch (error) {
            if (error.name === 'AbortError') {
                file.status = 'pending';
                progressText.textContent = '已停止';
                break;
            }
            console.error(`处理 ${file.name} 失败:`, error);
            file.status = 'error';
            file.result = error.message;
            appendMessage('assistant', `**${file.name}** 处理失败: ${error.message}`, false, null);
        }

        updateOCRFileList();
    }

    progressBar.style.width = '100%';
    if (isOCRProcessing) {
        progressText.textContent = '已完成';
    }

    setTimeout(() => { progressArea.style.display = 'none'; }, 2000);

    isOCRProcessing = false;
    ocrAbortController = null;
    updateOCRButtonState();
    updateOCRFileList();

    if (ocrResults.length > 0) {
        showToast(`完成 ${ocrResults.length}/${pendingFiles.length} 个文件`);
    }
}

function stopOCRBatch() {
    if (!isOCRProcessing) return;

    isOCRProcessing = false;
    if (ocrAbortController) {
        ocrAbortController.abort();
    }
    showToast('已停止处理');
}

function updateOCRButtonState() {
    const startBtn = document.getElementById('ocr-start-btn');
    const stopBtn = document.getElementById('ocr-stop-btn');

    if (isOCRProcessing) {
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
    } else {
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        startBtn.disabled = ocrPendingFiles.filter(f => f.status === 'pending').length === 0;
    }
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ========== 消息显示 ==========

function appendASRResult(filename, text) {
    const messagesDiv = document.getElementById('chat-messages');
    const resultId = generateId('asr-result');

    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="message-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></div>
        <div class="message-content-wrapper">
            <div class="message-title">${escapeHtml(filename)}</div>
            <div class="message-content">${formatMarkdown(text)}</div>
            <div class="message-actions">
                <button class="btn" onclick="copyText('${resultId}')">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    复制
                </button>
            </div>
        </div>
    `;
    const textarea = document.createElement('textarea');
    textarea.id = resultId;
    textarea.className = 'd-none';
    textarea.value = text;
    div.querySelector('.message-content-wrapper').appendChild(textarea);
    messagesDiv.appendChild(div);
    scrollToBottom();
}

function appendOCRResult(filename, text, isStreaming = false) {
    const messagesDiv = document.getElementById('chat-messages');
    const resultId = generateId('ocr-result');

    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = resultId + '-wrapper';
    div.innerHTML = `
        <div class="message-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div class="message-content-wrapper">
            <div class="message-title">${escapeHtml(filename)}</div>
            <div class="message-content">${isStreaming ? '' : formatMarkdown(text)}${isStreaming ? '<span class="typing-indicator">\u258B</span>' : ''}</div>
            <div class="message-actions" style="display: ${isStreaming ? 'none' : 'flex'};">
                <button class="btn" onclick="copyOCRText('${resultId}')">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    复制
                </button>
            </div>
        </div>
    `;
    const textarea = document.createElement('textarea');
    textarea.id = resultId;
    textarea.className = 'd-none';
    textarea.value = text;
    div.querySelector('.message-content-wrapper').appendChild(textarea);
    messagesDiv.appendChild(div);
    scrollToBottom();
    return div;
}

function updateOCRResultActions(div, filename, text) {
    const actionsDiv = div.querySelector('.message-actions');
    const textarea = div.querySelector('textarea');
    if (!textarea) return;

    textarea.value = text;

    actionsDiv.style.display = 'flex';
    actionsDiv.innerHTML = `
        <button class="btn" onclick="copyOCRText('${textarea.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制
        </button>
    `;
}

function copyOCRText(elementId) {
    const textarea = document.getElementById(elementId);
    if (!textarea) return;
    navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
    });
}

function appendMessage(role, content, isStreaming = false, title = null) {
    const messagesDiv = document.getElementById('chat-messages');
    const welcome = messagesDiv.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `message ${role}`;
    const titleHtml = title ? `<div class="message-title">${title}</div>` : '';

    const avatarSVG = role === 'user'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M8 16h.01"/><path d="M12 16h.01"/><path d="M16 16h.01"/></svg>';

    div.innerHTML = `
        <div class="message-avatar">${avatarSVG}</div>
        <div class="message-content-wrapper">
            ${titleHtml}
            <div class="message-content">${formatMarkdown(content)}${isStreaming ? '<span class="typing-indicator">\u258B</span>' : ''}</div>
        </div>
    `;
    messagesDiv.appendChild(div);
    scrollToBottom();
    return div;
}

function scrollToBottom() {
    const container = document.getElementById('chat-container');
    container.scrollTop = container.scrollHeight;
}

// ========== 导出和复制 ==========

function copyText(elementId) {
    const textarea = document.getElementById(elementId);
    if (!textarea) return;
    navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
    });
}

// ========== 工具函数 ==========

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    if (!text) return '';
    // 先转义HTML防止XSS
    text = escapeHtml(text);
    // 代码块（在转义后的文本上匹配）
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    // 行内代码
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 粗体和斜体
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 段落（只处理不在pre标签内的换行）
    text = text.replace(/((?:(?!<\/?pre>).)+)\n\n/g, '$1</p><p>');
    text = '<p>' + text + '</p>';
    return text;
}

// ========== 发送消息 ==========

async function sendMessage() {
    if (!currentTool || isStreaming || currentTool.tool_type === 'asr') return;

    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message && !uploadedImageUrl) return;

    appendMessage('user', message);
    input.value = '';
    input.style.height = 'auto';

    currentAssistantDiv = appendMessage('assistant', '', true);
    currentContent = '';

    isStreaming = true;
    updateSendButtonState();

    currentAbortController = new AbortController();

    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tool_id: currentTool.id,
                conversation_id: currentConversationId,
                message: message,
                image_url: currentTool.tool_type === 'ocr' ? uploadedImageUrl : null
            }),
            signal: currentAbortController.signal
        });

        currentStreamReader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await currentStreamReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // 保留最后一个不完整的行
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(trimmed.substring(6));
                        if (data.error) {
                            throw new Error(data.error);
                        }
                        if (data.content) {
                            currentContent += data.content;
                            currentAssistantDiv.querySelector('.message-content').innerHTML =
                                formatMarkdown(currentContent) + '<span class="typing-indicator">\u258B</span>';
                            scrollToBottom();
                        }
                        if (data.done) {
                            currentConversationId = data.conversation_id;
                            currentAssistantDiv.querySelector('.message-content').innerHTML = formatMarkdown(currentContent);
                            await loadConversations(currentTool.id);
                        }
                    } catch (e) {
                        if (e.name === 'SyntaxError') continue; // 解析错误，忽略
                        throw e; // 业务错误，向上抛出
                    }
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            currentAssistantDiv.querySelector('.message-content').innerHTML =
                formatMarkdown(currentContent) + '<div style="color:var(--text-muted);font-size:11px;margin-top:6px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-1px;margin-right:4px;"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>已停止</div>';
            showToast('已停止生成');
        } else {
            console.error('发送消息失败:', error);
            currentAssistantDiv.querySelector('.message-content').innerHTML =
                `<span style="color:var(--red)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${currentContent ? '错误: ' + escapeHtml(error.message) : '连接失败'}</span>`;
        }
    }

    isStreaming = false;
    currentAbortController = null;
    currentStreamReader = null;
    updateSendButtonState();
    removeImage();
}

function stopGeneration() {
    if (!isStreaming) return;

    if (currentAbortController) {
        currentAbortController.abort();
    }
    if (currentStreamReader) {
        currentStreamReader.cancel();
    }
}

function updateSendButtonState() {
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');

    if (isStreaming) {
        sendBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        stopBtn.disabled = false;
    } else {
        sendBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        sendBtn.disabled = !currentTool || currentTool.tool_type === 'asr';
    }
}
