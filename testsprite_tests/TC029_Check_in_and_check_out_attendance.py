import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
CHECK_IN_URL = f"{BASE_URL}/attendance/check-in"
CHECK_OUT_URL = f"{BASE_URL}/attendance/check-out"
ATTENDANCE_ME_URL = f"{BASE_URL}/attendance/me"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-checkin"

def test_check_in_and_check_out_attendance():
    session = requests.Session()
    try:
        # Login to get access token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=30)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        access_token = login_data.get("access_token")
        assert access_token, "No access_token returned in login response"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        # Attempt to check out first to ensure a clean state
        session.post(CHECK_OUT_URL, headers=headers, timeout=30)  # Ignore failure if not checked in

        # POST /attendance/check-in expects 200
        check_in_resp = session.post(CHECK_IN_URL, headers=headers, timeout=30)
        assert check_in_resp.status_code == 200, f"Check-in failed: {check_in_resp.text}"
        check_in_json = check_in_resp.json()
        assert isinstance(check_in_json, dict), "Check-in response is not a JSON object"
        assert "id" in check_in_json and isinstance(check_in_json["id"], str), "Check-in response missing 'id' field"

        # GET /attendance/me expects 200 and contains attendance summary
        attendance_me_resp = session.get(ATTENDANCE_ME_URL, headers=headers, timeout=30)
        assert attendance_me_resp.status_code == 200, f"Get attendance summary failed: {attendance_me_resp.text}"
        attendance_me_json = attendance_me_resp.json()
        assert isinstance(attendance_me_json, dict), "Attendance summary response is not a JSON object"

        # POST /attendance/check-out expects 200
        check_out_resp = session.post(CHECK_OUT_URL, headers=headers, timeout=30)
        assert check_out_resp.status_code == 200, f"Check-out failed: {check_out_resp.text}"

    finally:
        session.close()

test_check_in_and_check_out_attendance()
