import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_ENDPOINT = f"{BASE_URL}/auth/login"
BRANCHES_ENDPOINT = f"{BASE_URL}/branches"
TABLES_ENDPOINT = f"{BASE_URL}/tables"
KITCHEN_ORDERS_ENDPOINT = f"{BASE_URL}/kitchen/orders"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "TestDevice"

TIMEOUT = 30

def test_table_open_kitchen_queue_checkout_flow():
    token = None
    headers = None
    table_id = None
    branch_id = None

    # Authenticate and get token
    try:
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME,
        }
        login_resp = requests.post(LOGIN_ENDPOINT, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token and isinstance(token, str), "Access token missing or invalid"
        headers = {"Authorization": f"Bearer {token}"}

        # Create a branch first
        branch_data = {
            "name": "Test Branch TC040",
            "address": "123 Test St",
            "phone": "1234567890"
        }
        branch_resp = requests.post(BRANCHES_ENDPOINT, json=branch_data, headers=headers, timeout=TIMEOUT)
        assert branch_resp.status_code == 201, f"Branch creation failed: {branch_resp.text}"
        branch = branch_resp.json()
        branch_id = branch.get("id")
        assert branch_id is not None, "Branch ID missing"

        # Create a new table
        table_data = {
            "name": "Test Table TC040",
            "branch_id": branch_id
        }
        create_resp = requests.post(TABLES_ENDPOINT, json=table_data, headers=headers, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Table creation failed: {create_resp.text}"
        table = create_resp.json()
        table_id = table.get("id")
        assert table_id is not None, "Created table ID missing"

        # Open the table (POST /tables/:id/open)
        open_resp = requests.post(f"{TABLES_ENDPOINT}/{table_id}/open", headers=headers, timeout=TIMEOUT)
        assert open_resp.status_code == 200, f"Opening table failed: {open_resp.text}"

        # Get kitchen queue (GET /kitchen/orders)
        kitchen_resp = requests.get(KITCHEN_ORDERS_ENDPOINT, headers=headers, timeout=TIMEOUT)
        assert kitchen_resp.status_code == 200, f"Getting kitchen orders failed: {kitchen_resp.text}"
        kitchen_orders = kitchen_resp.json()
        assert isinstance(kitchen_orders, list), "Kitchen orders response is not a list"

        # Create another table to test checkout on unopened table (expect 409)
        unopened_table_data = {
            "name": "Unopened Test Table TC040",
            "branch_id": branch_id
        }
        unopened_create_resp = requests.post(TABLES_ENDPOINT, json=unopened_table_data, headers=headers, timeout=TIMEOUT)
        assert unopened_create_resp.status_code == 201, f"Unopened table creation failed: {unopened_create_resp.text}"
        unopened_table_id = unopened_create_resp.json().get("id")
        assert unopened_table_id is not None, "Unopened table ID missing"

        # Attempt checkout on unopened table: expect 409 conflict
        checkout_resp = requests.post(f"{TABLES_ENDPOINT}/{unopened_table_id}/checkout", headers=headers, timeout=TIMEOUT)
        assert checkout_resp.status_code == 409, f"Checkout on unopened table should fail with 409, got {checkout_resp.status_code}"

    finally:
        # Cleanup: delete created tables and branch if possible and if we have token
        if token and headers:
            if table_id:
                try:
                    requests.delete(f"{TABLES_ENDPOINT}/{table_id}", headers=headers, timeout=TIMEOUT)
                except Exception:
                    pass
            if 'unopened_table_id' in locals() and unopened_table_id:
                try:
                    requests.delete(f"{TABLES_ENDPOINT}/{unopened_table_id}", headers=headers, timeout=TIMEOUT)
                except Exception:
                    pass
            if branch_id:
                try:
                    requests.delete(f"{BRANCHES_ENDPOINT}/{branch_id}", headers=headers, timeout=TIMEOUT)
                except Exception:
                    pass


test_table_open_kitchen_queue_checkout_flow()
