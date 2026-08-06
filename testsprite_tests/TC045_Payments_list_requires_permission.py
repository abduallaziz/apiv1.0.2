import requests
from requests.exceptions import RequestException

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
PAYMENTS_URL = f"{BASE_URL}/payments"

OWNER_CREDENTIALS = {
    "email": "owner@sefay.com",
    "password": "12345678",
    "device_name": "test-device"
}

# Token with insufficient permission (from instructions)
INSUFFICIENT_PERMISSION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LWNhc2hpZXItaWQiLCJlbWFpbCI6ImNhc2hpZXJAdGVzdC5jb20iLCJyb2xlIjoiY2FzaGllciIsInRlbmFudF9pZCI6InRlc3QtdGVuYW50LWlkIiwic2Vzc2lvbl9pZCI6InRlc3Qtc2Vzc2lvbi1pZCIsImlhdCI6MTc4NTIwNTIyMiwiZXhwIjoxNzg1MjA4ODIyfQ.vZa97GTw4L-wUlHW7fhp85zuKkOmk7Jye6Mx64S7HBw"


def test_payments_list_requires_permission():
    # Login as owner user with full permissions to get a valid token
    try:
        login_resp = requests.post(
            LOGIN_URL,
            json=OWNER_CREDENTIALS,
            timeout=30
        )
        login_resp.raise_for_status()
        login_data = login_resp.json()
        assert "access_token" in login_data, "No access_token in login response"
        valid_token = login_data["access_token"]
    except RequestException as e:
        assert False, f"Owner login request failed: {e}"
    except AssertionError:
        raise
    except Exception as e:
        assert False, f"Unexpected error during login: {e}"

    headers_insufficient = {
        "Authorization": f"Bearer {INSUFFICIENT_PERMISSION_TOKEN}"
    }
    headers_valid = {
        "Authorization": f"Bearer {valid_token}"
    }

    # Call GET /payments with token lacking permission -> expect 401 (authentication failure)
    try:
        resp_forbidden = requests.get(PAYMENTS_URL, headers=headers_insufficient, timeout=30)
    except RequestException as e:
        assert False, f"GET /payments with insufficient permission token request failed: {e}"
    assert resp_forbidden.status_code == 401, f"Expected 401 for insufficient permission token, got {resp_forbidden.status_code}"

    # Call GET /payments with valid token -> expect 200 and JSON list or object
    try:
        resp_ok = requests.get(PAYMENTS_URL, headers=headers_valid, timeout=30)
    except RequestException as e:
        assert False, f"GET /payments with valid token request failed: {e}"
    assert resp_ok.status_code == 200, f"Expected 200 for valid token, got {resp_ok.status_code}"
    # Validate JSON response structure is list or dict (depending on API, at least parseable)
    try:
        payments_data = resp_ok.json()
    except Exception as e:
        assert False, f"Response JSON decoding failed: {e}"
    assert isinstance(payments_data, (list, dict)), f"Expected list or dict in payments response, got {type(payments_data)}"


test_payments_list_requires_permission()