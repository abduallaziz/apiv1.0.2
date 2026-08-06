import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
CHECKIN_URL = f"{BASE_URL}/attendance/check-in"
CHECKOUT_URL = f"{BASE_URL}/attendance/check-out"
EXCEPTIONS_URL = f"{BASE_URL}/attendance/exceptions"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "pytest-device"

TIMEOUT = 30


def test_TC030_attendance_exception_for_geofence_violation():
    # Login and get access token
    try:
        login_resp = requests.post(
            LOGIN_URL,
            json={"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME},
            timeout=TIMEOUT,
        )
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        access_token = login_resp.json().get("access_token")
        assert access_token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {access_token}"}

        # First ensure checked out before running the test
        checkout_resp = requests.post(
            CHECKOUT_URL, headers=headers, timeout=TIMEOUT
        )
        # Accept 200 OK, 201 Created, or 409 conflict if no active check-in
        assert checkout_resp.status_code in (200, 201, 409), f"Failed to check out before test: {checkout_resp.status_code}, {checkout_resp.text}"

        # Attempt check-in from outside geofence (simulate by sending invalid location data)
        checkin_payload = {
            "location": {"latitude": 0.0, "longitude": 0.0},
            "timestamp": "2026-07-28T12:00:00Z"
        }

        checkin_resp = requests.post(
            CHECKIN_URL, headers=headers, json=checkin_payload, timeout=TIMEOUT
        )

        # Expect 403 Forbidden or other indication that exception is required
        assert (
            checkin_resp.status_code == 403 or checkin_resp.status_code == 422
        ), f"Expected 403 or exception-required response, got {checkin_resp.status_code}: {checkin_resp.text}"

        response_json = {}
        try:
            response_json = checkin_resp.json()
        except Exception:
            pass
        exception_required = (
            "exception" in response_json.get("message", "").lower()
            or "geofence" in response_json.get("message", "").lower()
        )
        assert (
            checkin_resp.status_code == 403 or exception_required
        ), "Response does not indicate geofence violation or exception requirement"

        # Now create an attendance exception with details
        exception_payload = {
            "reason": "Checked in from outside configured geofence",
            "timestamp": "2026-07-28T12:00:00Z",
            "details": "Simulated check-in attempt from unauthorized location"
        }

        exception_resp = requests.post(
            EXCEPTIONS_URL, headers=headers, json=exception_payload, timeout=TIMEOUT
        )
        assert (
            exception_resp.status_code == 201
        ), f"Failed to create attendance exception: {exception_resp.status_code}, {exception_resp.text}"

        exception_data = exception_resp.json()
        assert "id" in exception_data or "exceptionId" in exception_data, "No ID found in exception creation response"

    except requests.RequestException as e:
        assert False, f"Request exception occurred: {e}"


test_TC030_attendance_exception_for_geofence_violation()
