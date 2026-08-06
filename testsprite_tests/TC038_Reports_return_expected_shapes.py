import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
REPORTS = [
    "revenue",
    "tax",
    "recent-activity"
]
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "pytest-device"

def test_reports_return_expected_shapes():
    try:
        # Step 1: Login to get access token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=30)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        access_token = login_data.get("access_token")
        assert access_token, "No access_token in login response"

        headers = {
            "Authorization": f"Bearer {access_token}"
        }

        # Step 2: For each report endpoint, GET and validate
        for report in REPORTS:
            url = f"{BASE_URL}/reports/{report}"
            resp = requests.get(url, headers=headers, timeout=30)
            assert resp.status_code == 200, f"GET {url} failed with status {resp.status_code}"
            data = resp.json()
            assert isinstance(data, dict), f"Report {report} data is not a dict"
            # Basic check: data should not be empty
            assert data, f"Report {report} returned empty data"

    except requests.RequestException as e:
        assert False, f"RequestException occurred: {e}"

test_reports_return_expected_shapes()