import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
ITEM_URL = f"{BASE_URL}/items"
BARCODE_LOOKUP_URL = f"{BASE_URL}/item-barcodes/lookup"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
TIMEOUT = 30


def login_get_token():
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    response = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
    assert response.status_code == 200, f"Login failed with status {response.status_code}"
    data = response.json()
    access_token = data.get("access_token")
    assert access_token, "No access_token in login response"
    return access_token


def test_item_and_barcode_lookups_handle_not_found_cases():
    token = login_get_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    }

    # Test GET /api/v1/items/:id for a missing item expects 404
    missing_item_id = "00000000-0000-0000-0000-000000000000"  # UUID unlikely to exist
    item_response = requests.get(f"{ITEM_URL}/{missing_item_id}", headers=headers, timeout=TIMEOUT)
    assert item_response.status_code == 404, (
        f"Expected 404 for missing item, got {item_response.status_code}"
    )

    # Test GET /api/v1/item-barcodes/lookup/:barcode for unknown barcode expects 404 or empty result
    unknown_barcode = "UNKNOWNBARCODE1234567890"
    barcode_response = requests.get(f"{BARCODE_LOOKUP_URL}/{unknown_barcode}", headers=headers, timeout=TIMEOUT)
    # Accept 404 or 200 with empty data
    if barcode_response.status_code == 404:
        pass  # Expected not found via 404
    else:
        assert barcode_response.status_code == 200, (
            f"Expected 200 or 404 for unknown barcode, got {barcode_response.status_code}"
        )
        # Check if response content represents empty result (empty list or object)
        data = barcode_response.json()
        if isinstance(data, list):
            assert len(data) == 0, f"Expected empty list for unknown barcode, got {data}"
        elif isinstance(data, dict):
            # Check if dict is empty or contains indication of empty result
            assert not data or ("error" in data and data.get("error") is not None), (
                f"Expected empty dict or error for unknown barcode, got {data}"
            )
        else:
            assert False, f"Unexpected response datatype for unknown barcode: {type(data)}"


test_item_and_barcode_lookups_handle_not_found_cases()