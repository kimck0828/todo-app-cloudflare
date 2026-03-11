import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from './src/index';
import { sign } from 'hono/jwt';

// Type definition for test environment binding
interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

const IncomingRequest = Request;

describe('Todo API Tests (Hono + D1)', () => {
    let authToken = '';

    beforeEach(async () => {
        // Reset the database before each test
        await env.DB.prepare(`DROP TABLE IF EXISTS tasks`).run();
        await env.DB.prepare(`DROP TABLE IF EXISTS categories`).run();
        await env.DB.prepare(`DROP TABLE IF EXISTS users`).run();

        await env.DB.prepare(`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            username TEXT NOT NULL,
            avatar_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(provider, provider_id)
          )
        `).run();
        await env.DB.prepare(`INSERT INTO users (provider, provider_id, username) VALUES ('github', '123', 'testuser')`).run();

        // Generate token
        authToken = await sign({ id: 1, username: 'testuser', exp: Math.floor(Date.now() / 1000) + 3600 }, env.JWT_SECRET || 'secret', 'HS256');
        await env.DB.prepare(`
          CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            display_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            completed BOOLEAN NOT NULL DEFAULT 0,
            deadline TEXT,
            category_id INTEGER,
            display_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
          )
        `).run();
        await env.DB.prepare(`INSERT INTO categories (user_id, name, display_order) VALUES (1, '仕事', 1)`).run();
        await env.DB.prepare(`INSERT INTO categories (user_id, name, display_order) VALUES (1, '個人', 2)`).run();
        await env.DB.prepare(`INSERT INTO categories (user_id, name, display_order) VALUES (1, '買い物', 3)`).run();
    });

    it('GET /api/tasks returns JSON of tasks', async () => {
        // Insert a task
        await env.DB.prepare(`INSERT INTO tasks (user_id, title, deadline, category_id) VALUES (1, 'Test Task', '2030-01-01', 1)`).run();

        // Simulate Request
        const request = new IncomingRequest('http://localhost/api/tasks', {
            headers: { 'Cookie': `auth_token=${authToken}` }
        });
        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env as unknown as Env, ctx);

        await waitOnExecutionContext(ctx);
        expect(response.status).toBe(200);

        const data = await response.json() as any[];
        expect(Array.isArray(data)).toBe(true);
        expect(data[0].title).toBe('Test Task');
    });

    it('POST /api/tasks/add creates a new task', async () => {
        const request = new IncomingRequest('http://localhost/api/tasks/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${authToken}`
            },
            body: JSON.stringify({
                task: 'New APITask',
                category_id: 1,
                deadline: '2026-12-31'
            })
        });

        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env as unknown as Env, ctx);

        await waitOnExecutionContext(ctx);
        expect(response.status).toBe(200);

        const data = await response.json() as { status: string };
        expect(data.status).toBe('success');

        // Verify it exists in DB
        const { results } = await env.DB.prepare('SELECT * FROM tasks WHERE title = ?').bind('New APITask').all();
        expect(results?.length).toBe(1);
    });

    it('POST /api/categories/add creates a new category', async () => {
        const request = new IncomingRequest('http://localhost/api/categories/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${authToken}`
            },
            body: JSON.stringify({ name: 'Test Category' })
        });

        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env as unknown as Env, ctx);

        await waitOnExecutionContext(ctx);
        expect(response.status).toBe(200);

        const { results } = await env.DB.prepare('SELECT * FROM categories WHERE name = ?').bind('Test Category').all();
        expect(results?.length).toBe(1);
    });
});
