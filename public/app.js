// State
let categories = [];
let tasks = [];
let currentCategoryId = null;

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await fetchCategories();
    await fetchTasks();
    setupNavigation();
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
}

function showFlash(message, type = 'error') {
    flashMessages.innerHTML = `<div class="flash-message ${type}">${message}</div>`;
    setTimeout(() => {
        flashMessages.innerHTML = '';
    }, 3000);
}

// ==== API FETCHERS ====
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

        const completedClass = task.completed ? 'completed' : '';
        const checkIcon = task.completed ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>';
        const categoryBadge = task.category_name ? `<span class="task-category-badge">${escapeHtml(task.category_name)}</span>` : '';
        const urgentClass = (isUrgent && !task.completed) ? 'urgent' : '';

        // SQLite boolean maps to 0 or 1, ensure explicit check
        const isCompletedBool = (task.completed === 1 || task.completed === true);

        let deadlineHtml = '';
        if (task.deadline) {
            deadlineHtml = `<span class="task-deadline ${urgentClass}"><i class="far fa-calendar-alt"></i> ${task.deadline}</span>`;
        }

        html += `
            <li class="task-item ${isCompletedBool ? 'completed' : ''}" data-id="${task.id}">
                <div class="drag-handle"><i class="fas fa-grip-vertical"></i></div>
                <button class="toggle-btn" aria-label="Toggle Completion" onclick="toggleTask(${task.id})">
                    ${isCompletedBool ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>'}
                </button>

                <div class="task-details">
                    <div class="task-title-group">
                        <span class="task-title">${escapeHtml(task.title)}</span>
                        ${categoryBadge}
                    </div>
                    ${deadlineHtml}
                </div>

                <button class="btn-delete" aria-label="Delete Task" onclick="deleteTask(${task.id})">
                    <i class="fas fa-trash-alt"></i>
                </button>
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
                    <span class="task-title">${escapeHtml(cat.name)}</span>
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
