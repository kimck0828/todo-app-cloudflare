import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from './src/index';

// Type definition for test environment binding
interface Env {
    DB: D1Database;
}

const IncomingRequest = Request;

describe('Todo API Tests (Hono + D1)', () => {

    beforeEach(async () => {
        // Reset the database before each test
        await env.DB.prepare(`DROP TABLE IF EXISTS tasks`).run();
        await env.DB.prepare(`DROP TABLE IF EXISTS categories`).run();
        await env.DB.prepare(`
          CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            display_order INTEGER NOT NULL DEFAULT 0
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            completed BOOLEAN NOT NULL DEFAULT 0,
            deadline TEXT,
            category_id INTEGER,
            display_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (category_id) REFERENCES categories(id)
          )
        `).run();
        await env.DB.prepare(`INSERT INTO categories (name, display_order) VALUES ('仕事', 1)`).run();
        await env.DB.prepare(`INSERT INTO categories (name, display_order) VALUES ('個人', 2)`).run();
        await env.DB.prepare(`INSERT INTO categories (name, display_order) VALUES ('買い物', 3)`).run();
    });

    it('GET /api/tasks returns JSON of tasks', async () => {
        // Insert a task
        await env.DB.prepare(`INSERT INTO tasks (title, deadline, category_id) VALUES ('Test Task', '2030-01-01', 1)`).run();

        // Simulate Request
        const request = new IncomingRequest('http://localhost/api/tasks');
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
