import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
PURCHASE_REQUESTS_URL = f"{BASE_URL}/purchasing/purchase-requests"
PURCHASE_ORDERS_URL = f"{BASE_URL}/purchasing/purchase-orders"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-1234"
TIMEOUT = 30

def test_purchase_request_to_purchase_order_approval_flow():
    # Authenticate and get bearer token
    login_payload = {"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME}
    try:
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token and isinstance(token, str), "Missing or invalid access_token"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Step 1: Create Purchase Request
        # Minimal viable payload for purchase request
        pr_payload = {
            "request_number": "TEST-PR-001",
            "items": [
                {
                    "item_id": "test-item-id",  # placeholder, replaced after item creation
                    "quantity_requested": 2.0
                }
            ],
            "notes": "Test purchase request"
        }

        # Since item_id is required and must be UUID, create an item first
        # POST /api/v1/items
        items_url = f"{BASE_URL}/items"
        item_payload = {
            "name": "Test Product for PR",
            "type": "product",
            "operation_type": "sell",
            "price": 10.00
        }
        item_id = None
        pr_id = None
        po_id = None
        # Try-finally to cleanup created item, PR and PO
        try:
            item_resp = requests.post(items_url, headers=headers, json=item_payload, timeout=TIMEOUT)
            assert item_resp.status_code == 201, f"Failed to create item: {item_resp.text}"
            item_data = item_resp.json()
            item_id = item_data.get("id")
            assert item_id, "No item id returned"

            # Update pr_payload to reference created item id
            pr_payload["items"][0]["item_id"] = item_id

            # Create purchase request
            pr_resp = requests.post(PURCHASE_REQUESTS_URL, headers=headers, json=pr_payload, timeout=TIMEOUT)
            assert pr_resp.status_code == 201, f"Failed to create purchase request: {pr_resp.text}"
            pr_data = pr_resp.json()
            pr_id = pr_data.get("id")
            assert pr_id, "No purchase request id returned"

            # Step 2: Create Purchase Order referencing the purchase request
            po_payload = {
                "purchase_request_id": pr_id,
                "notes": "Purchase order draft for test"
            }
            po_resp = requests.post(PURCHASE_ORDERS_URL, headers=headers, json=po_payload, timeout=TIMEOUT)
            assert po_resp.status_code == 201, f"Failed to create purchase order: {po_resp.text}"
            po_data = po_resp.json()
            po_id = po_data.get("id")
            assert po_id, "No purchase order id returned"
            # PO should be in draft status
            po_status = po_data.get("status")
            assert po_status and po_status.lower() == "draft", f"Unexpected PO status: {po_status}"

            # Step 3: Submit the Purchase Order
            submit_url = f"{PURCHASE_ORDERS_URL}/{po_id}/submit"
            submit_resp = requests.post(submit_url, headers=headers, timeout=TIMEOUT)
            assert submit_resp.status_code == 200, f"Failed to submit purchase order: {submit_resp.text}"
            submit_data = submit_resp.json()
            # Verify submitted status
            submitted_status = submit_data.get("status")
            assert submitted_status and submitted_status.lower() == "submitted", f"PO not submitted properly: {submitted_status}"

            # Step 4: Approve the Purchase Order
            approve_url = f"{PURCHASE_ORDERS_URL}/{po_id}/approve"
            approve_resp = requests.post(approve_url, headers=headers, timeout=TIMEOUT)
            assert approve_resp.status_code == 200, f"Failed to approve purchase order: {approve_resp.text}"
            approve_data = approve_resp.json()
            approved_status = approve_data.get("status")
            assert approved_status and approved_status.lower() == "approved", f"PO not approved properly: {approved_status}"

        finally:
            # Cleanup created resources
            # Delete purchase order if exists
            if po_id:
                _ = requests.delete(f"{PURCHASE_ORDERS_URL}/{po_id}", headers=headers, timeout=TIMEOUT)
            # Delete purchase request if exists
            if pr_id:
                _ = requests.delete(f"{PURCHASE_REQUESTS_URL}/{pr_id}", headers=headers, timeout=TIMEOUT)
            # Delete item if exists
            if item_id:
                _ = requests.delete(f"{items_url}/{item_id}", headers=headers, timeout=TIMEOUT)

    except requests.RequestException as e:
        assert False, f"HTTP request failed: {str(e)}"


test_purchase_request_to_purchase_order_approval_flow()
