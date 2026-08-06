import requests

BASE_URL = "http://localhost:3001/api/v1"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
TIMEOUT = 30


def test_invalid_invoice_payload_and_closed_shift_close_are_rejected():
    # Authenticate and get token
    login_url = f"{BASE_URL}/auth/login"
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    try:
        login_resp = requests.post(login_url, json=login_payload, timeout=TIMEOUT)
        login_resp.raise_for_status()
    except requests.RequestException as e:
        raise AssertionError(f"Login request failed: {e}")
    login_data = login_resp.json()
    assert "access_token" in login_data and isinstance(login_data["access_token"], str), "No access_token in login response"
    access_token = login_data["access_token"]
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # 1) POST /api/v1/invoices with invalid/incomplete cart data expects 400
    invoices_url = f"{BASE_URL}/invoices"
    invalid_invoice_payload = {
        # Intentionally invalid/incomplete cart data - empty or missing required fields
        # Since schema not fully detailed, use empty or minimal invalid structure
        # For instance, missing 'cart' or 'items' field
        "cart": [],  # empty cart or invalid content
        "payment": {}  # empty payment info
    }
    inv_resp = requests.post(invoices_url, json=invalid_invoice_payload, headers=headers, timeout=TIMEOUT)
    assert inv_resp.status_code == 400, f"Expected 400 for invalid invoice payload, got {inv_resp.status_code}"

    # 2) POST /api/v1/shifts/:id/close on an already-closed shift expects 409

    # First: open a shift to get a valid shift id
    shifts_open_url = f"{BASE_URL}/shifts/open"
    valid_shift_payload = {"shift_start": "2024-01-01T08:00:00Z"}
    try:
        open_resp = requests.post(shifts_open_url, json=valid_shift_payload, headers=headers, timeout=TIMEOUT)
        open_resp.raise_for_status()
    except requests.RequestException as e:
        raise AssertionError(f"Shift open request failed: {e}")
    open_data = open_resp.json()
    assert "id" in open_data and isinstance(open_data["id"], (int, str)), "No shift id in open shift response"
    shift_id = str(open_data["id"])

    shift_close_url = f"{BASE_URL}/shifts/{shift_id}/close"

    try:
        # Close the shift first time: expect success (200)
        close_resp_1 = requests.post(shift_close_url, headers=headers, timeout=TIMEOUT)
        close_resp_1.raise_for_status()
    except requests.RequestException as e:
        raise AssertionError(f"Shift close first request failed: {e}")

    # Close the shift second time, should return 409 conflict
    close_resp_2 = requests.post(shift_close_url, headers=headers, timeout=TIMEOUT)
    assert close_resp_2.status_code == 409, f"Expected 409 for closing already closed shift, got {close_resp_2.status_code}"


test_invalid_invoice_payload_and_closed_shift_close_are_rejected()
