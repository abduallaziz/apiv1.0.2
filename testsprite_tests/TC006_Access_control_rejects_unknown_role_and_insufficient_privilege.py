import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
TIMEOUT = 30

OWNER_EMAIL = "owner@sefay.com"
OWNER_PASSWORD = "12345678"
DEVICE_NAME = "test-device"

# Credentials for a low-privilege user token (assumed or fake)
LOW_PRIV_USER_EMAIL = "cashier@test.com"
LOW_PRIV_USER_PASSWORD = "cashierpass"
LOW_PRIV_DEVICE_NAME = "low-priv-device"

def login(email: str, password: str, device_name: str) -> str:
    resp = requests.post(
        LOGIN_URL,
        json={"email": email, "password": password, "device_name": device_name},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    json_data = resp.json()
    if "access_token" not in json_data:
        raise ValueError("Login response missing access_token")
    return json_data["access_token"]

def test_access_control_rejects_unknown_role_and_insufficient_privilege():
    # Login as owner (full permissions) and as low-privilege user
    owner_token = login(OWNER_EMAIL, OWNER_PASSWORD, DEVICE_NAME)
    low_priv_token = None
    try:
        low_priv_token = login(LOW_PRIV_USER_EMAIL, LOW_PRIV_USER_PASSWORD, LOW_PRIV_DEVICE_NAME)
    except (requests.HTTPError, ValueError):
        # If low-privilege user not existing, fallback to using the provided sample token
        # from instructions (role= cashier/low privilege)
        low_priv_token = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            "eyJzdWIiOiJ0ZXN0LWNhc2hpZXItaWQiLCJlbWFpbCI6ImNhc2hpZXJAdGVzdC5jb20iLCJyb2xlIjoiY2FzaGllciIsInRlbmFudF9pZCI6InRlc3QtdGVuYW50LWlkIiwic2Vzc2lvbl9pZCI6InRlc3Qtc2Vzc2lvbi1pZCIsImlhdCI6MTc4NTIwNTIyMiwiZXhwIjoxNzg1MjA4ODIyfQ.vZa97GTw4L-wUlHW7fhp85zuKkOmk7Jye6Mx64S7HBw"
        )

    headers_owner = {"Authorization": f"Bearer {owner_token}"}
    headers_low_priv = {"Authorization": f"Bearer {low_priv_token}"}

    # 1) GET /api/v1/access-control/roles/:roleId/permissions for a non-existent roleId expects 404
    fake_role_id = "00000000-0000-0000-0000-000000000000"
    get_permissions_url = f"{BASE_URL}/access-control/roles/{fake_role_id}/permissions"

    try:
        resp = requests.get(get_permissions_url, headers=headers_owner, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise AssertionError(f"Request failed: {e}")
    else:
        assert resp.status_code == 404, (
            f"Expected 404 for non-existent roleId permissions GET, got {resp.status_code}, response: {resp.text}"
        )

    # 2) DELETE /api/v1/access-control/roles/:roleId/permissions/:permissionKey using a low-privilege token expects 403
    # To test this, we need a valid roleId and a valid permissionKey

    # First get a valid roleId from owner context
    try:
        roles_resp = requests.get(f"{BASE_URL}/access-control/roles", headers=headers_owner, timeout=TIMEOUT)
        roles_resp.raise_for_status()
        roles = roles_resp.json()
        if not isinstance(roles, list) or len(roles) == 0:
            raise AssertionError("No roles available to test DELETE permission")
        # Pick first roleId
        valid_role_id = roles[0].get("id")
        if not valid_role_id:
            raise AssertionError("Could not find valid role ID field in roles response")
    except requests.RequestException as e:
        raise AssertionError(f"Failed to retrieve roles: {e}")

    # Get permissions from owner token to find a valid permissionKey
    try:
        permissions_resp = requests.get(f"{BASE_URL}/access-control/permissions", headers=headers_owner, timeout=TIMEOUT)
        permissions_resp.raise_for_status()
        permissions_list = permissions_resp.json()
        if not isinstance(permissions_list, list) or len(permissions_list) == 0:
            raise AssertionError("No permissions found to test DELETE permission endpoint")
        # Find first permission object with a string 'key' property
        permission_key = None
        for perm in permissions_list:
            if isinstance(perm, dict) and isinstance(perm.get("key"), str) and perm.get("key"):
                permission_key = perm["key"]
                break
        if not permission_key:
            raise AssertionError("Could not find valid permission key field in permissions response")
    except requests.RequestException as e:
        raise AssertionError(f"Failed to retrieve permissions: {e}")

    delete_permission_url = f"{BASE_URL}/access-control/roles/{valid_role_id}/permissions/{permission_key}"

    try:
        del_resp = requests.delete(delete_permission_url, headers=headers_low_priv, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise AssertionError(f"DELETE request failed: {e}")
    else:
        assert del_resp.status_code == 403, (
            f"Expected 403 Forbidden for low-privilege DELETE on role permission, got {del_resp.status_code}, response: {del_resp.text}"
        )

test_access_control_rejects_unknown_role_and_insufficient_privilege()
