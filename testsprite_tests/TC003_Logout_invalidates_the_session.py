import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
LOGOUT_URL = f"{BASE_URL}/auth/logout"
SESSIONS_URL = f"{BASE_URL}/auth/sessions"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "TestDevice"

def test_logout_invalidates_session():
    try:
        # Step 1: Login to get access token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=30)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        login_data = login_resp.json()
        assert "access_token" in login_data, "No access_token in login response"
        access_token = login_data["access_token"]

        headers = {
            "Authorization": f"Bearer {access_token}"
        }

        # Step 2: Logout with valid access token
        logout_resp = requests.post(LOGOUT_URL, headers=headers, timeout=30)
        assert logout_resp.status_code == 200, f"Logout failed with status {logout_resp.status_code}"

        # Step 3: Subsequent GET sessions with same token should NOT allow use of non-revoked session
        sessions_resp = requests.get(SESSIONS_URL, headers=headers, timeout=30)

        if sessions_resp.status_code == 401:
            # Token is invalid as expected
            return
        elif sessions_resp.status_code == 200:
            sessions_data = sessions_resp.json()
            # Extract sessions list
            sessions_list = []
            if isinstance(sessions_data, list):
                sessions_list = sessions_data
            elif isinstance(sessions_data, dict):
                sessions_list = sessions_data.get("sessions") or sessions_data.get("data") or []
                if not isinstance(sessions_list, list):
                    sessions_list = []

            # Find the session with device_name == DEVICE_NAME
            current_session = None
            for session in sessions_list:
                if session.get("device_name") == DEVICE_NAME:
                    current_session = session
                    break
            assert current_session is not None, f"Current session with device_name '{DEVICE_NAME}' not found in sessions list"
            # Assert that current session is revoked
            assert current_session.get("is_revoked") == True, "Current session is not revoked after logout"
        else:
            assert False, f"Unexpected status code from sessions endpoint: {sessions_resp.status_code}"

    except requests.RequestException as e:
        assert False, f"HTTP request failed: {e}"


test_logout_invalidates_session()
