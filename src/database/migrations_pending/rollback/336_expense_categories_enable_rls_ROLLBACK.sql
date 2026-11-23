-- Restores the pre-336 state (the insecure one). Use only to undo 336 in an emergency.
ALTER TABLE expense_categories DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE expense_categories TO anon, authenticated;
