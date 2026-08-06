import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
INVOICES_URL = f"{BASE_URL}/invoices"
SHIFTS_OPEN_URL = f"{BASE_URL}/shifts/open"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-001"

TIMEOUT = 30

def test_cancel_invoice_and_verify_status():
    session = requests.Session()
    access_token = None

    def auth_headers(token):
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 1. Login to get access_token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    access_token = login_resp.json().get("access_token")
    assert access_token, "No access_token returned on login"

    headers = auth_headers(access_token)

    # Helper to create a shift if none exists (to be able to create invoice)
    def open_shift():
        # Need to provide valid branch_id and opening_cash
        # Fetch list of branches to get a valid branch_id
        branches_resp = session.get(f"{BASE_URL}/branches", headers=headers, timeout=TIMEOUT)
        assert branches_resp.status_code == 200, f"Failed to get branches: {branches_resp.text}"
        branches = branches_resp.json()
        assert isinstance(branches, list) and branches, "No branches available to open shift"

        branch_id = branches[0].get("id")
        assert branch_id, "Branch has no id"

        payload = {
            "branch_id": branch_id,
            "opening_cash": 0
        }

        resp = session.post(SHIFTS_OPEN_URL, headers=headers, json=payload, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Open shift failed: {resp.text}"
        shift_data = resp.json()
        shift_id = shift_data.get("id")
        assert shift_id, "No shift id in response"
        return shift_id

    # Helper to create a cancellable invoice
    def create_invoice():
        # Minimal valid invoice payload; assume shift_id required and cart + payment details required
        shift_id = open_shift()

        # A sample cart with 1 product with minimal valid fields
        cart = {
            "items": [
                {
                    "item_id": str(uuid.uuid4()),  # dummy uuid, real item_id needed but we use a placeholder
                    "quantity": 1,
                    "unit_price": 10.0
                }
            ],
            "total": 10.0
        }
        payment = {
            "method": "cash",
            "amount": 10.0
        }
        invoice_payload = {
            "shift_id": shift_id,
            "cart": cart,
            "payment": payment
        }
        resp = session.post(INVOICES_URL, headers=headers, json=invoice_payload, timeout=TIMEOUT)
        if resp.status_code == 400:
            # Possible the dummy item_id is invalid, try to fetch an actual item_id by listing items
            items_resp = session.get(f"{BASE_URL}/items", headers=headers, timeout=TIMEOUT)
            assert items_resp.status_code == 200, f"Failed to get items: {items_resp.text}"
            items = items_resp.json()
            if isinstance(items, list) and items:
                invoice_payload["cart"]["items"][0]["item_id"] = items[0].get("id")
            else:
                raise AssertionError("No items available to create invoice")
            resp = session.post(INVOICES_URL, headers=headers, json=invoice_payload, timeout=TIMEOUT)
        assert resp.status_code == 201, f"Create invoice failed: {resp.text}"
        invoice_data = resp.json()
        invoice_id = invoice_data.get("id")
        assert invoice_id, "No invoice id returned"
        return invoice_id

    invoice_id = None
    try:
        invoice_id = create_invoice()

        # 2. Cancel the invoice: PATCH /invoices/:id/cancel expects 200
        cancel_url = f"{INVOICES_URL}/{invoice_id}/cancel"
        cancel_resp = session.patch(cancel_url, headers=headers, timeout=TIMEOUT)
        assert cancel_resp.status_code == 200, f"Invoice cancel failed: {cancel_resp.text}"

        # 3. Verify invoice status = cancelled via GET /invoices/:id
        get_url = f"{INVOICES_URL}/{invoice_id}"
        get_resp = session.get(get_url, headers=headers, timeout=TIMEOUT)
        assert get_resp.status_code == 200, f"Get invoice failed: {get_resp.text}"
        invoice = get_resp.json()
        status = invoice.get("status") or invoice.get("state") or invoice.get("invoice_status") or invoice.get("status_code")
        # We do not have exact field name from PRD, but "status" is typical
        assert status is not None, "Invoice status field missing in response"
        # Check status implies cancelled
        cancelled_values = {"cancelled", "canceled", "void", "cancel", "cancelled_invoice"}
        assert str(status).lower() in cancelled_values, f"Invoice status is not cancelled, got: {status}"

    finally:
        # Cleanup: Try to delete the invoice if API allows, else ignore
        if invoice_id:
            try:
                del_resp = session.delete(f"{INVOICES_URL}/{invoice_id}", headers=headers, timeout=TIMEOUT)
                if del_resp.status_code not in (200, 204, 404):
                    # Log but do not raise
                    print(f"Warning: failed to delete invoice {invoice_id}: {del_resp.status_code} {del_resp.text}")
            except Exception as e:
                print(f"Warning: exception deleting invoice {invoice_id}: {e}")


test_cancel_invoice_and_verify_status()
