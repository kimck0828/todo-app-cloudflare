import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Context } from 'hono'

type Bindings = {
    DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// ==== API Routes ====

// --- Tasks ---
app.get('/api/tasks', async (c: Context<{ Bindings: Bindings }>) => {
    const categoryId = c.req.query('category_id')
    let query = 'SELECT tasks.*, categories.name as category_name FROM tasks LEFT JOIN categories ON tasks.category_id = categories.id'
    let params: any[] = []

    if (categoryId && !isNaN(parseInt(categoryId))) {
        query += ' WHERE tasks.category_id = ?'
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

app.post('/api/tasks/add', async (c: Context<{ Bindings: Bindings }>) => {
    const body = await c.req.json()
    const title = body.task
    const deadline = body.deadline || null
    const categoryId = body.category_id ? parseInt(body.category_id) : null

    if (!title) return c.json({ error: 'Title is required' }, 400)

    try {
        // Get max order
        const maxOrderRes = await c.env.DB.prepare('SELECT MAX(display_order) as max_order FROM tasks').first()
        const newOrder = ((maxOrderRes?.max_order as number) || 0) + 1

        const { success } = await c.env.DB
            .prepare('INSERT INTO tasks (title, deadline, category_id, display_order) VALUES (?, ?, ?, ?)')
            .bind(title, deadline, categoryId, newOrder)
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

app.post('/api/tasks/delete/:id', async (c: Context<{ Bindings: Bindings }>) => {
    const idStr = c.req.param('id')
    const id = parseInt(idStr)

    try {
        await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to delete task' }, 500)
    }
})

app.post('/api/tasks/toggle/:id', async (c: Context<{ Bindings: Bindings }>) => {
    const idStr = c.req.param('id')
    const id = parseInt(idStr)

    try {
        // get current state
        const task = await c.env.DB.prepare('SELECT completed FROM tasks WHERE id = ?').bind(id).first()
        if (!task) return c.json({ error: 'Task not found' }, 404)

        const newCompleted = task.completed ? 0 : 1;
        await c.env.DB.prepare('UPDATE tasks SET completed = ? WHERE id = ?').bind(newCompleted, id).run()

        return c.json({ status: 'success', completed: !!newCompleted })
    } catch (error) {
        return c.json({ error: 'Failed to toggle task' }, 500)
    }
})

app.post('/api/tasks/reorder', async (c: Context<{ Bindings: Bindings }>) => {
    const body = await c.req.json()
    const orderData = body.order || []

    try {
        // Hono doesn't easily support D1 transactions well yet in a simple loop without batches.
        // Using batch statements
        const stmts = orderData.map((item: any) => {
            return c.env.DB.prepare('UPDATE tasks SET display_order = ? WHERE id = ?').bind(item.order, item.id)
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
app.get('/api/categories', async (c: Context<{ Bindings: Bindings }>) => {
    try {
        const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY display_order ASC, id ASC').all()
        return c.json(results)
    } catch (error) {
        return c.json({ error: 'Failed to fetch categories' }, 500)
    }
})

app.post('/api/categories/add', async (c: Context<{ Bindings: Bindings }>) => {
    const body = await c.req.json()
    const name = body.name

    if (!name) return c.json({ error: 'Name is required' }, 400)

    try {
        const maxOrderRes = await c.env.DB.prepare('SELECT MAX(display_order) as max_order FROM categories').first()
        const newOrder = ((maxOrderRes?.max_order as number) || 0) + 1

        await c.env.DB.prepare('INSERT INTO categories (name, display_order) VALUES (?, ?)')
            .bind(name, newOrder)
            .run()

        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to add category' }, 500)
    }
})

app.post('/api/categories/delete/:id', async (c: Context<{ Bindings: Bindings }>) => {
    const idStr = c.req.param('id')
    const id = parseInt(idStr)

    try {
        // Check if category is in use
        const { results } = await c.env.DB.prepare('SELECT id FROM tasks WHERE category_id = ? LIMIT 1').bind(id).all()
        if (results && results.length > 0) {
            return c.json({ error: '関連付けされているタスクあり' }, 400)
        }

        await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run()
        return c.json({ status: 'success' })
    } catch (error) {
        return c.json({ error: 'Failed to delete category' }, 500)
    }
})

app.post('/api/categories/reorder', async (c: Context<{ Bindings: Bindings }>) => {
    const body = await c.req.json()
    const orderData = body.order || []

    try {
        const stmts = orderData.map((item: any) => {
            return c.env.DB.prepare('UPDATE categories SET display_order = ? WHERE id = ?').bind(item.order, item.id)
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
