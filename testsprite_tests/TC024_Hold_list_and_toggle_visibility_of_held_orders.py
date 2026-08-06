import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
HELD_INVOICES_URL = f"{BASE_URL}/invoices/held"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-1234"


def test_hold_list_toggle_visibility_held_orders():
    timeout = 30
    session = requests.Session()

    # 1. Authenticate and obtain bearer token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    try:
        login_res = session.post(LOGIN_URL, json=login_payload, timeout=timeout)
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        token = login_res.json().get("access_token")
        assert token and isinstance(token, str), "No access_token in login response"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        held_invoice_id = None

        # 2. Create a held invoice (POST /invoices/held)
        # Since the PRD does not specify the held invoice payload schema,
        # create a minimal plausible held invoice payload with unique order data.
        # We include a unique reference to identify the test invoice.
        unique_ref = str(uuid.uuid4())
        held_invoice_payload = {
            "order_reference": unique_ref,
            "items": [
                {
                    "name": "Test Item",
                    "quantity": 1,
                    "price": 10.0
                }
            ],
            "customer": {
                "name": "Test Customer"
            }
        }

        create_res = session.post(HELD_INVOICES_URL, headers=headers, json=held_invoice_payload, timeout=timeout)
        assert create_res.status_code == 201, f"Create held invoice failed: {create_res.text}"
        created_invoice = create_res.json()
        held_invoice_id = created_invoice.get("id")
        assert held_invoice_id, "Created held invoice has no 'id' field"

        # 3. List held invoices (GET /invoices/held)
        list_res = session.get(HELD_INVOICES_URL, headers=headers, timeout=timeout)
        assert list_res.status_code == 200, f"List held invoices failed: {list_res.text}"
        invoices_list = list_res.json()
        assert isinstance(invoices_list, list), "Held invoices list is not an array"

        # Confirm that our created held invoice is present in the list (match by id)
        found = any(inv.get("id") == held_invoice_id for inv in invoices_list)
        assert found, "Created held invoice not found in the held invoices list"

        # 4. Toggle visibility of held invoice (PATCH /invoices/held/:id/visibility)
        # The PRD does not specify request body or exact toggle semantics,
        # so we send a PATCH with no body, expecting it to toggle visibility.
        toggle_url = f"{HELD_INVOICES_URL}/{held_invoice_id}/visibility"
        toggle_res = session.patch(toggle_url, headers=headers, timeout=timeout)
        assert toggle_res.status_code == 200, f"Toggle visibility failed: {toggle_res.text}"
        toggle_resp_json = toggle_res.json()

        # Check response: expect at least the invoice id and visibility status
        assert isinstance(toggle_resp_json, dict), "Toggle visibility response is not a JSON object"
        assert toggle_resp_json.get("id") == held_invoice_id, "Toggle visibility response id mismatch"
        assert "visible" in toggle_resp_json, "Toggle visibility response missing 'visible' field"
        assert isinstance(toggle_resp_json["visible"], bool), "'visible' field is not boolean"

    finally:
        # Cleanup: delete the created held invoice if it exists
        if 'held_invoice_id' in locals() and held_invoice_id:
            delete_url = f"{HELD_INVOICES_URL}/{held_invoice_id}"
            try:
                del_res = session.delete(delete_url, headers=headers, timeout=timeout)
                # Deletion might return 204 or 200; accept both without assertion
                if del_res.status_code not in (200, 204, 404):
                    print(f"Warning: unexpected status deleting held invoice {held_invoice_id}: {del_res.status_code}")
            except Exception as e:
                print(f"Warning: exception when deleting held invoice {held_invoice_id}: {e}")


test_hold_list_toggle_visibility_held_orders()