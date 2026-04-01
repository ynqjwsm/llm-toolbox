// LLM工具箱前端交互逻辑

// 状态管理
let currentTool = null;
let currentConversationId = null;
let isStreaming = false;
let uploadedImageUrl = null;
let endpoints = [];
let models = [];

// ASR专用状态
let asrPendingFiles = [];
let asrResults = [];
let isASRProcessing = false;

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

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    const msg = document.getElementById('toast-message');

    toast.className = `toast border-0 shadow toast-${type}`;
    icon.className = type === 'success' ? 'bi bi-check-circle-fill text-success' : 'bi bi-exclamation-circle-fill text-danger';
    msg.textContent = message;

    bootstrap.Toast.getOrCreateInstance(toast).show();
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
        list.innerHTML = '<div class="text-muted small text-center py-2">暂无端点</div>';
        return;
    }
    list.innerHTML = endpoints.map(ep => `
        <div class="list-group-item d-flex justify-content-between align-items-center" onclick="showEndpointModal(${ep.id})">
            <div>
                <i class="bi bi-hdd-stack me-1 text-secondary"></i>
                <span>${ep.name}</span>
            </div>
            <div class="d-flex align-items-center gap-1">
                <span class="badge bg-secondary">${ep.model_count} 模型</span>
                <button class="btn btn-sm btn-link text-danger delete-btn" onclick="deleteEndpoint(${ep.id}, event)">
                    <i class="bi bi-trash"></i>
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
        endpoints.map(ep => `<option value="${ep.id}">${ep.name}</option>`).join('');
}

function showEndpointModal(id = null) {
    const modal = new bootstrap.Modal(document.getElementById('endpointModal'));
    document.getElementById('endpointModalTitle').innerHTML = id
        ? '<i class="bi bi-hdd-stack me-2 text-primary"></i>编辑端点'
        : '<i class="bi bi-hdd-stack me-2 text-primary"></i>添加端点';

    currentEndpointId = id;
    document.getElementById('endpoint-form').reset();
    document.getElementById('fetch-models-btn').disabled = true;
    document.getElementById('model-empty-hint').style.display = 'block';
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

    try {
        let testUrl = endpointType === 'ollama'
            ? `${apiUrl.replace(/\/$/, '')}/api/tags`
            : `${apiUrl.replace(/\/$/, '')}/v1/models`;

        const headers = { 'Content-Type': 'application/json' };
        if (endpointType === 'openai' && apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(testUrl, { headers });
        if (response.ok) {
            showToast('连接成功');
        } else {
            showToast(`连接失败: ${response.status}`, 'error');
        }
    } catch (error) {
        showToast('连接失败', 'error');
    }
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
                <div class="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                        <i class="bi bi-cpu me-1 text-secondary"></i>
                        <span>${m.display_name || m.model_name}</span>
                        ${m.display_name ? `<small class="text-muted ms-1">(${m.model_name})</small>` : ''}
                    </div>
                    <button class="btn btn-sm btn-link text-danger" onclick="deleteModel(${m.id})">
                        <i class="bi bi-trash"></i>
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
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>拉取中...';

    try {
        const response = await fetch(`/api/endpoints/${currentEndpointId}/fetch-models`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok) {
            fetchedModels = data.models;
            document.getElementById('model-empty-hint').style.display = 'none';
            document.getElementById('fetched-models-list').style.display = 'block';

            if (fetchedModels.length === 0) {
                document.getElementById('fetched-models-list').innerHTML =
                    '<div class="text-center text-muted py-3">未找到可用模型</div>';
            } else {
                document.getElementById('fetched-models-list').innerHTML = `
                    <div class="p-2 bg-light rounded mb-2">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="select-all-models" onchange="toggleAllModels()">
                            <label class="form-check-label small" for="select-all-models">全选 (${fetchedModels.length} 个模型)</label>
                        </div>
                    </div>
                    <div class="model-checkbox-list" style="max-height: 200px; overflow-y: auto;">
                        ${fetchedModels.map(m => `
                            <div class="list-group-item border-0">
                                <div class="form-check">
                                    <input class="form-check-input model-checkbox" type="checkbox" value="${m.id}" data-name="${m.name}" id="model-${m.id}">
                                    <label class="form-check-label" for="model-${m.id}">${m.name}</label>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="p-2 border-top">
                        <button class="btn btn-primary btn-sm w-100" onclick="addSelectedModels()">
                            <i class="bi bi-plus-lg me-1"></i>添加选中模型
                        </button>
                    </div>
                `;
            }
            showToast(`获取到 ${fetchedModels.length} 个模型`);
        } else {
            showToast(data.detail || '拉取失败', 'error');
        }
    } catch (error) {
        console.error('拉取模型失败:', error);
        showToast('连接失败', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-download me-1"></i>拉取模型列表';
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

    try {
        const response = await fetch(`/api/endpoints/${currentEndpointId}/models/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selected)
        });

        if (response.ok) {
            const data = await response.json();
            showToast(`已添加 ${data.added} 个模型`);
            await loadModels();
            await loadSavedModels(currentEndpointId);
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
        `<option value="${m.id}">${m.display_name || m.model_name}</option>`
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
        list.innerHTML = '<div class="text-muted small text-center py-2">暂无工具</div>';
        return;
    }
    list.innerHTML = tools.map(tool => {
        const model = models.find(m => m.id === tool.model_id);
        const modelName = model ? (model.display_name || model.model_name) : '未知模型';
        const endpointName = model ? (endpoints.find(ep => ep.id === model.endpoint_id)?.name || '') : '';
        const tooltipInfo = `模型: ${modelName}\n端点: ${endpointName}\n类型: ${tool.tool_type}`;
        return `
            <div class="list-group-item ${currentTool?.id === tool.id ? 'active' : ''}"
                 onclick="selectTool(${tool.id})"
                 title="${tooltipInfo}">
                <div>
                    <i class="bi bi-${getToolIcon(tool.tool_type)} me-1"></i>
                    <span>${tool.name}</span>
                </div>
                <div class="d-flex align-items-center gap-1">
                    <span class="badge ${tool.tool_type}">${tool.tool_type}</span>
                    <button class="btn btn-sm btn-link edit-btn ${currentTool?.id === tool.id ? 'text-white' : 'text-secondary'}" onclick="showToolModal(${tool.id}, event)" title="编辑">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-link delete-btn ${currentTool?.id === tool.id ? 'text-white' : 'text-danger'}" onclick="deleteTool(${tool.id}, event)" title="删除">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getToolIcon(type) {
    const icons = { chat: 'chat-dots', thinking: 'lightbulb', ocr: 'eye', asr: 'mic' };
    return icons[type] || 'app';
}

function showToolModal(id = null, event = null) {
    if (event) {
        event.stopPropagation();
    }
    const modal = new bootstrap.Modal(document.getElementById('toolModal'));
    document.getElementById('toolModalTitle').innerHTML = id
        ? '<i class="bi bi-app-indicator me-2 text-primary"></i>编辑工具'
        : '<i class="bi bi-app-indicator me-2 text-primary"></i>创建工具';
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

                // 设置端点和模型
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
        currentTool = tool;
        currentConversationId = null;
        asrPendingFiles = [];
        asrResults = [];

        renderToolList(await (await fetch('/api/tools')).json());

        document.getElementById('tool-header').style.display = 'flex';
        document.getElementById('current-tool-name').textContent = tool.name;
        document.getElementById('current-tool-type').textContent = tool.tool_type;
        document.getElementById('current-tool-type').className = `badge ${tool.tool_type}`;

        if (tool.tool_type === 'asr') {
            document.getElementById('chat-input-area').style.display = 'none';
            document.getElementById('asr-upload-area').style.display = 'block';
            updateASRFileList();
        } else {
            document.getElementById('asr-upload-area').style.display = 'none';
            document.getElementById('chat-input-area').style.display = 'block';
            document.getElementById('chat-input').disabled = false;
            document.getElementById('send-btn').disabled = false;
            document.getElementById('image-upload-area').style.display = tool.tool_type === 'ocr' ? 'block' : 'none';
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
    document.getElementById('chat-messages').innerHTML = `
        <div class="welcome-card text-center py-5">
            <div class="mb-4"><i class="bi bi-robot display-1 text-primary opacity-25"></i></div>
            <h4 class="text-muted mb-3">欢迎使用LLM工具箱</h4>
            <p class="text-muted mb-4">选择左侧工具开始对话，或配置端点和模型</p>
            <div class="row g-3 justify-content-center">
                <div class="col-auto">
                    <div class="card feature-card h-100 border-0 shadow-sm" onclick="showToolModal()">
                        <div class="card-body text-center p-3">
                            <i class="bi bi-plus-circle fs-3 text-primary mb-2"></i>
                            <p class="small text-muted mb-0">创建工具</p>
                        </div>
                    </div>
                </div>
                <div class="col-auto">
                    <div class="card feature-card h-100 border-0 shadow-sm" onclick="showEndpointModal()">
                        <div class="card-body text-center p-3">
                            <i class="bi bi-hdd-stack fs-3 text-secondary mb-2"></i>
                            <p class="small text-muted mb-0">添加端点</p>
                        </div>
                    </div>
                </div>
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
        list.innerHTML = '<div class="text-muted small text-center py-2">暂无对话</div>';
        return;
    }
    list.innerHTML = conversations.map(conv => `
        <div class="list-group-item ${currentConversationId === conv.id ? 'active' : ''}" onclick="loadConversation(${conv.id})">
            <div>
                <i class="bi bi-chat-text me-1 text-secondary"></i>
                <span class="small">${conv.title || '对话'}</span>
            </div>
            <button class="btn btn-sm btn-link text-danger delete-btn" onclick="deleteConversation(${conv.id}, event)">
                <i class="bi bi-trash"></i>
            </button>
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
    document.getElementById('chat-messages').innerHTML = '';
    removeImage();
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

function handleASRDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('asr-drop-zone').classList.add('drag-over');
}

function handleASRDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('asr-drop-zone').classList.remove('drag-over');
}

function handleASRDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('asr-drop-zone').classList.remove('drag-over');
    addASRFiles(event.dataTransfer.files);
}

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
    const listContainer = document.getElementById('asr-pending-list');
    const list = document.getElementById('asr-pending-files');
    const startBtn = document.getElementById('asr-start-btn');

    if (asrPendingFiles.length === 0) {
        listContainer.style.display = 'none';
        startBtn.disabled = true;
        return;
    }

    listContainer.style.display = 'block';
    startBtn.disabled = isASRProcessing || asrPendingFiles.every(f => f.status === 'done' || f.status === 'error');

    list.innerHTML = asrPendingFiles.map((f, idx) => `
        <div class="list-group-item">
            <div class="file-info">
                <i class="bi bi-file-earmark-music file-icon"></i>
                <div>
                    <div class="file-name" title="${f.name}">${f.name}</div>
                    <div class="file-size">${formatFileSize(f.size)}</div>
                </div>
            </div>
            <div class="file-status">
                ${getStatusBadge(f.status)}
                ${f.status === 'pending' ? `<button class="btn btn-sm btn-link text-danger" onclick="removePendingFile(${idx})"><i class="bi bi-x-lg"></i></button>` : ''}
            </div>
        </div>
    `).join('');
}

function getStatusBadge(status) {
    const badges = {
        pending: '<span class="badge bg-secondary">待处理</span>',
        uploading: '<span class="badge bg-info">上传中...</span>',
        processing: '<span class="badge bg-warning text-dark">识别中...</span>',
        done: '<span class="badge bg-success">完成</span>',
        error: '<span class="badge bg-danger">失败</span>'
    };
    return badges[status] || '';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
    asrResults = [];

    const progressArea = document.getElementById('asr-progress-area');
    const progressBar = document.getElementById('asr-progress-bar');
    const progressText = document.getElementById('asr-progress-text');
    const progressCount = document.getElementById('asr-progress-count');

    progressArea.style.display = 'block';
    document.getElementById('asr-start-btn').disabled = true;

    const messagesDiv = document.getElementById('chat-messages');
    const welcome = messagesDiv.querySelector('.welcome-card');
    if (welcome) welcome.remove();

    for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const fileIdx = asrPendingFiles.indexOf(file);

        progressText.textContent = `正在处理: ${file.name}`;
        progressCount.textContent = `${i + 1}/${pendingFiles.length}`;
        progressBar.style.width = `${((i) / pendingFiles.length) * 100}%`;

        file.status = 'uploading';
        updateASRFileList();

        try {
            const formData = new FormData();
            formData.append('file', file.file);

            const uploadResponse = await fetch('/api/audio/upload', { method: 'POST', body: formData });
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
                })
            });
            const transcribeData = await transcribeResponse.json();
            if (!transcribeResponse.ok) throw new Error(transcribeData.detail || '转录失败');

            file.status = 'done';
            file.result = transcribeData.text;
            asrResults.push({ filename: file.name, text: transcribeData.text });
            appendASRResult(file.name, transcribeData.text);

        } catch (error) {
            console.error(`处理 ${file.name} 失败:`, error);
            file.status = 'error';
            file.result = error.message;
            appendMessage('assistant', `❌ **${file.name}** 处理失败: ${error.message}`, false, null);
        }

        updateASRFileList();
    }

    progressBar.style.width = '100%';
    progressText.textContent = '处理完成';

    setTimeout(() => { progressArea.style.display = 'none'; }, 2000);

    isASRProcessing = false;
    updateASRFileList();

    if (asrResults.length > 0) {
        showToast(`完成 ${asrResults.length}/${pendingFiles.length} 个文件`);
    }
}

// ========== 消息显示 ==========

function appendASRResult(filename, text) {
    const messagesDiv = document.getElementById('chat-messages');
    const resultId = `asr-result-${Date.now()}`;

    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="message-avatar"><i class="bi bi-robot"></i></div>
        <div class="message-content-wrapper">
            <div class="message-title"><i class="bi bi-file-earmark-music me-1"></i>${filename}</div>
            <div class="message-content">${escapeHtml(text)}</div>
            <div class="message-actions btn-group" role="group">
                <button class="btn btn-outline-secondary" onclick="copyText('${resultId}')" title="复制文本">
                    <i class="bi bi-clipboard"></i> 复制
                </button>
                <div class="btn-group" role="group">
                    <button class="btn btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">
                        <i class="bi bi-download"></i> 导出
                    </button>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#" onclick="exportAs('${resultId}', '${escapeAttr(filename)}', 'txt')">
                            <i class="bi bi-filetype-txt me-1"></i>导出 TXT
                        </a></li>
                        <li><a class="dropdown-item" href="#" onclick="exportAs('${resultId}', '${escapeAttr(filename)}', 'docx')">
                            <i class="bi bi-filetype-docx me-1"></i>导出 DOC
                        </a></li>
                    </ul>
                </div>
            </div>
            <textarea id="${resultId}" class="d-none">${escapeAttr(text)}</textarea>
        </div>
    `;
    messagesDiv.appendChild(div);
    scrollToBottom();
}

function appendMessage(role, content, isStreaming = false, title = null) {
    const messagesDiv = document.getElementById('chat-messages');
    const welcome = messagesDiv.querySelector('.welcome-card');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `message ${role}`;
    const avatarIcon = role === 'user' ? 'bi-person-fill' : 'bi-robot';
    const titleHtml = title ? `<div class="message-title">${title}</div>` : '';

    div.innerHTML = `
        <div class="message-avatar"><i class="bi ${avatarIcon}"></i></div>
        <div class="message-content-wrapper">
            ${titleHtml}
            <div class="message-content">${formatMarkdown(content)}${isStreaming ? '<span class="typing-indicator">▋</span>' : ''}</div>
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

// ========== 导出和复制功能 ==========

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

function exportAs(elementId, filename, format) {
    const textarea = document.getElementById(elementId);
    if (!textarea) return;

    const text = textarea.value;
    const baseName = filename.replace(/\.[^/.]+$/, '');

    if (format === 'txt') {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, `${baseName}_转录.txt`);
        showToast('已导出 TXT 文件');
    } else if (format === 'docx') {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filename}</title></head>
            <body><p style="white-space: pre-wrap; font-family: 'Microsoft YaHei', sans-serif;">${escapeHtml(text)}</p></body></html>`;
        const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
        downloadBlob(blob, `${baseName}_转录.doc`);
        showToast('已导出 DOC 文件');
    }
    return false;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ========== 工具函数 ==========

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatMarkdown(text) {
    if (!text) return '';
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\n\n/g, '</p><p>');
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

    const assistantDiv = appendMessage('assistant', '', true);

    isStreaming = true;
    document.getElementById('send-btn').disabled = true;

    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tool_id: currentTool.id,
                conversation_id: currentConversationId,
                message: message,
                image_url: currentTool.tool_type === 'ocr' ? uploadedImageUrl : null
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let content = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.substring(6));
                    if (data.error) {
                        assistantDiv.querySelector('.message-content').innerHTML =
                            `<div class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>错误: ${data.error}</div>`;
                        break;
                    }
                    if (data.content) {
                        content += data.content;
                        assistantDiv.querySelector('.message-content').innerHTML =
                            formatMarkdown(content) + '<span class="typing-indicator">▋</span>';
                        scrollToBottom();
                    }
                    if (data.done) {
                        currentConversationId = data.conversation_id;
                        assistantDiv.querySelector('.message-content').innerHTML = formatMarkdown(content);
                        await loadConversations(currentTool.id);
                    }
                }
            }
        }
    } catch (error) {
        console.error('发送消息失败:', error);
        assistantDiv.querySelector('.message-content').innerHTML =
            `<div class="text-danger"><i class="bi bi-wifi-off me-1"></i>连接失败</div>`;
    }

    isStreaming = false;
    document.getElementById('send-btn').disabled = false;
    removeImage();
}