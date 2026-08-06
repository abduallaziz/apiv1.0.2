import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
ADJUST_APPROVE_URL = f"{BASE_URL}/inventory/adjustments/{{adjustment_id}}/approve"
LOGIN_TIMEOUT = 30
REQUEST_TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"


def login(email, password, device_name):
    payload = {
        "email": email,
        "password": password,
        "device_name": device_name
    }
    try:
        response = requests.post(LOGIN_URL, json=payload, timeout=LOGIN_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        assert "access_token" in data, "No access_token in login response"
        return data["access_token"]
    except requests.RequestException as e:
        raise RuntimeError(f"Login request failed: {str(e)}")
    except AssertionError as e:
        raise RuntimeError(f"Login response assertion error: {str(e)}")


def test_adjustment_approval_on_nonexistent_record():
    access_token = login(EMAIL, PASSWORD, DEVICE_NAME)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # Use a presumed non-existent adjustment id (UUID or integer string)
    non_existent_id = "00000000-0000-0000-0000-000000000000"
    url = ADJUST_APPROVE_URL.format(adjustment_id=non_existent_id)

    try:
        response = requests.post(url, headers=headers, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as e:
        raise RuntimeError(f"Adjustment approve request failed: {str(e)}")

    assert response.status_code == 404, (
        f"Expected status code 404 for non-existent adjustment approval, "
        f"got {response.status_code} with response body: {response.text}"
    )


test_adjustment_approval_on_nonexistent_record()