/**
 * TODOアプリ フロントエンド・メインロジック (Vanilla JS)
 * 
 * このファイルは、TODOアプリのUI描画、イベント操作、APIリクエストを制御します。
 * 主な機能:
 * - テーマ切り替え (ダーク/ライト)
 * - タスク、サブタスク、カテゴリの描画 (SPA)
 * - リアルタイムバリデーション、オートセーブ機能 (デバウンス)
 * - SortableJS を使用した直感的なドラッグ＆ドロップ並べ替え
 */

// 状態管理 (グローバル変数)
let categories = [];      // カテゴリ一覧
let tasks = [];           // タスク一覧
let currentCategoryId = null; // 現在選択中のフィルタカテゴリID
let currentUser = null;    // 現在ログイン中のユーザー情報

// DOM 要素 - タスク表示画面
const tasksView = document.getElementById('tasks-view');
const categoryTabsContainer = document.getElementById('category-tabs');
const taskCategorySelect = document.getElementById('task-category-select');
const taskListContainer = document.getElementById('task-list');
const addTaskForm = document.getElementById('add-task-form');
const btnShowCategories = document.getElementById('btn-show-categories');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const btnShowNotifications = document.getElementById('btn-show-notifications');

// DOM 要素 - 通知設定モーダル
const notificationModal = document.getElementById('notification-modal');
const btnCloseNotificationModal = document.getElementById('btn-close-notification-modal');
const notificationEnabledToggle = document.getElementById('notification-enabled-toggle');
const notificationTimeInput = document.getElementById('notification-time-input');
const btnSaveNotificationSettings = document.getElementById('btn-save-notification-settings');
const notificationTimeSection = document.getElementById('notification-time-section');

// DOM 要素 - カテゴリ管理画面
const categoriesView = document.getElementById('categories-view');
const categoryListContainer = document.getElementById('category-list');
const addCategoryForm = document.getElementById('add-category-form');
const btnBackToTasks = document.getElementById('btn-back-to-tasks');
const flashMessages = document.getElementById('flash-messages');

// DOM 要素 - 認証 & ユーザー情報
const loginOverlay = document.getElementById('login-overlay');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const btnLogout = document.getElementById('btn-logout');

/**
 * 初期化処理
 * ページ読み込み時にテーマ設定の復元と認証状態の確認を行います。
 */
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    const isAuth = await fetchAuthStatus();
    if (isAuth) {
        await fetchCategories();
        await fetchTasks();
        setupNavigation();
        initNotifications(); // 通知機能の初期化
    }
});

// ==== テーマ管理 ====

/**
 * テーマの初期化とトグルイベントの設定
 */
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

/**
 * 指定されたテーマを適用する
 * @param {string} theme - 'dark' または 'light'
 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (btnThemeToggle) {
        const icon = btnThemeToggle.querySelector('i');
        if (theme === 'light') {
            icon.className = 'fas fa-moon'; // ライトモード時は月のアイコンを表示（切り替え用）
        } else {
            icon.className = 'fas fa-sun';  // ダークモード時は太陽のアイコンを表示
        }
    }
}

// ==== ナビゲーション ====

/**
 * ボタンのクリックイベント（画面遷移・ログアウト）の設定
 */
function setupNavigation() {
    btnShowCategories.addEventListener('click', () => {
        tasksView.style.display = 'none';
        categoriesView.style.display = 'block';
        fetchCategories(); // カテゴリ一覧を最新にする
    });

    btnBackToTasks.addEventListener('click', () => {
        categoriesView.style.display = 'none';
        tasksView.style.display = 'block';
        fetchCategories().then(() => fetchTasks()); // 最新の状態で戻る
    });

    // 通知設定モーダルの開閉
    if (btnShowNotifications) {
        btnShowNotifications.addEventListener('click', showNotificationModal);
    }
    if (btnCloseNotificationModal) {
        btnCloseNotificationModal.addEventListener('click', closeNotificationModal);
    }
    if (btnSaveNotificationSettings) {
        btnSaveNotificationSettings.addEventListener('click', saveNotificationSettings);
    }

    // トグルの状態変化で時間を表示/非表示
    if (notificationEnabledToggle) {
        notificationEnabledToggle.addEventListener('change', () => {
            notificationTimeSection.style.display = notificationEnabledToggle.checked ? 'block' : 'none';
        });
    }

    const btnTestNotification = document.getElementById('btn-test-notification');
    if (btnTestNotification) {
        btnTestNotification.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/notifications/test', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    alert('テスト通知を送信しました。数秒以内に届くか確認してください。');
                } else {
                    alert('送信失敗: ' + (data.error || '不明なエラー'));
                }
            } catch (e) {
                alert('通信エラー: ' + e.message);
            }
        });
    }

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

/**
 * 一時的な通知メッセージを表示する
 */
function showFlash(message, type = 'error') {
    flashMessages.innerHTML = `<div class="flash-message ${type}">${escapeHtml(message)}</div>`;
    setTimeout(() => {
        flashMessages.innerHTML = '';
    }, 3000);
}

// ==== API 通信 ====

/**
 * ログイン状態の確認とユーザー情報の取得
 */
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

    // 未認証の場合、ログインオーバーレイを表示
    loginOverlay.style.display = 'flex';
    return false;
}

/**
 * カテゴリ一覧を取得して各UIを更新
 */
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

/**
 * タスク一覧を取得して描画
 */
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


// ==== UI レンダリング ====

/**
 * カテゴリ切り替えボタン（タブ）の描画
 */
function renderCategoryTabs() {
    let html = `<span class="category-tab ${!currentCategoryId ? 'active' : ''}" data-id="">すべて</span>`;

    categories.forEach(cat => {
        const isActive = currentCategoryId === cat.id ? 'active' : '';
        html += `<span class="category-tab ${isActive}" data-id="${cat.id}">${escapeHtml(cat.name)}</span>`;
    });

    categoryTabsContainer.innerHTML = html;

    // タブクリック時のフィルタリング設定
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            currentCategoryId = id ? parseInt(id) : null;
            fetchTasks();
            renderCategoryTabs(); // アクティブ状態を更新するため再描画
        });
    });
}

/**
 * タスク追加フォーム内のカテゴリ選択ドロップダウンの描画
 */
function renderCategoryOptions() {
    let html = '';
    categories.forEach(cat => {
        const isSelected = currentCategoryId === cat.id ? 'selected' : '';
        html += `<option value="${cat.id}" ${isSelected}>${escapeHtml(cat.name)}</option>`;
    });
    taskCategorySelect.innerHTML = html;
}

/**
 * メインタスク一覧の描画
 */
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
        // 期限が近いかどうかの判定 (本日または過ぎている)
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
        const deadlineHtml = task.deadline ? `<span class="task-deadline ${urgentClass}"><i class="far fa-calendar-alt"></i> ${escapeHtml(task.deadline)}</span>` : '';

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

    // タスクの並べ替え設定 (SortableJS)
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

/**
 * タスクの詳細表示（アコーディオン）の開閉
 */
window.toggleTaskExpand = async function(taskId, event) {
    const el = document.getElementById(`task-${taskId}`);
    const isExpanded = el.classList.contains('expanded');
    
    // 他のタスクを閉じる (アコーディオンの挙動)
    document.querySelectorAll('.task-item.expanded').forEach(item => {
        if (item.id !== `task-${taskId}`) item.classList.remove('expanded');
    });

    if (isExpanded) {
        el.classList.remove('expanded');
    } else {
        el.classList.add('expanded');
        await fetchSubtasks(taskId); // 展開時にサブタスクを最新にする
    }
}

/**
 * タスク内容の更新（オートセーブ・デバウンス処理）
 */
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
            // ローカル状態のみ更新（再描画せずに入力を維持）
            task.description = textarea.value;
        } catch (e) { console.error('Failed to update memo', e); }
    }, 1000);
}

/**
 * サブタスク一覧をサーバーから取得
 */
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

/**
 * 特定タスク配下のサブタスク一覧を描画
 */
function renderSubtasks(taskId, subtasks) {
    const listContainer = document.getElementById(`subtask-list-${taskId}`);
    if (!subtasks || !Array.isArray(subtasks) || subtasks.length === 0) {
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

    // サブタスクの並べ替え設定 (SortableJS)
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

/**
 * サブタスク名の更新（デバウンス処理）
 */
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

/**
 * サブタスクの追加
 */
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

/**
 * サブタスクの完了切り替え
 * すべて完了した場合に親タスクの完了を促す。
 */
window.toggleSubtask = async function(taskId, subtaskId) {
    try {
        await fetch(`/api/subtasks/toggle/${subtaskId}`, { method: 'POST' });
        
        await fetchSubtasks(taskId);

        // すべてのサブタスクが完了したか確認
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

/**
 * サブタスクの削除
 */
window.deleteSubtask = async function(taskId, subtaskId) {
    try {
        await fetch(`/api/subtasks/delete/${subtaskId}`, { method: 'POST' });
        await fetchSubtasks(taskId);
    } catch (e) { console.error(e); }
}

/**
 * カテゴリ一覧の描画（管理画面）
 */
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

    // カテゴリの順序変更設定
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

// ==== アクション処理 (フォーム操作) ====

// 期限入力フィールドの挙動制御 (プレースホルダ表示用)
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

/**
 * タスク追加フォームの送信
 */
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

/**
 * タスクの完了状態切り替え
 */
window.toggleTask = async function (id) {
    try {
        await fetch(`/api/tasks/toggle/${id}`, { method: 'POST' });
        await fetchTasks();
    } catch (e) { console.error(e); }
}

/**
 * タスクの削除
 */
window.deleteTask = async function (id) {
    try {
        await fetch(`/api/tasks/delete/${id}`, { method: 'POST' });
        await fetchTasks();
    } catch (e) { console.error(e); }
}

/**
 * カテゴリ追加フォームの送信
 */
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

/**
 * カテゴリの削除
 */
window.deleteCategory = async function (id) {
    try {
        const res = await fetch(`/api/categories/delete/${id}`, { method: 'POST' });
        const data = await res.json();

        if (res.status === 400 && data.error) {
            showFlash(data.error, 'error');
        } else {
            await fetchCategories();
        }
    } catch (e) { console.error(e); }
}

/**
 * カテゴリ名の編集（デバウンス処理）
 */
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
            // 変更内容を他のUI（タブや選択肢）にも反映
            if (window.renderCategoryTabs) renderCategoryTabs();
            if (window.renderCategoryOptions) renderCategoryOptions();
        } catch (e) { console.error('Failed to update category', e); }
    }, 1000);
}

// ==== ユーティリティ ====

/**
 * HTML文字のエスケープ処理 (XSS対策)
 */
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

// ==== サービスワーカーの登録 (PWA対応) ====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }).catch((err) => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}
/**
 * サービスワーカーの登録と通知設定の読み込み
 */
async function initNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (btnShowNotifications) btnShowNotifications.style.display = 'none';
        return;
    }

    try {
        // サービスワーカーの登録
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered with scope:', registration.scope);

        // 現在の設定を取得
        const res = await fetch('/api/notifications/settings');
        const settings = await res.json();
        
        if (settings) {
            notificationEnabledToggle.checked = settings.notifications_enabled === 1;
            notificationTimeInput.value = settings.notification_time || '10:00';
            notificationTimeSection.style.display = notificationEnabledToggle.checked ? 'block' : 'none';
        }
    } catch (e) {
        console.error('Failed to init notifications:', e);
    }
}

/**
 * 通知設定モーダルを表示
 */
function showNotificationModal() {
    notificationModal.style.display = 'flex';
}

/**
 * 通知設定モーダルを閉じる
 */
function closeNotificationModal() {
    notificationModal.style.display = 'none';
}

/**
 * 通知設定の保存とプッシュ購読の開始
 */
async function saveNotificationSettings() {
    const enabled = notificationEnabledToggle.checked;
    const time = notificationTimeInput.value;

    try {
        if (enabled) {
            // 通知許可を求める
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                alert('通知が許可されませんでした。ブラウザの設定を確認してください。');
                return;
            }

            // プッシュサブスクリプションの登録
            await subscribeToPush();
        }

        // サーバーに設定を保存
        const res = await fetch('/api/notifications/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, time })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Server error during settings update');
        }

        alert('通知設定を保存しました。');
        closeNotificationModal();
    } catch (e) {
        console.error('Failed to save notification settings:', e);
        alert('設定の保存に失敗しました：' + e.message);
    }
}

/**
 * Web Pushの購読を開始し、サーバーに送信する
 */
async function subscribeToPush() {
    const registration = await navigator.serviceWorker.ready;
    
    // VAPID公開鍵を取得
    const resKey = await fetch('/api/notifications/vapid-public-key');
    const { publicKey } = await resKey.json();
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    // 既存の購読を確認
    let subscription = await registration.pushManager.getSubscription();

    // 既存の購読がある場合、鍵が一致するか確認（簡易的に常に再購読でも良いが、ここでは未購読の場合のみ新規作成）
    // 鍵更新を確実にするため、一度解除して再登録する
    if (subscription) {
        await subscription.unsubscribe();
    }

    // 新規購読を開始
    subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
    });

    // サーバーにサブスクリプションを登録
    const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON ? subscription.toJSON() : subscription)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error during subscription');
    }
}

/**
 * VAPID公開鍵(Base64URL)をUint8Arrayに変換するユーティリティ
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
