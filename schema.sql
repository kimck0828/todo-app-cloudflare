-- Categories table
DROP TABLE IF EXISTS categories;
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- Insert default categories
INSERT INTO categories (name, display_order) VALUES ('仕事', 1);
INSERT INTO categories (name, display_order) VALUES ('個人', 2);
INSERT INTO categories (name, display_order) VALUES ('買い物', 3);

-- Tasks table
DROP TABLE IF EXISTS tasks;
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT 0,
  deadline TEXT,
  category_id INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
