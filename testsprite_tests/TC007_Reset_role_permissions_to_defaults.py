import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
ROLES_URL = f"{BASE_URL}/access-control/roles"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "pytest-device"


def test_reset_role_permissions_to_defaults():
    session = requests.Session()
    timeout = 30

    # Authenticate to get access token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }

    try:
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=timeout)
        assert login_resp.status_code == 200, f"Login failed with {login_resp.status_code}"
        login_json = login_resp.json()
        access_token = login_json.get("access_token")
        assert access_token, "No access_token in login response"

        headers = {
            "Authorization": f"Bearer {access_token}"
        }

        # Get list of roles to find a valid roleId
        roles_resp = session.get(ROLES_URL, headers=headers, timeout=timeout)
        assert roles_resp.status_code == 200, f"Failed to get roles list: {roles_resp.status_code}"
        roles = roles_resp.json()
        assert isinstance(roles, list), "Roles response is not a list"
        assert len(roles) > 0, "No roles found in system"

        role_id = roles[0].get("id")
        assert role_id, "Role object missing 'id'"

        # POST reset permissions to defaults
        reset_url = f"{ROLES_URL}/{role_id}/reset"
        reset_resp = session.post(reset_url, headers=headers, timeout=timeout)
        assert reset_resp.status_code == 200, f"Reset role permissions failed: {reset_resp.status_code}"

        # GET assigned users for the role
        users_url = f"{ROLES_URL}/{role_id}/users"
        users_resp = session.get(users_url, headers=headers, timeout=timeout)
        assert users_resp.status_code == 200, f"Failed to get users assigned to role: {users_resp.status_code}"
        users_json = users_resp.json()
        assert isinstance(users_json, list), "Users response is not a list"

    finally:
        session.close()


test_reset_role_permissions_to_defaults()