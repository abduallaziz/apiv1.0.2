import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
TIMEOUT = 30

def test_tc023_open_shift_create_invoice_view_invoice_detail():
    session = requests.Session()
    try:
        # Authenticate and get access token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = session.post(f"{BASE_URL}/auth/login", json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        access_token = login_resp.json().get("access_token")
        assert access_token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        
        # Get valid branch_id from branches list
        branches_resp = session.get(f"{BASE_URL}/branches", headers=headers, timeout=TIMEOUT)
        assert branches_resp.status_code == 200, f"Get branches failed: {branches_resp.text}"
        branches = branches_resp.json()
        assert isinstance(branches, list) and len(branches) > 0, "No branches available to open shift"
        branch_id = branches[0].get("id")
        assert branch_id, "Branch does not have an id"

        # Open a shift (POST /api/v1/shifts/open) expects 200
        open_shift_payload = {
            "branch_id": branch_id,
            "opening_cash": 0
        }
        open_shift_resp = session.post(f"{BASE_URL}/shifts/open", headers=headers, json=open_shift_payload, timeout=TIMEOUT)
        assert open_shift_resp.status_code == 200, f"Open shift failed: {open_shift_resp.text}"
        shift_data = open_shift_resp.json()
        shift_id = shift_data.get("id")
        assert shift_id is not None, "No shift id returned"

        # Create a valid invoice (POST /api/v1/invoices) expects 201
        invoice_payload = {
            "cart": {
                "items": [
                    {
                        "product_id": 1,
                        "quantity": 1,
                        "price": 100.0
                    }
                ],
                "total": 100.0
            },
            "payment": {
                "method": "cash",
                "amount": 100.0
            },
            "shift_id": shift_id
        }
        invoice_resp = session.post(f"{BASE_URL}/invoices", headers=headers, json=invoice_payload, timeout=TIMEOUT)
        assert invoice_resp.status_code == 201, f"Create invoice failed: {invoice_resp.text}"
        invoice_data = invoice_resp.json()
        invoice_id = invoice_data.get("id")
        assert invoice_id is not None, "No invoice id returned"

        # Get invoice details (GET /api/v1/invoices/:id) expects 200
        invoice_detail_resp = session.get(f"{BASE_URL}/invoices/{invoice_id}", headers=headers, timeout=TIMEOUT)
        assert invoice_detail_resp.status_code == 200, f"Get invoice detail failed: {invoice_detail_resp.text}"
        invoice_detail = invoice_detail_resp.json()
        assert invoice_detail.get("id") == invoice_id, "Invoice ID mismatch in detail"
        assert "cart" in invoice_detail, "Invoice detail missing cart field"
        assert "payment" in invoice_detail, "Invoice detail missing payment field"

    finally:
        # Clean up: close the opened shift if possible (to keep state clean)
        if 'shift_id' in locals():
            session.post(f"{BASE_URL}/shifts/{shift_id}/close", headers=headers, timeout=TIMEOUT)

test_tc023_open_shift_create_invoice_view_invoice_detail()
