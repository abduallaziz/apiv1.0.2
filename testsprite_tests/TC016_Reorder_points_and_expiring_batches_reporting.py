import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
REORDER_POINTS_URL = f"{BASE_URL}/inventory/reorder-points/below-minimum"
EXPIRING_BATCHES_URL = f"{BASE_URL}/inventory/reports/expiring-batches"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "automated-test-device"
TIMEOUT = 30


def test_reorder_points_and_expiring_batches_reporting():
    # Login to get access token
    login_payload = {"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME}
    try:
        login_resp = requests.post(
            LOGIN_URL,
            json=login_payload,
            timeout=TIMEOUT
        )
        login_resp.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Login request failed: {e}"

    login_data = login_resp.json()
    assert "access_token" in login_data and isinstance(login_data["access_token"], str), "Login response missing access_token"
    token = login_data["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # GET /inventory/reorder-points/below-minimum
    try:
        resp_reorder = requests.get(REORDER_POINTS_URL, headers=headers, timeout=TIMEOUT)
        resp_reorder.raise_for_status()
    except requests.RequestException as e:
        assert False, f"GET reorder points below minimum failed: {e}"

    assert resp_reorder.status_code == 200, f"Expected status 200 but got {resp_reorder.status_code}"
    reorder_data = resp_reorder.json()
    assert isinstance(reorder_data, list), "Reorder points response should be a list"
    # Optionally check elements shape if known (skipped as schema details not provided)

    # GET /inventory/reports/expiring-batches
    try:
        resp_expiring = requests.get(EXPIRING_BATCHES_URL, headers=headers, timeout=TIMEOUT)
        resp_expiring.raise_for_status()
    except requests.RequestException as e:
        assert False, f"GET expiring batches report failed: {e}"

    assert resp_expiring.status_code == 200, f"Expected status 200 but got {resp_expiring.status_code}"
    expiring_data = resp_expiring.json()
    assert isinstance(expiring_data, list), "Expiring batches response should be a list"
    # Optionally check elements shape if known (skipped as schema details not provided)"


test_reorder_points_and_expiring_batches_reporting()