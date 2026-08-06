import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
COUNTS_URL = f"{BASE_URL}/inventory/counts"
ITEMS_URL = f"{BASE_URL}/items"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-stock-count-session"

TIMEOUT = 30


def test_stock_count_session_lifecycle():
    # Authenticate and get token
    try:
        login_resp = requests.post(
            LOGIN_URL,
            json={"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME},
            timeout=TIMEOUT,
        )
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Step 1: Create a count session (POST /inventory/counts)
        # To create a session we should provide minimal metadata as per typical inventory count creation
        # Using a unique session name or ref to avoid conflicts
        count_session_payload = {
            "name": f"Test Count Session {uuid.uuid4()}",
            "notes": "Automated test count session"
        }
        create_resp = requests.post(
            COUNTS_URL, json=count_session_payload, headers=headers, timeout=TIMEOUT
        )
        assert create_resp.status_code == 201, f"Failed to create count session: {create_resp.text}"
        count_session = create_resp.json()
        count_id = count_session.get("id")
        assert count_id, "No ID returned from count session creation"

        # Step 2: Get an item to count (PATCH on /counts/:id/items/:itemId)
        # Need an existing itemId: fetch item list and pick one
        items_resp = requests.get(ITEMS_URL, headers=headers, timeout=TIMEOUT)
        assert items_resp.status_code == 200, f"Failed to get items list: {items_resp.text}"
        items_list = items_resp.json()
        assert isinstance(items_list, list) and len(items_list) > 0, "No items found to count"
        item_id = items_list[0].get("id")
        assert item_id, "No valid item id found"

        # Save a counted quantity for that item
        # Payload with counted quantity
        quantity_payload = {"counted_quantity": 42}  # example quantity
        patch_url = f"{COUNTS_URL}/{count_id}/items/{item_id}"
        patch_resp = requests.patch(patch_url, json=quantity_payload, headers=headers, timeout=TIMEOUT)
        assert patch_resp.status_code == 200, f"Failed to save counted quantity: {patch_resp.text}"

        # Step 3: Finalize the count session (POST /inventory/counts/:id/finalize)
        finalize_url = f"{COUNTS_URL}/{count_id}/finalize"
        finalize_resp = requests.post(finalize_url, headers=headers, timeout=TIMEOUT)
        assert finalize_resp.status_code == 200, f"Failed to finalize count session: {finalize_resp.text}"
        report = finalize_resp.json()
        assert isinstance(report, dict), "Finalize response is not a JSON object"
        # Optionally verify report contains expected keys, e.g., a summary or counts
        assert "summary" in report or "report" in report or len(report) > 0, "Finalize report seems empty or malformed"

    finally:
        # Cleanup: delete created count session to avoid side effects
        if 'count_id' in locals():
            del_resp = requests.delete(f"{COUNTS_URL}/{count_id}", headers=headers, timeout=TIMEOUT)
            # 204 No Content is common for deletes, or 200 OK, but we do not assert to avoid failures in cleanup