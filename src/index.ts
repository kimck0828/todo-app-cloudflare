import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Context } from 'hono'
import { githubAuth } from '@hono/oauth-providers/github'
import { googleAuth } from '@hono/oauth-providers/google'
import { sign, verify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = {
    DB: D1Database
    GITHUB_ID: string
    GITHUB_SECRET: string
    GOOGLE_ID: string
    GOOGLE_SECRET: string
    JWT_SECRET: string
}

type Variables = {
    user: { id: number, username: string, avatar_url: string | null }
    'user-github': any
    'user-google': any
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ==== Middleware ====
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

// ==== Auth Routes ====
// --- GitHub OAuth ---
app.use('/api/auth/github/*', async (c, next) => {
    return githubAuth({
        client_id: c.env.GITHUB_ID || 'dummy',
        client_secret: c.env.GITHUB_SECRET || 'dummy',
        oauthApp: true,
        scope: ['user:email'],
        // Cloudflare Workersのローカル/本番環境で動的にリダイレクトURIを設定します
        redirect_uri: `${new URL(c.req.url).origin}/api/auth/github/callback`,
    })(c, next)
})

app.get('/api/auth/github', async (c) => {
    // Redirect happens in middleware
    return c.text('Redirecting...')
})

app.get('/api/auth/github/callback', async (c) => {
    const githubUser = c.get('user-github')
    if (!githubUser) {
        return c.json({ error: 'GitHub auth failed' }, 400)
    }

    try {
        // Find or create user
        let dbUser = await c.env.DB.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
            .bind('github', githubUser.id.toString())
            .first()

        if (!dbUser) {
            const result = await c.env.DB.prepare('INSERT INTO users (provider, provider_id, username, avatar_url) VALUES (?, ?, ?, ?) RETURNING *')
                .bind('github', githubUser.id.toString(), githubUser.login || githubUser.name, githubUser.avatar_url)
                .first()
            dbUser = result
        }

        const payload = {
            id: dbUser!.id,
            username: dbUser!.username,
            avatar_url: dbUser!.avatar_url,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
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
        // Cloudflare Workersのローカル/本番環境で動的にリダイレクトURIを設定します
        redirect_uri: `${new URL(c.req.url).origin}/api/auth/google/callback`,
    })(c, next)
})

app.get('/api/auth/google', async (c) => {
    return c.text('Redirecting...')
})

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

// --- Me / Logout ---
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

// ==== API Routes ====
// Require auth for API routes below
app.use('/api/tasks/*', authMiddleware)
app.use('/api/categories/*', authMiddleware)

// --- Tasks ---
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

app.post('/api/tasks/add', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const title = body.task
    const deadline = body.deadline || null
    const categoryId = body.category_id ? parseInt(body.category_id) : null

    if (!title) return c.json({ error: 'Title is required' }, 400)

    try {
        // Get max order per user
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

app.post('/api/tasks/delete/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const idStr = c.req.param('id')
    const id = parseInt(idStr)

    try {
        const result = await c.env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to delete task' }, 500)
    }
})

app.post('/api/tasks/toggle/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const idStr = c.req.param('id')
    const id = parseInt(idStr)

    try {
        // get current state
        const task = await c.env.DB.prepare('SELECT completed FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).first()
        if (!task) return c.json({ error: 'Task not found' }, 404)

        const newCompleted = task.completed ? 0 : 1;
        await c.env.DB.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?').bind(newCompleted, id, user.id).run()

        return c.json({ status: 'success', completed: !!newCompleted })
    } catch (error) {
        return c.json({ error: 'Failed to toggle task' }, 500)
    }
})

app.post('/api/tasks/reorder', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const orderData = body.order || []

    try {
        // Using batch statements, restrict update to user_id
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


// --- Categories ---
app.get('/api/categories', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    try {
        const { results } = await c.env.DB.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY display_order ASC, id ASC').bind(user.id).all()
        return c.json(results)
    } catch (error) {
        return c.json({ error: 'Failed to fetch categories' }, 500)
    }
})

app.post('/api/categories/add', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const body = await c.req.json()
    const name = body.name

    if (!name) return c.json({ error: 'Name is required' }, 400)

    try {
        const maxOrderRes = await c.env.DB.prepare('SELECT MAX(display_order) as max_order FROM categories WHERE user_id = ?').bind(user.id).first()
        const newOrder = ((maxOrderRes?.max_order as number) || 0) + 1

        await c.env.DB.prepare('INSERT INTO categories (user_id, name, display_order) VALUES (?, ?, ?)')
            .bind(user.id, name, newOrder)
            .run()

        return c.json({ status: 'success' })
    } catch (error) {
        console.error('Category Add Error:', error)
        return c.json({ error: 'Failed to add category' }, 500)
    }
})

app.post('/api/categories/delete/:id', async (c: Context<{ Bindings: Bindings, Variables: Variables }>) => {
    const user = c.get('user')
    const idStr = c.req.param('id')
    const id = parseInt(idStr)

    try {
        // Check if category is in use
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

export default app
