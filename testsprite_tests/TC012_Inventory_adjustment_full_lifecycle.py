import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
STOCK_LEVELS_URL = f"{BASE_URL}/inventory/stock/levels"
ADJUSTMENTS_URL = f"{BASE_URL}/inventory/adjustments"
TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"


def test_inventory_adjustment_full_lifecycle():
    headers = {}
    adjustment_id = None
    try:
        # Step 1: Authenticate and get access token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {token}"}

        # Step 2: GET /inventory/stock/levels expects 200
        stock_levels_resp = requests.get(STOCK_LEVELS_URL, headers=headers, timeout=TIMEOUT)
        assert stock_levels_resp.status_code == 200, f"GET stock levels failed: {stock_levels_resp.text}"
        stock_levels = stock_levels_resp.json()
        assert isinstance(stock_levels, list), "Stock levels response is not a list"

        # Find a stock item with item_id and warehouse_id
        first_stock = None
        for s in stock_levels:
            if isinstance(s, dict) and s.get("item_id") and s.get("warehouse_id"):
                first_stock = s
                break

        if not first_stock:
            # fallback UUIDs if no valid stock found
            warehouse_id = str(uuid.UUID(int=0))
            item_id = str(uuid.UUID(int=0))
        else:
            warehouse_id = first_stock["warehouse_id"]
            item_id = first_stock["item_id"]

        # Prepare adjustment payload with required 'reason' field
        adjustment_payload = {
            "warehouse_id": warehouse_id,
            "item_id": item_id,
            "quantity_delta": 1,
            "reason": "Test adjustment"
        }

        # Step 3: POST /inventory/adjustments creates a draft/pending adjustment (201)
        create_adj_resp = requests.post(ADJUSTMENTS_URL, json=adjustment_payload, headers=headers, timeout=TIMEOUT)
        assert create_adj_resp.status_code == 201, f"Create adjustment failed: {create_adj_resp.text}"
        adjustment = create_adj_resp.json()
        adjustment_id = adjustment.get("id") or adjustment.get("adjustment_id")
        assert adjustment_id, "Created adjustment missing id"

        # Step 4: POST /inventory/adjustments/:id/approve approves it (200)
        approve_url = f"{ADJUSTMENTS_URL}/{adjustment_id}/approve"
        approve_resp = requests.post(approve_url, headers=headers, timeout=TIMEOUT)
        assert approve_resp.status_code == 200, f"Approve adjustment failed: {approve_resp.text}"

        # Step 5: POST /inventory/adjustments/:id/post posts it and stock updates (200)
        post_url = f"{ADJUSTMENTS_URL}/{adjustment_id}/post"
        post_resp = requests.post(post_url, headers=headers, timeout=TIMEOUT)
        assert post_resp.status_code == 200, f"Post adjustment failed: {post_resp.text}"

    finally:
        # Cleanup: delete the created adjustment if exists
        if adjustment_id and headers:
            delete_url = f"{ADJUSTMENTS_URL}/{adjustment_id}"
            try:
                requests.delete(delete_url, headers=headers, timeout=TIMEOUT)
            except Exception:
                pass


test_inventory_adjustment_full_lifecycle()
