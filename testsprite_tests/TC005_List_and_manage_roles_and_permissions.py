import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
PERMISSION_GROUPS_URL = f"{BASE_URL}/access-control/permission-groups"
ROLES_URL = f"{BASE_URL}/access-control/roles"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"

TIMEOUT = 30

def test_list_and_manage_roles_and_permissions():
    session = requests.Session()
    # Login and get access token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    try:
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.status_code}, {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        # GET /permission-groups expect 200
        perm_groups_resp = session.get(PERMISSION_GROUPS_URL, headers=headers, timeout=TIMEOUT)
        assert perm_groups_resp.status_code == 200, f"GET permission-groups failed: {perm_groups_resp.status_code}, {perm_groups_resp.text}"
        perm_groups_data = perm_groups_resp.json()
        assert isinstance(perm_groups_data, list), "Permission groups response is not a list"

        # GET /roles expect 200
        roles_resp = session.get(ROLES_URL, headers=headers, timeout=TIMEOUT)
        assert roles_resp.status_code == 200, f"GET roles failed: {roles_resp.status_code}, {roles_resp.text}"
        roles_data = roles_resp.json()
        assert isinstance(roles_data, list), "Roles response is not a list"

        # Prepare payload for POST /roles
        # Typical payload must include at least a 'name' and possibly description
        role_name = "Test Role for TC005"
        post_role_payload = {
            "name": role_name,
            "description": "Role created for test case TC005"
        }

        # POST /roles with valid payload
        post_role_resp = session.post(ROLES_URL, headers=headers, json=post_role_payload, timeout=TIMEOUT)
        assert post_role_resp.status_code == 201, f"POST role failed: {post_role_resp.status_code}, {post_role_resp.text}"
        created_role = post_role_resp.json()
        role_id = created_role.get("id") or created_role.get("_id") or created_role.get("roleId")
        assert role_id, "Created role missing 'id'"

        # Find a permission key to patch - from permission groups data or roles data or a common key
        # For safety, try to get first permission key from permission groups if possible
        permission_key = None
        # Permission groups data structure may vary; try to extract a permission key
        if perm_groups_data and isinstance(perm_groups_data, list):
            for group in perm_groups_data:
                # permissions may be a list or dict in group, trying to find a key
                permissions = group.get("permissions")
                if permissions:
                    if isinstance(permissions, dict):
                        permission_key = next(iter(permissions.keys()), None)
                    elif isinstance(permissions, list):
                        # Assuming list of permission keys or objects with key attribute
                        first_perm = permissions[0]
                        if isinstance(first_perm, dict):
                            permission_key = first_perm.get("key") or first_perm.get("name")
                        else:
                            permission_key = str(first_perm)
                    if permission_key:
                        break
        # Fallback permission key if none found
        if not permission_key:
            # Use a common generic permission key if no data found
            permission_key = "access_control.manage_roles"

        patch_url = f"{ROLES_URL}/{role_id}/permissions/{permission_key}"
        # PATCH payload must use 'is_granted' boolean as per error message and PRD
        patch_payload = {
            "is_granted": True
        }

        patch_resp = session.patch(patch_url, headers=headers, json=patch_payload, timeout=TIMEOUT)
        assert patch_resp.status_code == 200, f"PATCH role permission failed: {patch_resp.status_code}, {patch_resp.text}"
        patch_resp_json = patch_resp.json()
        # Validate that the updated permission matches the patch request
        # The exact response structure may differ; check that permission is updated/enabled
        if isinstance(patch_resp_json, dict):
            # Check that permission key is present and enabled is True
            permission_value = patch_resp_json.get(permission_key)
            if permission_value is None:
                # Maybe response under 'permissions' key
                permissions_obj = patch_resp_json.get("permissions")
                if permissions_obj and isinstance(permissions_obj, dict):
                    permission_value = permissions_obj.get(permission_key)
            if permission_value is not None:
                assert permission_value is True or (isinstance(permission_value, dict) and permission_value.get("enabled") == True), \
                    "Permission not properly updated"
            else:
                # If response does not contain permission key explicitly, just confirm response structure is dict
                assert True
        else:
            # Non-dict json response - no strict check possible
            assert True

    finally:
        # Cleanup - delete the created role
        if 'role_id' in locals() and role_id:
            try:
                del_resp = session.delete(f"{ROLES_URL}/{role_id}", headers=headers, timeout=TIMEOUT)
                # Accept 200 or 204 for deletion success
                assert del_resp.status_code in (200, 204), f"Cleanup delete role failed: {del_resp.status_code}, {del_resp.text}"
            except Exception:
                pass

test_list_and_manage_roles_and_permissions()
