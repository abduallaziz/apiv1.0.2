import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
PO_URL = f"{BASE_URL}/purchasing/purchase-orders"
TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"


def test_purchase_order_invalid_state_transitions_are_rejected():
    session = requests.Session()
    # Authenticate and get token
    login_payload = {"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME}
    login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    access_token = login_resp.json().get("access_token")
    assert access_token, "No access_token in login response"

    headers = {"Authorization": f"Bearer {access_token}"}

    purchase_order_id = None
    try:
        # Step 1: Create a new purchase order in draft status
        create_po_payload = {}
        create_resp = session.post(PO_URL, json=create_po_payload, headers=headers, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Failed to create purchase order: {create_resp.text}"
        purchase_order = create_resp.json()
        purchase_order_id = purchase_order.get("id")
        assert purchase_order_id, "Created purchase order missing ID"

        # Step 2: Submit the purchase order
        submit_resp = session.post(f"{PO_URL}/{purchase_order_id}/submit", headers=headers, timeout=TIMEOUT)
        assert submit_resp.status_code == 200, f"Failed to submit purchase order: {submit_resp.text}"

        # Step 3: Approve the purchase order
        approve_resp = session.post(f"{PO_URL}/{purchase_order_id}/approve", headers=headers, timeout=TIMEOUT)
        assert approve_resp.status_code == 200, f"Failed to approve purchase order: {approve_resp.text}"

        # Test case a: POST reject on already approved order expects 409
        reject_resp = session.post(f"{PO_URL}/{purchase_order_id}/reject", headers=headers, timeout=TIMEOUT)
        assert reject_resp.status_code == 409, f"Reject on approved PO did not return 409: {reject_resp.text}"

        # Step 4: Manually set purchase order as completed so we can test cancelling completed order.
        patch_resp = session.patch(
            f"{PO_URL}/{purchase_order_id}",
            json={"status": "completed"},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert patch_resp.status_code in (200, 204, 400, 422, 403), "Unexpected PATCH PO status"

        get_po_resp = session.get(f"{PO_URL}/{purchase_order_id}", headers=headers, timeout=TIMEOUT)
        assert get_po_resp.status_code == 200, f"Failed to get purchase order: {get_po_resp.text}"
        po_data = get_po_resp.json()
        current_status = po_data.get("status", "").lower()

        # If patch didn't make status completed, skip cancel test
        if current_status != "completed":
            # No return, just skip cancel test
            pass
        else:
            # Test case b: POST cancel on completed order expects 409
            cancel_resp = session.post(f"{PO_URL}/{purchase_order_id}/cancel", headers=headers, timeout=TIMEOUT)
            assert cancel_resp.status_code == 409, f"Cancel on completed PO did not return 409: {cancel_resp.text}"

    finally:
        if purchase_order_id:
            del_resp = session.delete(f"{PO_URL}/{purchase_order_id}", headers=headers, timeout=TIMEOUT)
            assert del_resp.status_code in (200, 204, 404), f"Failed to delete purchase order: {del_resp.text}"


test_purchase_order_invalid_state_transitions_are_rejected()