import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
CUSTOMERS_URL = f"{BASE_URL}/customers"
CUSTOMER_FIELD_DEFS_URL = f"{BASE_URL}/customer-field-definitions"
TIMEOUT = 30

def test_customer_not_found_and_invalid_custom_field_schema():
    # Login
    login_payload = {
        "email": "owner@sefay.com",
        "password": "12345678",
        "device_name": "test-device"
    }
    try:
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        login_resp.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Login failed: {e}"
    token = login_resp.json().get("access_token")
    assert token and isinstance(token, str), "No access_token received on login"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # Test GET /customers/:id for unknown ID, expect 404
    unknown_customer_id = "00000000-0000-0000-0000-000000000000"
    try:
        get_resp = requests.get(f"{CUSTOMERS_URL}/{unknown_customer_id}", headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"GET customer request failed: {e}"
    assert get_resp.status_code == 404, f"Expected 404 for unknown customer id, got {get_resp.status_code}"

    # Test POST /customer-field-definitions with invalid schema, expect 400
    # Compose invalid payload - for example missing required 'field_name' or invalid field type
    invalid_field_schema = {
        # Omitting required 'field_name' or using invalid schema properties
        "field_type": "unsupported_type",  # Invalid type
        "required": "not_a_boolean"  # Invalid type, should be boolean
    }
    try:
        post_resp = requests.post(CUSTOMER_FIELD_DEFS_URL, headers=headers, json=invalid_field_schema, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"POST customer-field-definitions request failed: {e}"
    assert post_resp.status_code == 400, f"Expected 400 for invalid customer field schema, got {post_resp.status_code}"

test_customer_not_found_and_invalid_custom_field_schema()