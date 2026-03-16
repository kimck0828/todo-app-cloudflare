-- Drop tables in correct order to avoid foreign key constraint errors
DROP TABLE IF EXISTS subtasks;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- Users table (For GitHub/Google OAuth)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,          -- 'github' or 'google'
  provider_id TEXT NOT NULL,       -- ID from the provider
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_id)
);

-- Categories table
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,        -- 追加: ユーザー紐付け
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tasks table
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,        -- 追加: ユーザー紐付け
  title TEXT NOT NULL,
  description TEXT,                -- 追加: 詳細メモ
  completed BOOLEAN NOT NULL DEFAULT 0,
  deadline TEXT,
  category_id INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Subtasks table (New)
CREATE TABLE subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
