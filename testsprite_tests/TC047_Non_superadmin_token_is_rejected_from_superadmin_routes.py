import requests

BASE_URL = "http://localhost:3001/api/v1"

def test_non_superadmin_token_rejected_from_superadmin_routes():
    login_url = f"{BASE_URL}/auth/login"
    superadmin_tenants_url = f"{BASE_URL}/superadmin/tenants"
    login_payload = {
        "email": "owner@sefay.com",
        "password": "12345678",
        "device_name": "test-device"
    }
    timeout_secs = 30

    try:
        # Step 1: Login with regular tenant-scoped user (owner role)
        login_resp = requests.post(login_url, json=login_payload, timeout=timeout_secs)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        token = login_resp.json().get("access_token")
        assert token, "access_token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }

        # Step 2: Attempt GET /superadmin/tenants with regular tenant-scoped JWT
        response = requests.get(superadmin_tenants_url, headers=headers, timeout=timeout_secs)

        # Expect a 403 Forbidden status code
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"

    except requests.RequestException as e:
        assert False, f"RequestException occurred: {e}"

test_non_superadmin_token_rejected_from_superadmin_routes()