/**
 * Cloudflare Workers (Hono) バックエンド・サーバー
 * 
 * このファイルは、TODOアプリのサーバーサイドロジックを統合しています。
 * 主な機能:
 * - ユーザー認証 (GitHub/Google OAuth, JWT)
 * - タスク、サブタスク、カテゴリのCRUD操作
 * - Cloudflare D1 (SQLite) データベースとの連携
 * - Webセキュリティ強化 (Secure Headers, CSRF, Validation)
 */

import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Context } from 'hono'
import { githubAuth } from '@hono/oauth-providers/github'
import { googleAuth } from '@hono/oauth-providers/google'
import { sign, verify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { csrf } from 'hono/csrf'
import * as webpush from 'web-push-browser'

// 環境変数の型定義 (Cloudflare WorkersのBindings)
type Bindings = {
    DB: D1Database         // D1 データベースへのコネクション
    GITHUB_ID: string      // GitHub OAuth クライアントID
    GITHUB_SECRET: string  // GitHub OAuth クライアントシークレット
    GOOGLE_ID: string      // Google OAuth クライアントID
    GOOGLE_SECRET: string  // Google OAuth クライアントシークレット
    JWT_SECRET: string     // 認証用JWTの署名に使用する秘密鍵
    VAPID_PUBLIC_KEY: string
    VAPID_PRIVATE_KEY: string
    DEFAULT_NOTIFICATION_TIME: string
}

// Honoのコンテキスト変数の型定義
type Variables = {
    user: { id: number, username: string, avatar_url: string | null } // ログイン済みユーザー情報
    'user-github': any   // GitHub OAuth ミドルウェアがセットする一時的なユーザー情報
    'user-google': any   // Google OAuth ミドルウェアがセットする一時的なユーザー情報
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ==== セキュリティ設定 ====
app.use('*', secureHeaders()) // CSP, X-Frame-Options などのセキュリティヘッダーを自動付与
app.use('*', csrf())          // CSRF（クロスサイトリクエストフォージェリ）対策

// ==== ミドルウェア ====

/**
 * 認証ミドルウェア
 * CookieからJWTを取得し、検証してユーザー情報をセットします。
 */
const authMiddleware = async (c: Context<{ Bindings: Bindings, Variables: Variables }>, next: () => Promise<void>) => {
    const token = getCookie(c, 'auth_token')
    if (!token) {
        return c.json({ error: 'Unauthorized' }, 401)
    }
    try {
        const payload = await verify(token, c.env.JWT_SECRET || 'secret', 'HS256')
        c.set('user', payload as any)
        await next()
    } catch (e) {
        return c.json({ error: 'Unauthorized' }, 401)
    }
}

// ==== 認証ルート ====

// --- GitHub OAuth ---
app.use('/api/auth/github/*', async (c, next) => {
    return githubAuth({
        client_id: c.env.GITHUB_ID || 'dummy',
        client_secret: c.env.GITHUB_SECRET || 'dummy',
        oauthApp: true,
        scope: ['user:email'],
        // リダイレクトURIを動的に設定
        redirect_uri: `${new URL(c.req.url).origin}/api/auth/github/callback`,
    })(c, next)
})

app.get('/api/auth/github', async (c) => {
    return c.text('Redirecting...')
})

/**
 * GitHub認証コールバック
 */
app.get('/api/auth/github/callback', async (c) => {
    const githubUser = c.get('user-github')
    if (!githubUser) {
        return c.json({ error: 'GitHub auth failed' }, 400)
    }

    try {
        // 既存ユーザーの確認
        let dbUser = await c.env.DB.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
            .bind('github', githubUser.id.toString())
            .first()

        // 新規ユーザー登録
        if (!dbUser) {
            const result = await c.env.DB.prepare('INSERT INTO users (provider, provider_id, username, avatar_url) VALUES (?, ?, ?, ?) RETURNING *')
                .bind('github', githubUser.id.toString(), githubUser.login || githubUser.name, githubUser.avatar_url)
                .first()
            dbUser = result
        }

        // JWTのサイン
        const payload = {
            id: dbUser!.id,
            username: dbUser!.username,
            avatar_url: dbUser!.avatar_url,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7日間有効
        }
        const token = await sign(payload, c.env.JWT_SECRET || 'secret', 'HS256')

        // Cookieにセット
        setCookie(c, 'auth_token', token, {
            path: '/',
            httpOnly: true,
            secure: true,
            maxAge: 60 * 60 * 24 * 7
        })

        return c.redirect('/')
    } catch (error) {
        console.error('Github auth err:', error)
        return c.json({ error: 'Auth database error' }, 500)
    }
})

// --- Google OAuth ---
app.use('/api/auth/google/*', async (c, next) => {
    return googleAuth({
        client_id: c.env.GOOGLE_ID || 'dummy',
        client_secret: c.env.GOOGLE_SECRET || 'dummy',
        scope: ['openid', 'email', 'profile'],
        prompt: 'select_account',
        redirect_uri: `${new URL(c.req.url).origin}/api/auth/google/callback`,
    })(c, next)
})

app.get('/api/auth/google', async (c) => {
    return c.text('Redirecting...')
})

/**
 * Google認証コールバック
 */
app.get('/api/auth/google/callback', async (c) => {
    const googleUser = c.get('user-google')
    if (!googleUser) {
        return c.json({ error: 'Google auth failed' }, 400)
    }

    try {
        let dbUser = await c.env.DB.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
            .bind('google', googleUser.id.toString())
            .first()

        if (!dbUser) {
            const result = await c.env.DB.prepare('INSERT INTO users (provider, provider_id, username, avatar_url) VALUES (?, ?, ?, ?) RETURNING *')
                .bind('google', googleUser.id.toString(), googleUser.name, googleUser.picture)
                .first()
            dbUser = result
        }

        const payload = {
            id: dbUser!.id,
            username: dbUser!.username,
            avatar_url: dbUser!.avatar_url,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
        }
        const token = await sign(payload, c.env.JWT_SECRET || 'secret', 'HS256')

        setCookie(c, 'auth_token', token, {
            path: '/',
            httpOnly: true,
            secure: true,
            maxAge: 60 * 60 * 24 * 7
        })

        return c.redirect('/')
    } catch (error) {
        console.error('Google auth err:', error)
        return c.json({ error: 'Auth database error' }, 500)
    }
})

// --- ユーザー情報 / ログアウト ---
app.get('/api/auth/me', async (c) => {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ user: null }, 401)

    try {
        const payload = await verify(token, c.env.JWT_SECRET || 'secret', 'HS256')
        return c.json({ user: payload })
    } catch (e) {
        return c.json({ user: null }, 401)
    }
})

app.post('/api/auth/logout', async (c) => {
    deleteCookie(c, 'auth_token', { path: '/' })
    return c.json({ status: 'success' })
})

// ==== API ルート ====

// APIルートには認証を必須とする
app.use('/api/tasks/*', authMiddleware)
app.use('/api/categories/*', authMiddleware)

// --- タスク操作 ---

/**
 * タスク一覧取得
 */
app.get('/api/tasks', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const categoryId = c.req.query('category_id')
    let query = 'SELECT tasks.*, categories.name as category_name FROM tasks LEFT JOIN categories ON tasks.category_id = categories.id WHERE tasks.user_id = ?'
    let params: any[] = [user.id]

    if (categoryId && !isNaN(parseInt(categoryId))) {
        query += ' AND tasks.category_id = ?'
        params.push(parseInt(categoryId))
    }

    query += ' ORDER BY tasks.display_order ASC, tasks.id ASC'

    try {
        const { results } = await c.env.DB.prepare(query).bind(...params).all()
        return c.json(results)
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to fetch tasks' }, 500)
    }
})

/**
 * 新規タスク追加
 */
app.post('/api/tasks/add', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const title = body.task
    const deadline = body.deadline || null
    const categoryId = body.category_id ? parseInt(body.category_id) : null

    // バリデーション
    if (!title) return c.json({ error: 'Title is required' }, 400)
    if (title.length > 200) return c.json({ error: 'Title must be 200 characters or less' }, 400)

    try {
        // 並び順の最大値を取得
        const maxOrderRes = await c.env.DB.prepare('SELECT MAX(display_order) as max_order FROM tasks WHERE user_id = ?').bind(user.id).first()
        const newOrder = ((maxOrderRes?.max_order as number) || 0) + 1

        const { success } = await c.env.DB
            .prepare('INSERT INTO tasks (user_id, title, deadline, category_id, display_order) VALUES (?, ?, ?, ?, ?)')
            .bind(user.id, title, deadline, categoryId, newOrder)
            .run()

        if (success) {
            return c.json({ status: 'success' })
        }
        return c.json({ error: 'Failed to create task' }, 500)
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Database error' }, 500)
    }
})

/**
 * タスク削除
 */
app.post('/api/tasks/delete/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const idStr = c.req.param('id') || '0'
    const id = parseInt(idStr)

    try {
        const result = await c.env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to delete task' }, 500)
    }
})

/**
 * タスクの状態（完了/未完了）の切り替え
 */
app.post('/api/tasks/toggle/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const idStr = c.req.param('id') || '0'
    const id = parseInt(idStr)

    try {
        const task = await c.env.DB.prepare('SELECT completed FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).first()
        if (!task) return c.json({ error: 'Task not found' }, 404)

        const newCompleted = task.completed ? 0 : 1;
        await c.env.DB.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?').bind(newCompleted, id, user.id).run()

        return c.json({ status: 'success', completed: !!newCompleted })
    } catch (error) {
        return c.json({ error: 'Failed to toggle task' }, 500)
    }
})

/**
 * タスクの並べ替え（バッチ処理）
 */
app.post('/api/tasks/reorder', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const orderData = body.order || []

    try {
        const stmts = orderData.map((item: any) => {
            return c.env.DB.prepare('UPDATE tasks SET display_order = ? WHERE id = ? AND user_id = ?').bind(item.order, item.id, user.id)
        })

        if (stmts.length > 0) {
            await c.env.DB.batch(stmts)
        }
        return c.json({ status: 'success' })
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to reorder tasks' }, 500)
    }
})

/**
 * タスク内容の更新（タイトル、期限、カテゴリ、メモ）
 */
app.post('/api/tasks/update/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') || '0')
    const body = await c.req.json()
    const { title, deadline, category_id, description } = body

    // バリデーション
    if (!title) return c.json({ error: 'Title is required' }, 400)
    if (title.length > 200) return c.json({ error: 'Title must be 200 characters or less' }, 400)
    if (description && description.length > 2000) return c.json({ error: 'Memo must be 2000 characters or less' }, 400)

    try {
        const result = await c.env.DB.prepare(
            'UPDATE tasks SET title = ?, deadline = ?, category_id = ?, description = ? WHERE id = ? AND user_id = ?'
        ).bind(title, deadline || null, category_id ? parseInt(category_id) : null, description || null, id, user.id).run()

        if (result.success) {
            return c.json({ status: 'success' })
        }
        return c.json({ error: 'Failed to update task' }, 500)
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Database error' }, 500)
    }
})

// --- サブタスク操作 ---
app.use('/api/subtasks/*', authMiddleware)

/**
 * 特定タスクのサブタスク一覧取得
 */
app.get('/api/subtasks/:task_id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const taskId = parseInt(c.req.param('task_id') || '0')

    try {
        // 所有権の確認
        const task = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, user.id).first()
        if (!task) return c.json({ error: 'Task not found' }, 404)

        const { results } = await c.env.DB.prepare(
            'SELECT * FROM subtasks WHERE task_id = ? ORDER BY display_order ASC, id ASC'
        ).bind(taskId).all()
        return c.json(results)
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to fetch subtasks' }, 500)
    }
})

/**
 * 新規サブタスク追加
 */
app.post('/api/subtasks/add', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const { task_id, title } = body

    // バリデーション
    if (!title || !task_id) return c.json({ error: 'Title and Task ID are required' }, 400)
    if (title.length > 200) return c.json({ error: 'Title must be 200 characters or less' }, 400)

    try {
        const task = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(task_id, user.id).first()
        if (!task) return c.json({ error: 'Task not found' }, 404)

        const maxOrderRes = await c.env.DB.prepare('SELECT MAX(display_order) as max_order FROM subtasks WHERE task_id = ?').bind(task_id).first()
        const newOrder = ((maxOrderRes?.max_order as number) || 0) + 1

        const { success } = await c.env.DB
            .prepare('INSERT INTO subtasks (task_id, title, display_order) VALUES (?, ?, ?)')
            .bind(task_id, title, newOrder)
            .run()

        if (success) {
            return c.json({ status: 'success' })
        }
        return c.json({ error: 'Failed to create subtask' }, 500)
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Database error' }, 500)
    }
})

/**
 * サブタスクの状態切り替え
 */
app.post('/api/subtasks/toggle/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') || '0')

    try {
        const subtask = await c.env.DB.prepare(
            'SELECT subtasks.completed, subtasks.id FROM subtasks JOIN tasks ON subtasks.task_id = tasks.id WHERE subtasks.id = ? AND tasks.user_id = ?'
        ).bind(id, user.id).first()
        if (!subtask) return c.json({ error: 'Subtask not found' }, 404)

        const newCompleted = subtask.completed ? 0 : 1
        await c.env.DB.prepare('UPDATE subtasks SET completed = ? WHERE id = ?').bind(newCompleted, id).run()

        return c.json({ status: 'success', completed: !!newCompleted })
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to toggle subtask' }, 500)
    }
})

/**
 * サブタスク削除
 */
app.post('/api/subtasks/delete/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') || '0')

    try {
        const subtask = await c.env.DB.prepare(
            'SELECT subtasks.id FROM subtasks JOIN tasks ON subtasks.task_id = tasks.id WHERE subtasks.id = ? AND tasks.user_id = ?'
        ).bind(id, user.id).first()
        if (!subtask) return c.json({ error: 'Subtask not found' }, 404)

        await c.env.DB.prepare('DELETE FROM subtasks WHERE id = ?').bind(id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to delete subtask' }, 500)
    }
})

/**
 * サブタスク名の更新
 */
app.post('/api/subtasks/update/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') || '0')
    const body = await c.req.json()
    const { title } = body

    // バリデーション
    if (!title) return c.json({ error: 'Title is required' }, 400)
    if (title.length > 200) return c.json({ error: 'Title must be 200 characters or less' }, 400)

    try {
        const subtask = await c.env.DB.prepare(
            'SELECT subtasks.id FROM subtasks JOIN tasks ON subtasks.task_id = tasks.id WHERE subtasks.id = ? AND tasks.user_id = ?'
        ).bind(id, user.id).first()
        if (!subtask) return c.json({ error: 'Subtask not found' }, 404)

        await c.env.DB.prepare('UPDATE subtasks SET title = ? WHERE id = ?').bind(title, id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to update subtask' }, 500)
    }
})

/**
 * サブタスクの並べ替え
 */
app.post('/api/subtasks/reorder', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const { task_id, order } = body

    if (!task_id || !order) return c.json({ error: 'Task ID and order are required' }, 400)

    try {
        const task = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(task_id, user.id).first()
        if (!task) return c.json({ error: 'Task not found' }, 404)

        const stmts = order.map((item: any) => {
            return c.env.DB.prepare('UPDATE subtasks SET display_order = ? WHERE id = ? AND task_id = ?').bind(item.order, item.id, task_id)
        })

        if (stmts.length > 0) {
            await c.env.DB.batch(stmts)
        }
        return c.json({ status: 'success' })
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to reorder subtasks' }, 500)
    }
})


// --- カテゴリ操作 ---

/**
 * カテゴリ一覧取得
 */
app.get('/api/categories', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    try {
        const { results } = await c.env.DB.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY display_order ASC, id ASC').bind(user.id).all()
        return c.json(results)
    } catch (error) {
        return c.json({ error: 'Failed to fetch categories' }, 500)
    }
})

/**
 * 新規カテゴリ追加
 */
app.post('/api/categories/add', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json().catch(() => ({}))
    const name = body.name

    // バリデーション
    if (!name) return c.json({ error: 'Name is required' }, 400)
    if (name.length > 50) return c.json({ error: 'Category name must be 50 characters or less' }, 400)

    try {
        const maxOrderRes = await c.env.DB.prepare('SELECT MAX(display_order) as max_order FROM categories WHERE user_id = ?').bind(user.id).first()
        const newOrder = ((maxOrderRes?.max_order as number) || 0) + 1

        await c.env.DB.prepare('INSERT INTO categories (user_id, name, display_order) VALUES (?, ?, ?)')
            .bind(user.id, name, newOrder)
            .run()

        return c.json({ status: 'success' })
    } catch (error: any) {
        console.error('Category Add Error:', error)
        return c.json({ error: 'Failed to add category' }, 500)
    }
})

/**
 * カテゴリ削除
 * タスクに関連付けられている場合は拒否されます。
 */
app.post('/api/categories/delete/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const idStr = c.req.param('id') || '0'
    const id = parseInt(idStr)

    try {
        // 所有権の確認
        const category = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(id, user.id).first()
        if (!category) return c.json({ error: 'Category not found' }, 404)

        // 使用中かチェック
        const { results } = await c.env.DB.prepare('SELECT id FROM tasks WHERE category_id = ? AND user_id = ? LIMIT 1').bind(id, user.id).all()
        if (results && results.length > 0) {
            return c.json({ error: '関連付けされているタスクあり' }, 400)
        }

        await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, user.id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to delete category' }, 500)
    }
})

/**
 * カテゴリ名の更新
 */
app.post('/api/categories/update/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') || '0')
    const body = await c.req.json()
    const { name } = body

    // バリデーション
    if (!name) return c.json({ error: 'Name is required' }, 400)
    if (name.length > 50) return c.json({ error: 'Category name must be 50 characters or less' }, 400)

    try {
        const category = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(id, user.id).first()
        if (!category) return c.json({ error: 'Category not found' }, 404)

        await c.env.DB.prepare('UPDATE categories SET name = ? WHERE id = ?').bind(name, id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        console.error(error)
        return c.json({ error: 'Failed to update category' }, 500)
    }
})

/**
 * カテゴリの並べ替え
 */
app.post('/api/categories/reorder', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const orderData = body.order || []

    try {
        const stmts = orderData.map((item: any) => {
            return c.env.DB.prepare('UPDATE categories SET display_order = ? WHERE id = ? AND user_id = ?').bind(item.order, item.id, user.id)
        })

        if (stmts.length > 0) {
            await c.env.DB.batch(stmts)
        }
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to reorder categories' }, 500)
    }
})

// --- 通知・アラーム操作 ---
app.use('/api/notifications/*', authMiddleware)

/**
 * ユーザー通知設定の取得
 */
app.get('/api/notifications/settings', async (c) => {
    const user = c.get('user')
    try {
        let settings = await c.env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(user.id).first()
        if (!settings) {
            // 初期設定を返す
            return c.json({
                notifications_enabled: 1,
                notification_time: c.env.DEFAULT_NOTIFICATION_TIME || '10:00'
            })
        }
        return c.json(settings)
    } catch (e) {
        return c.json({ error: 'Failed to fetch settings' }, 500)
    }
})

/**
 * ユーザー通知設定の更新
 */
app.post('/api/notifications/settings', async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const { enabled, time } = body

    try {
        await c.env.DB.prepare(`
            INSERT INTO user_settings (user_id, notifications_enabled, notification_time)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                notifications_enabled = excluded.notifications_enabled,
                notification_time = excluded.notification_time
        `).bind(user.id, enabled ? 1 : 0, time || '10:00').run()

        return c.json({ status: 'success' })
    } catch (e) {
        console.error(e)
        return c.json({ error: 'Failed to update settings' }, 500)
    }
})

/**
 * プッシュサブスクリプションの登録
 */
app.post('/api/notifications/subscribe', async (c) => {
    const user = c.get('user')
    const subscription = await c.req.json()

    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        return c.json({ error: 'Invalid subscription' }, 400)
    }

    try {
        // 既存の同一エンドポイントを確認または新規登録
        await c.env.DB.prepare(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?)
        `).bind(user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth).run()

        return c.json({ status: 'success' })
    } catch (e) {
        console.error(e)
        return c.json({ error: 'Failed to save subscription' }, 500)
    }
})

/**
 * デバッグ用：今すぐテスト通知を送信
 */
app.post('/api/notifications/test', async (c) => {
    const user = c.get('user')
    
    try {
        const { results: subscriptions } = await c.env.DB.prepare(
            'SELECT * FROM push_subscriptions WHERE user_id = ?'
        ).bind(user.id).all()

        if (!subscriptions || subscriptions.length === 0) {
            return c.json({ error: 'No push subscriptions found for this user.' }, 400)
        }

        const payload = JSON.stringify({
            title: 'テスト通知',
            body: 'これはテスト通知です。正しく届いています！',
            icon: '/favicon.ico',
            data: { url: '/' }
        })

        // VAPID鍵をデシリアライズ
        const keyPair = await webpush.deserializeVapidKeys({
            publicKey: c.env.VAPID_PUBLIC_KEY,
            privateKey: c.env.VAPID_PRIVATE_KEY
        })

        let successCount = 0;
        let failCount = 0;
        let lastError = '';

        for (const sub of subscriptions as any[]) {
            try {
                await webpush.sendPushNotification(
                    keyPair,
                    {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth }
                    },
                    'mailto:example@yourdomain.com',
                    payload
                )
                successCount++;
            } catch (err: any) {
                console.error(`Test notification failed for sub ${sub.id}:`, err)
                failCount++;
                lastError = err.message;
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run()
                }
            }
        }

        if (successCount === 0 && subscriptions.length > 0) {
            return c.json({ error: `All transmissions failed. Last error: ${lastError}` }, 500)
        }

        return c.json({ status: 'success', sent: successCount, failed: failCount })
    } catch (e: any) {
        console.error('Test notification error:', e);
        return c.json({ error: e.message }, 500)
    }
})

/**
 * VAPID公開鍵の取得
 */
app.get('/api/notifications/vapid-public-key', (c) => {
    return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY })
})

// 定期実行（Scheduled Event）ハンドラー
const scheduledHandler = async (env: Bindings) => {
    console.log('Running scheduled notification check...')
    
    // 現在時刻 (HH:mm 形式)
    const now = new Date()
    // 日本時間に調整 (UTC+9)
    const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000))
    // HH:mm 形式 (例: "10:05")
    const currentTimeStr = `${String(jstNow.getUTCHours()).padStart(2, '0')}:${String(jstNow.getUTCMinutes()).padStart(2, '0')}`

    try {
        // 1. 通知設定が有効で、かつ通知時間が現在時刻 (HH:mm) と一致するユーザーを取得
        const usersToNotify = await env.DB.prepare(`
            SELECT 
                u.id as user_id, 
                s.notification_time,
                COUNT(t.id) as task_count
            FROM users u
            JOIN user_settings s ON u.id = s.user_id
            JOIN tasks t ON u.id = t.user_id
            WHERE s.notifications_enabled = 1
              AND t.completed = 0
              AND t.deadline = DATE('now', '+9 hours')
              AND s.notification_time = ?
            GROUP BY u.id
        `).bind(currentTimeStr).all()

        if (!usersToNotify.results || usersToNotify.results.length === 0) {
            console.log(`[${currentTimeStr}] No users to notify at this time.`)
            return
        }

        // VAPID鍵をデシリアライズ
        const keyPair = await webpush.deserializeVapidKeys({
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY
        })

        for (const userRow of usersToNotify.results as any[]) {
            const { user_id, task_count } = userRow
            
            // ユーザーの全サブスクリプションを取得
            const { results: subscriptions } = await env.DB.prepare(
                'SELECT * FROM push_subscriptions WHERE user_id = ?'
            ).bind(user_id).all()

            const payload = JSON.stringify({
                title: 'タスクのリマインド',
                body: `今日が期限のタスクが ${task_count} 件あります。確認をお願いします。`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png',
                data: { url: '/' }
            })

            for (const sub of subscriptions as any[]) {
                try {
                    await webpush.sendPushNotification(
                        keyPair,
                        {
                            endpoint: sub.endpoint,
                            keys: { p256dh: sub.p256dh, auth: sub.auth }
                        },
                        'mailto:example@yourdomain.com',
                        payload
                    )
                } catch (err: any) {
                    console.error(`Failed to send notification to sub ${sub.id}:`, err)
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // 無効なサブスクリプションを削除
                        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run()
                    }
                }
            }
        }
    } catch (error) {
        console.error('Scheduled job error:', error)
    }
}

export default {
    fetch: app.fetch,
    async scheduled(event: any, env: Bindings, ctx: any) {
        ctx.waitUntil(scheduledHandler(env))
    }
}
