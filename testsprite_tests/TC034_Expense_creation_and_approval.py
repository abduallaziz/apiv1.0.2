import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
EXPENSES_URL = f"{BASE_URL}/expenses"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-expense-approval"

def test_expense_creation_and_approval():
    # Step 1: Authenticate and get token
    try:
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=30)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token, "No access_token returned on login"
        headers = {"Authorization": f"Bearer {token}"}

        # Get an existing branch id to use for expense
        branches_resp = requests.get(f"{BASE_URL}/branches", headers=headers, timeout=30)
        assert branches_resp.status_code == 200, f"Failed to get branches: {branches_resp.text}"
        branches = branches_resp.json()
        assert isinstance(branches, list) and len(branches) > 0, "No branches available"
        branch_id = branches[0]["id"]

        # Get an existing expense category to use for creation
        categories_resp = requests.get(f"{BASE_URL}/expense-categories", headers=headers, timeout=30)
        assert categories_resp.status_code == 200, f"Failed to get expense categories: {categories_resp.text}"
        categories = categories_resp.json()
        assert isinstance(categories, list) and len(categories) > 0, "No expense categories available"
        category_id = categories[0]["id"]

        # Step 2: Create a new expense with required fields
        expense_description = f"Test Expense {uuid.uuid4()}"
        expense_payload = {
            "description": expense_description,
            "amount": 123.45,
            "category_id": category_id,
            "branch_id": branch_id,
            "type": "one_time"
        }

        create_resp = requests.post(EXPENSES_URL, json=expense_payload, headers=headers, timeout=30)
        assert create_resp.status_code == 201, f"Expense creation failed: {create_resp.text}"

        expense_created = create_resp.json()
        expense_id = expense_created.get("id")
        assert expense_id, "Created expense has no ID"

        # Step 3: List expenses and verify the created expense is present
        list_resp = requests.get(EXPENSES_URL, headers=headers, timeout=30)
        assert list_resp.status_code == 200, f"Failed to list expenses: {list_resp.text}"
        expenses_response = list_resp.json()
        expenses_list = expenses_response.get("items", [])
        assert any(expense.get("id") == expense_id for expense in expenses_list), "Created expense not found in list"

        # Step 4: Approve the created expense using PATCH /expenses/:id/approve
        approve_url = f"{EXPENSES_URL}/{expense_id}/approve"
        approve_resp = requests.patch(approve_url, headers=headers, timeout=30)
        assert approve_resp.status_code == 200, f"Failed to approve expense: {approve_resp.text}"

        approved_expense = approve_resp.json()
        # Verify approved expense id matches created expense id
        assert approved_expense.get("id") == expense_id, "Approved expense ID mismatch"

    finally:
        # Cleanup: Delete the created expense if it exists and if API supports deletion (not documented)
        if 'expense_id' in locals():
            try:
                del_resp = requests.delete(f"{EXPENSES_URL}/{expense_id}", headers=headers, timeout=30)
                # 200, 204 or 404 acceptable - 404 means already deleted or not found
                assert del_resp.status_code in (200, 204, 404)
            except Exception:
                pass

test_expense_creation_and_approval()
