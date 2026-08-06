import requests
import time

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_ENDPOINT = f"{BASE_URL}/auth/login"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
RATE_LIMIT_THRESHOLD = 10
RATE_LIMIT_WINDOW = 60  # seconds
TIMEOUT = 30

def test_auth_login_rate_limit():
    headers = {
        "Content-Type": "application/json"
    }

    payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }

    received_429 = False
    last_response = None

    # Send requests more than the threshold within the time window to trigger rate limiting
    for attempt in range(RATE_LIMIT_THRESHOLD + 5):
        try:
            response = requests.post(LOGIN_ENDPOINT, headers=headers, json=payload, timeout=TIMEOUT)
            last_response = response
            # If within limit, expect 200 with token
            if attempt < RATE_LIMIT_THRESHOLD:
                assert response.status_code == 200, f"Expected 200 on attempt {attempt+1}, got {response.status_code}"
                json_response = response.json()
                assert "access_token" in json_response, f"No access_token in response on attempt {attempt+1}"
            else:
                # After threshold, expect eventually 429 - record if received
                if response.status_code == 429:
                    received_429 = True
                elif response.status_code == 200:
                    json_response = response.json()
                    assert "access_token" in json_response, f"No access_token in response on attempt {attempt+1}"
                else:
                    # Allow other status codes without failing here
                    pass
        except requests.RequestException as e:
            assert False, f"Request exception on attempt {attempt+1}: {e}"

    assert received_429, (
        f"Did not receive 429 Too Many Requests after {RATE_LIMIT_THRESHOLD} attempts. "
        f"Last status: {last_response.status_code if last_response else 'No response'}, "
        f"response body: {last_response.text if last_response else 'No response'}"
    )

test_auth_login_rate_limit()
