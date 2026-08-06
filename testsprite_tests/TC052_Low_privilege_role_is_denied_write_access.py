import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
ITEMS_URL = f"{BASE_URL}/items"
TIMEOUT = 30

# Credentials for a low-privilege user (cashier) without items.manage permission
LOW_PRIV_CREDENTIALS = {
    "email": "cashier@test.com",
    "password": "cashierpassword",
    "device_name": "test-device"
}

def test_low_privilege_role_write_access_denied():
    """
    Using a low-privilege role account (cashier) without items.manage permission,
    call POST /api/v1/items and expect 403 Forbidden response.
    """
    # First, log in to get a valid token
    try:
        login_response = requests.post(LOGIN_URL, json=LOW_PRIV_CREDENTIALS, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request to POST /auth/login failed unexpectedly: {e}"

    assert login_response.status_code == 200, f"Login failed with status {login_response.status_code}, response text: {login_response.text}"
    login_data = login_response.json()
    token = login_data.get("access_token") or login_data.get("accessToken") or login_data.get("token")
    assert token, "Login response missing access token"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # Example minimal valid item payload (based on typical item data)
    item_payload = {
        "name": "Test Item Forbidden",
        "description": "Should not be allowed to create",
        "price": 9.99,
        "sku": "TESTSKU123",
        "category_id": None,
        "brand_id": None,
        "unit_id": None,
        "is_active": True
    }

    try:
        response = requests.post(ITEMS_URL, json=item_payload, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request to POST /items failed unexpectedly: {e}"

    # Assert response status code is 403 Forbidden
    assert response.status_code == 403, f"Expected 403 Forbidden, got {response.status_code}, response text: {response.text}"


test_low_privilege_role_write_access_denied()
