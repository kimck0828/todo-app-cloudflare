// State
let categories = [];
let tasks = [];
let currentCategoryId = null;
let currentUser = null;

// DOM Elements - Tasks View
const tasksView = document.getElementById('tasks-view');
const categoryTabsContainer = document.getElementById('category-tabs');
const taskCategorySelect = document.getElementById('task-category-select');
const taskListContainer = document.getElementById('task-list');
const addTaskForm = document.getElementById('add-task-form');
const btnShowCategories = document.getElementById('btn-show-categories');
const btnThemeToggle = document.getElementById('btn-theme-toggle');

// DOM Elements - Categories View
const categoriesView = document.getElementById('categories-view');
const categoryListContainer = document.getElementById('category-list');
const addCategoryForm = document.getElementById('add-category-form');
const btnBackToTasks = document.getElementById('btn-back-to-tasks');
const flashMessages = document.getElementById('flash-messages');

// DOM Elements - Auth & User Info
const loginOverlay = document.getElementById('login-overlay');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const btnLogout = document.getElementById('btn-logout');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    const isAuth = await fetchAuthStatus();
    if (isAuth) {
        await fetchCategories();
        await fetchTasks();
        setupNavigation();
    }
});

// ==== THEME MANAGEMENT ====
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (btnThemeToggle) {
        const icon = btnThemeToggle.querySelector('i');
        if (theme === 'light') {
            icon.className = 'fas fa-moon'; // Show moon in light mode (to switch back)
        } else {
            icon.className = 'fas fa-sun'; // Show sun in dark mode
        }
    }
}

// ==== NAVIGATION ====
function setupNavigation() {
    btnShowCategories.addEventListener('click', () => {
        tasksView.style.display = 'none';
        categoriesView.style.display = 'block';
        fetchCategories(); // Refresh categories
    });

    btnBackToTasks.addEventListener('click', () => {
        categoriesView.style.display = 'none';
        tasksView.style.display = 'block';
        fetchCategories().then(() => fetchTasks()); // Refresh everything
    });

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.reload();
            } catch (e) {
                console.error('Logout error:', e);
            }
        });
    }
}

function showFlash(message, type = 'error') {
    flashMessages.innerHTML = `<div class="flash-message ${type}">${message}</div>`;
    setTimeout(() => {
        flashMessages.innerHTML = '';
    }, 3000);
}

// ==== API FETCHERS ====
async function fetchAuthStatus() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data.user) {
                currentUser = data.user;
                loginOverlay.style.display = 'none';
                userInfo.style.display = 'flex';
                if (currentUser.avatar_url) {
                    userAvatar.src = currentUser.avatar_url;
                } else {
                    userAvatar.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(currentUser.username);
                }
                userName.textContent = currentUser.username;
                return true;
            }
        }
    } catch (e) {
        console.error('Error fetching auth status:', e);
    }

    // Not authenticated or error
    loginOverlay.style.display = 'flex';
    return false;
}
async function fetchCategories() {
    try {
        const res = await fetch('/api/categories');
        categories = await res.json();
        renderCategoryTabs();
        renderCategoryOptions();
        renderCategoryList();
    } catch (e) {
        console.error('Error fetching categories:', e);
    }
}

async function fetchTasks() {
    try {
        const url = currentCategoryId ? `/api/tasks?category_id=${currentCategoryId}` : '/api/tasks';
        const res = await fetch(url);
        tasks = await res.json();
        renderTasksList();
    } catch (e) {
        console.error('Error fetching tasks:', e);
    }
}


// ==== RENDERERS ====

// 1. Category Tabs (Tasks View)
function renderCategoryTabs() {
    let html = `<span class="category-tab ${!currentCategoryId ? 'active' : ''}" data-id="">すべて</span>`;

    categories.forEach(cat => {
        const isActive = currentCategoryId === cat.id ? 'active' : '';
        html += `<span class="category-tab ${isActive}" data-id="${cat.id}">${escapeHtml(cat.name)}</span>`;
    });

    categoryTabsContainer.innerHTML = html;

    // Add click listeners to tabs
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            currentCategoryId = id ? parseInt(id) : null;
            fetchTasks();
            renderCategoryTabs(); // re-render to update active class
        });
    });
}

// 2. Category Select Dropdown (Add Task Form)
function renderCategoryOptions() {
    let html = '';
    categories.forEach(cat => {
        const isSelected = currentCategoryId === cat.id ? 'selected' : '';
        html += `<option value="${cat.id}" ${isSelected}>${escapeHtml(cat.name)}</option>`;
    });
    taskCategorySelect.innerHTML = html;
}

// 3. Tasks List
function renderTasksList() {
    if (!tasks || tasks.length === 0) {
        taskListContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard-list empty-icon"></i>
                <p>タスクがありません。上から追加して始めましょう！</p>
            </div>
        `;
        return;
    }

    let html = '';
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    tasks.forEach(task => {
        let isUrgent = false;
        if (task.deadline) {
            const deadlineDate = new Date(task.deadline);
            const diffTime = deadlineDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 1) {
                isUrgent = true;
            }
        }

        const isCompletedBool = (task.completed === 1 || task.completed === true);
        const categoryBadge = task.category_name ? `<span class="task-category-badge">${escapeHtml(task.category_name)}</span>` : '';
        const urgentClass = (isUrgent && !task.completed) ? 'urgent' : '';
        const deadlineHtml = task.deadline ? `<span class="task-deadline ${urgentClass}"><i class="far fa-calendar-alt"></i> ${task.deadline}</span>` : '';

        html += `
            <li class="task-item ${isCompletedBool ? 'completed' : ''}" data-id="${task.id}" id="task-${task.id}">
                <div class="task-main-row" onclick="toggleTaskExpand(${task.id}, event)">
                    <div class="drag-handle"><i class="fas fa-grip-vertical"></i></div>
                    <button class="toggle-btn" aria-label="Toggle Completion" onclick="toggleTask(${task.id}); event.stopPropagation();">
                        ${isCompletedBool ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>'}
                    </button>

                    <div class="task-details">
                        <div class="task-title-group">
                            <span class="task-title">${escapeHtml(task.title)}</span>
                            ${categoryBadge}
                        </div>
                        ${deadlineHtml}
                    </div>

                    <button class="btn-delete" aria-label="Delete Task" onclick="deleteTask(${task.id}); event.stopPropagation();">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>

                <div class="task-expanded-content" onclick="event.stopPropagation()">
                    <div class="detail-section">
                        <h4><i class="fas fa-sticky-note"></i> メモ</h4>
                        <textarea class="task-description-editor" 
                            placeholder="このタスクの詳細メモを入力..." 
                            oninput="debouncedUpdateTask(${task.id}, this)">${escapeHtml(task.description || '')}</textarea>
                    </div>

                    <div class="detail-section">
                        <h4><i class="fas fa-list-ul"></i> サブタスク</h4>
                        <ul class="subtask-list" id="subtask-list-${task.id}">
                            <li class="empty-state" style="padding: 10px 0;">読み込み中...</li>
                        </ul>
                        <div class="add-subtask-row">
                            <input type="text" class="subtask-input" id="subtask-input-${task.id}" 
                                placeholder="サブタスクを追加..."
                                onkeypress="if(event.key === 'Enter') addSubtask(${task.id})">
                            <button class="btn-add-subtask" onclick="addSubtask(${task.id})"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                </div>
            </li>
        `;
    });

    taskListContainer.innerHTML = html;

    // Init Sortable for Tasks
    new Sortable(taskListContainer, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async function () {
            const items = taskListContainer.querySelectorAll('.task-item');
            const orderData = [];
            items.forEach((item, index) => {
                const id = item.getAttribute('data-id');
                if (id) {
                    orderData.push({ id: parseInt(id), order: index + 1 });
                }
            });

            try {
                await fetch('/api/tasks/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order: orderData })
                });
            } catch (e) { console.error('Error reordering', e); }
        }
    });
}

window.toggleTaskExpand = async function(taskId, event) {
    const el = document.getElementById(`task-${taskId}`);
    const isExpanded = el.classList.contains('expanded');
    
    // Close other expanded tasks (Optional: for accordion look)
    document.querySelectorAll('.task-item.expanded').forEach(item => {
        if (item.id !== `task-${taskId}`) item.classList.remove('expanded');
    });

    if (isExpanded) {
        el.classList.remove('expanded');
    } else {
        el.classList.add('expanded');
        await fetchSubtasks(taskId);
    }
}

let updateTaskTimeout = null;
window.debouncedUpdateTask = function(taskId, textarea) {
    if (updateTaskTimeout) clearTimeout(updateTaskTimeout);
    updateTaskTimeout = setTimeout(async () => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        try {
            await fetch(`/api/tasks/update/${taskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: task.title,
                    deadline: task.deadline,
                    category_id: task.category_id,
                    description: textarea.value
                })
            });
            // Update local state description without full refresh
            task.description = textarea.value;
        } catch (e) { console.error('Failed to update memo', e); }
    }, 1000);
}

window.fetchSubtasks = async function(taskId) {
    const listContainer = document.getElementById(`subtask-list-${taskId}`);
    try {
        const res = await fetch(`/api/subtasks/${taskId}`);
        const subtasks = await res.json();
        renderSubtasks(taskId, subtasks);
    } catch (e) {
        console.error('Error fetching subtasks:', e);
        listContainer.innerHTML = '<li class="empty-state">エラーが発生しました</li>';
    }
}

function renderSubtasks(taskId, subtasks) {
    const listContainer = document.getElementById(`subtask-list-${taskId}`);
    if (!subtasks || subtasks.length === 0) {
        listContainer.innerHTML = '<li class="empty-state" style="padding: 10px 0;">サブタスクはありません</li>';
        return;
    }

    let html = '';
    subtasks.forEach(st => {
        html += `
            <li class="subtask-item ${st.completed ? 'completed' : ''}" data-id="${st.id}">
                <div class="subtask-drag-handle"><i class="fas fa-grip-vertical" style="opacity: 0.3; cursor: grab;"></i></div>
                <button class="subtask-toggle" onclick="toggleSubtask(${taskId}, ${st.id})">
                    ${st.completed ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>'}
                </button>
                <input type="text" class="subtask-title-input" value="${escapeHtml(st.title)}" 
                    oninput="debouncedUpdateSubtask(${taskId}, ${st.id}, this)"
                    style="flex: 1; background: none; border: none; color: inherit; font-family: inherit; font-size: 0.9rem; outline: none;">
                <button class="btn-subtask-delete" onclick="deleteSubtask(${taskId}, ${st.id})">
                    <i class="fas fa-times"></i>
                </button>
            </li>
        `;
    });
    listContainer.innerHTML = html;

    // Init Sortable for Subtasks
    new Sortable(listContainer, {
        handle: '.subtask-drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async function () {
            const items = listContainer.querySelectorAll('.subtask-item');
            const orderData = [];
            items.forEach((item, index) => {
                const id = item.getAttribute('data-id');
                if (id) {
                    orderData.push({ id: parseInt(id), order: index + 1 });
                }
            });

            try {
                await fetch('/api/subtasks/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId, order: orderData })
                });
            } catch (e) { console.error('Error reordering subtasks', e); }
        }
    });
}

let updateSubtaskTimeout = null;
window.debouncedUpdateSubtask = function(taskId, subtaskId, input) {
    if (updateSubtaskTimeout) clearTimeout(updateSubtaskTimeout);
    updateSubtaskTimeout = setTimeout(async () => {
        try {
            await fetch(`/api/subtasks/update/${subtaskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: input.value })
            });
        } catch (e) { console.error('Failed to update subtask', e); }
    }, 1000);
}

window.addSubtask = async function(taskId) {
    const input = document.getElementById(`subtask-input-${taskId}`);
    const title = input.value.trim();
    if (!title) return;

    try {
        await fetch('/api/subtasks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, title })
        });
        input.value = '';
        await fetchSubtasks(taskId);
    } catch (e) { console.error(e); }
}

window.toggleSubtask = async function(taskId, subtaskId) {
    try {
        await fetch(`/api/subtasks/toggle/${subtaskId}`, { method: 'POST' });
        
        // Refresh subtasks list
        await fetchSubtasks(taskId);

        // Check if all subtasks are completed
        const resList = await fetch(`/api/subtasks/${taskId}`);
        const currentSubtasks = await resList.json();
        
        if (currentSubtasks.length > 0 && currentSubtasks.every(st => st.completed)) {
            if (confirm('すべてのサブタスクが完了しました。親タスクも完了にしますか？')) {
                const task = tasks.find(t => t.id === taskId);
                if (task && !task.completed) {
                    await toggleTask(taskId);
                }
            }
        }
    } catch (e) { console.error(e); }
}

window.deleteSubtask = async function(taskId, subtaskId) {
    try {
        await fetch(`/api/subtasks/delete/${subtaskId}`, { method: 'POST' });
        await fetchSubtasks(taskId);
    } catch (e) { console.error(e); }
}

// 4. Category List (Manage View)
function renderCategoryList() {
    if (!categories || categories.length === 0) {
        categoryListContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-tags empty-icon"></i>
                <p>カテゴリがありません。上から追加して始めましょう！</p>
            </div>
        `;
        return;
    }

    let html = '';
    categories.forEach(cat => {
        html += `
            <li class="task-item" data-id="${cat.id}">
                <div class="drag-handle"><i class="fas fa-grip-vertical"></i></div>
                <div class="task-details">
                    <input type="text" class="category-title-input" value="${escapeHtml(cat.name)}" 
                        oninput="debouncedUpdateCategory(${cat.id}, this)"
                        style="flex: 1; background: none; border: none; color: inherit; font-family: inherit; font-size: 1rem; outline: none; font-weight: 500;">
                </div>
                <button class="btn-delete" aria-label="カテゴリを削除" onclick="deleteCategory(${cat.id})">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </li>
        `;
    });

    categoryListContainer.innerHTML = html;

    // Init Sortable for Categories
    new Sortable(categoryListContainer, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async function () {
            const items = categoryListContainer.querySelectorAll('.task-item');
            const orderData = [];
            items.forEach((item, index) => {
                const id = item.getAttribute('data-id');
                if (id) {
                    orderData.push({ id: parseInt(id), order: index + 1 });
                }
            });

            try {
                await fetch('/api/categories/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order: orderData })
                });
            } catch (e) { console.error('Error reordering', e); }
        }
    });

}

// ==== ACTIONS ====

// Init Date Input behavior
const deadlineInputEl = document.getElementById('deadline-input');
const deadlineDisplayEl = document.querySelector('.deadline-display');

window.updateDateInputState = function () {
    if (deadlineInputEl.value) {
        deadlineInputEl.classList.remove('is-empty');
        deadlineDisplayEl.classList.add('has-value');
    } else {
        deadlineInputEl.classList.add('is-empty');
        deadlineDisplayEl.classList.remove('has-value');
    }
};

updateDateInputState();
deadlineInputEl.addEventListener('input', updateDateInputState);
deadlineInputEl.addEventListener('change', updateDateInputState);

// Tasks
addTaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskInput = document.getElementById('task-input').value;
    const catInput = document.getElementById('task-category-select').value;
    const dateInput = document.getElementById('deadline-input').value;

    try {
        await fetch('/api/tasks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: taskInput, category_id: catInput, deadline: dateInput })
        });
        document.getElementById('task-input').value = '';
        const deadlineInput = document.getElementById('deadline-input')
        deadlineInput.value = '';
        if (window.updateDateInputState) window.updateDateInputState();
        await fetchTasks();
    } catch (e) { console.error(e); }
});

window.toggleTask = async function (id) {
    try {
        await fetch(`/api/tasks/toggle/${id}`, { method: 'POST' });
        await fetchTasks();
    } catch (e) { console.error(e); }
}

window.deleteTask = async function (id) {
    try {
        await fetch(`/api/tasks/delete/${id}`, { method: 'POST' });
        await fetchTasks();
    } catch (e) { console.error(e); }
}

// Categories
addCategoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('category-input').value;

    try {
        await fetch('/api/categories/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nameInput })
        });
        document.getElementById('category-input').value = '';
        await fetchCategories();
    } catch (e) { console.error(e); }
});

window.deleteCategory = async function (id) {
    try {
        const res = await fetch(`/api/categories/delete/${id}`, { method: 'POST' });
        const data = await res.json();

        if (res.status === 400 && data.error) {
            showFlash(data.error, 'error');
        } else {
            await fetchCategories(); // Refresh
        }
    } catch (e) { console.error(e); }
}

let updateCategoryTimeout = null;
window.debouncedUpdateCategory = function (id, input) {
    if (updateCategoryTimeout) clearTimeout(updateCategoryTimeout);
    updateCategoryTimeout = setTimeout(async () => {
        try {
            await fetch(`/api/categories/update/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: input.value })
            });
            // Update other relevant UI parts
            if (window.renderCategoryTabs) renderCategoryTabs();
            if (window.renderCategoryOptions) renderCategoryOptions();
        } catch (e) { console.error('Failed to update category', e); }
    }, 1000);
}

// Utils
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==== SERVICE WORKER REGISTRATION ====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }).catch((err) => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}
