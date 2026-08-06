import requests

BASE_URL = "http://localhost:3001/api/v1"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
TIMEOUT = 30

def test_expense_validation_and_not_found_rejection():
    # Authenticate and get token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    login_resp = requests.post(f"{BASE_URL}/auth/login", json=login_payload, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    access_token = login_resp.json().get("access_token")
    assert access_token, "No access_token in login response"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # Test POST /api/v1/expenses with malformed amount expects 400
    malformed_expense_payload = {
        "amount": "invalid_amount",  # malformed amount as string instead of number
        "category_id": 1,  # assuming category_id is required, use 1 (typical valid id)
        "description": "Malformed amount test"
    }
    resp = requests.post(f"{BASE_URL}/expenses", json=malformed_expense_payload, headers=headers, timeout=TIMEOUT)
    assert resp.status_code == 400, f"Expected 400 for malformed amount, got {resp.status_code}, response: {resp.text}"

    # Test PATCH /api/v1/expenses/:id/reject for a non-existent expense expects 404
    non_existent_id = "00000000-0000-0000-0000-000000000000"
    reject_url = f"{BASE_URL}/expenses/{non_existent_id}/reject"
    reject_payload = {"reason": "Testing rejection reason"}
    patch_resp = requests.patch(reject_url, json=reject_payload, headers=headers, timeout=TIMEOUT)
    assert patch_resp.status_code == 404, f"Expected 404 for rejecting non-existent expense, got {patch_resp.status_code}, response: {patch_resp.text}"

test_expense_validation_and_not_found_rejection()