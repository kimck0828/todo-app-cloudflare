import unittest
import os
from datetime import datetime, timedelta

# Ensure tests use a separate data file so they don't overwrite user data
os.environ['TODO_DATA_FILE'] = 'test_data.json'

import app as app_module

class TodoAppTestCase(unittest.TestCase):
    def setUp(self):
        # Configure app for testing
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()
        # Reset tasks before each test
        app_module.tasks.clear()
        
        # Reset categories to defaults
        app_module.categories.clear()
        app_module.categories.extend([
            {'id': 1, 'name': '仕事', 'order': 1},
            {'id': 2, 'name': '個人', 'order': 2},
            {'id': 3, 'name': '買い物', 'order': 3}
        ])

    def tearDown(self):
        # Clean up the test database file after each test
        if os.path.exists('test_data.json'):
            os.remove('test_data.json')

    def test_index_empty(self):
        """Test the index page with no tasks."""
        rv = self.client.get('/')
        self.assertEqual(rv.status_code, 200)
        self.assertIn(b'\xe3\x82\xbf\xe3\x82\xb9\xe3\x82\xaf\xe3\x81\x8c\xe3\x81\x82\xe3\x82\x8a\xe3\x81\xbe\xe3\x81\x9b\xe3\x82\x93', rv.data)

    def test_add_task_without_deadline(self):
        """Test adding a task without a deadline."""
        rv = self.client.post('/add', data=dict(
            task='Learn Python',
            deadline=''
        ), follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        
        # Verify internal state
        self.assertEqual(len(app_module.tasks), 1)
        self.assertEqual(app_module.tasks[0]['title'], 'Learn Python')
        self.assertEqual(app_module.tasks[0]['deadline'], '')
        self.assertFalse(app_module.tasks[0].get('is_urgent', False))

    def test_add_task_with_future_deadline(self):
        """Test adding a task with a deadline far in the future."""
        future_date = (datetime.now() + timedelta(days=5)).strftime('%Y-%m-%d')
        rv = self.client.post('/add', data=dict(
            task='Future Task',
            deadline=future_date
        ), follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        self.assertIn(future_date.encode(), rv.data)
        
        # Internal state check - should not be urgent
        self.client.get('/') # Trigger the urgency check
        self.assertFalse(app_module.tasks[0]['is_urgent'])

    def test_add_task_with_urgent_deadline(self):
        """Test adding a task with an urgent deadline (today or tomorrow)."""
        urgent_date = datetime.now().strftime('%Y-%m-%d')
        rv = self.client.post('/add', data=dict(
            task='Urgent Task',
            deadline=urgent_date
        ), follow_redirects=True)
        
        # Fetch index to trigger logic and check rendered HTML
        rv = self.client.get('/')
        self.assertIn(b'urgent', rv.data) # Check if urgent class is applied
        
        # Internal state check
        self.assertTrue(app_module.tasks[0]['is_urgent'])

    def test_add_task_with_past_deadline(self):
        """Test adding a task with a deadline in the past."""
        past_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        rv = self.client.post('/add', data=dict(
            task='Past Task',
            deadline=past_date
        ), follow_redirects=True)
        
        # Fetch index to trigger logic
        rv = self.client.get('/')
        self.assertTrue(app_module.tasks[0]['is_urgent'])

    def test_toggle_task(self):
        """Test toggling task completion status."""
        self.client.post('/add', data=dict(task='Test Task', deadline=''), follow_redirects=True)
        task_id = app_module.tasks[0]['id']
        rv = self.client.post(f'/toggle/{task_id}', follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        self.assertTrue(app_module.tasks[0]['completed'])

    def test_delete_task(self):
        """Test deleting a task."""
        self.client.post('/add', data=dict(task='Test Task', deadline=''), follow_redirects=True)
        task_id = app_module.tasks[0]['id']
        rv = self.client.post(f'/delete/{task_id}', follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(len(app_module.tasks), 0)

    def test_manage_categories_page(self):
        """Test the category management page renders correctly."""
        rv = self.client.get('/categories')
        self.assertEqual(rv.status_code, 200)
        self.assertIn(b'\xe3\x82\xab\xe3\x83\x86\xe3\x82\xb4\xe3\x83\xaa\xe7\xae\xa1\xe7\x90\x86', rv.data) # "カテゴリ管理"

    def test_add_category(self):
        """Test adding a new category."""
        initial_count = len(app_module.categories)
        rv = self.client.post('/categories/add', data=dict(name='Test Category'), follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(len(app_module.categories), initial_count + 1)
        self.assertEqual(app_module.categories[-1]['name'], 'Test Category')

    def test_delete_category_not_in_use(self):
        """Test deleting a category that has no associated tasks."""
        self.client.post('/categories/add', data=dict(name='Temp Category'), follow_redirects=True)
        cat_id = app_module.categories[-1]['id']
        rv = self.client.post(f'/categories/delete/{cat_id}', follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        self.assertFalse(any(c['id'] == cat_id for c in app_module.categories))

    def test_delete_category_in_use(self):
        """Test attempting to delete a category that is in use by a task."""
        # Add a category
        self.client.post('/categories/add', data=dict(name='Used Category'), follow_redirects=True)
        cat_id = app_module.categories[-1]['id']
        
        # Add a task using this category
        self.client.post('/add', data=dict(task='Linked task', deadline='', category_id=cat_id), follow_redirects=True)
        
        # Try to delete it
        rv = self.client.post(f'/categories/delete/{cat_id}', follow_redirects=True)
        self.assertEqual(rv.status_code, 200)
        # Should flash an error and NOT delete the category
        self.assertIn(b'\xe9\x96\xa2\xe9\x80\xa3\xe4\xbb\x98\xe3\x81\x91\xe3\x81\x95\xe3\x82\x8c\xe3\x81\xa6\xe3\x81\x84\xe3\x82\x8b\xe3\x82\xbf\xe3\x82\xb9\xe3\x82\xaf\xe3\x81\x82\xe3\x82\x8a', rv.data)
        self.assertTrue(any(c['id'] == cat_id for c in app_module.categories))

    def test_reorder_tasks(self):
        """Test updating task order via drag/drop endpoint."""
        self.client.post('/add', data=dict(task='Task A', deadline=''), follow_redirects=True)
        self.client.post('/add', data=dict(task='Task B', deadline=''), follow_redirects=True)
        t1_id = app_module.tasks[0]['id']
        t2_id = app_module.tasks[1]['id']

        rv = self.client.post('/reorder', json={'order': [{'id': t1_id, 'order': 2}, {'id': t2_id, 'order': 1}]})
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(app_module.tasks[0]['order'], 2)
        self.assertEqual(app_module.tasks[1]['order'], 1)

    def test_reorder_categories(self):
        """Test updating category order via drag/drop endpoint."""
        initial_order = {c['id']: c.get('order', 0) for c in app_module.categories}
        if len(app_module.categories) >= 2:
            c1_id = app_module.categories[0]['id']
            c2_id = app_module.categories[1]['id']
            rv = self.client.post('/categories/reorder', json={'order': [{'id': c1_id, 'order': 99}, {'id': c2_id, 'order': 98}]})
            self.assertEqual(rv.status_code, 200)
            self.assertEqual(app_module.categories[0]['order'], 99)
            self.assertEqual(app_module.categories[1]['order'], 98)

if __name__ == '__main__':
    unittest.main()
