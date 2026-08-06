import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_ENDPOINT = f"{BASE_URL}/auth/login"
REFRESH_ENDPOINT = f"{BASE_URL}/auth/refresh"
TIMEOUT = 30

def test_reject_invalid_login_credentials():
    # Attempt login with wrong password
    wrong_password_payload = {
        "email": "owner@sefay.com",
        "password": "wrong_password",
        "device_name": "test-device"
    }

    try:
        login_response = requests.post(LOGIN_ENDPOINT, json=wrong_password_payload, timeout=TIMEOUT)
        assert login_response.status_code == 401, f"Expected 401 Unauthorized for bad login, got {login_response.status_code}"
    except requests.RequestException as e:
        assert False, f"Login request failed: {e}"

    # Attempt refresh without refresh-token cookie
    try:
        refresh_response = requests.post(REFRESH_ENDPOINT, timeout=TIMEOUT)
        assert refresh_response.status_code == 401, f"Expected 401 Unauthorized for refresh without cookie, got {refresh_response.status_code}"
    except requests.RequestException as e:
        assert False, f"Refresh request failed: {e}"

test_reject_invalid_login_credentials()