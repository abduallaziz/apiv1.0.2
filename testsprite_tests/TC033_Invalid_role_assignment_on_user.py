import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
USERS_ROLE_URL_TEMPLATE = f"{BASE_URL}/users/{{user_id}}/role"
LINKABLE_USERS_URL = f"{BASE_URL}/employees/linkable-users"
TIMEOUT = 30


def test_invalid_role_assignment_on_user():
    # Login to get access token
    login_payload = {
        "email": "owner@sefay.com",
        "password": "12345678",
        "device_name": "test-device"
    }
    try:
        login_response = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        login_response.raise_for_status()
        access_token = login_response.json().get("access_token")
        assert access_token, "No access_token found in login response"
    except Exception as e:
        assert False, f"Login failed: {e}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # Step 1: Create a new user to test role assignment (to get a valid user id)
    create_user_url = f"{BASE_URL}/users"
    user_create_payload = {
        "email": "testuser.invalidrole@example.com",
        "name": "Test User InvalidRole",
        "password": "TestPass123!",
        "password_confirmation": "TestPass123!",
        "role_id": "user"
    }
    user_id = None
    try:
        create_resp = requests.post(create_user_url, json=user_create_payload, headers=headers, timeout=TIMEOUT)
        create_resp.raise_for_status()
        user_data = create_resp.json()
        user_id = user_data.get("id")
        assert user_id, "User creation response missing user id"
    except Exception as e:
        assert False, f"Failed to create user for testing role assignment: {e}"

    try:
        # Step 2: PATCH /users/:id/role with a non-existent roleId (invalid roleId)
        invalid_role_id = "non-existent-role-id-1234567890"
        patch_url = USERS_ROLE_URL_TEMPLATE.format(user_id=user_id)
        patch_payload = {"roleId": invalid_role_id}

        patch_resp = requests.patch(patch_url, json=patch_payload, headers=headers, timeout=TIMEOUT)

        # Expect 404 or validation error (could be 404 or 400)
        assert patch_resp.status_code in (400, 404), \
            f"Expected 400 or 404 for invalid role assignment, got {patch_resp.status_code}"

        # Optional: check presence of expected error message in response JSON
        json_resp = patch_resp.json()
        error_keys = ["message", "error", "errors"]
        error_found = any(key in json_resp for key in error_keys)
        assert error_found, "Error message not found in response for invalid role assignment"

        # Step 3: GET /employees/linkable-users returns 200 and list of candidate users
        linkable_resp = requests.get(LINKABLE_USERS_URL, headers=headers, timeout=TIMEOUT)
        linkable_resp.raise_for_status()
        assert linkable_resp.status_code == 200, f"Expected 200 from linkable-users, got {linkable_resp.status_code}"
        linkable_json = linkable_resp.json()
        assert isinstance(linkable_json, list), "Expected list for linkable-users response"

    finally:
        # Clean up: delete the created user
        if user_id:
            delete_url = f"{BASE_URL}/users/{user_id}"
            try:
                del_resp = requests.delete(delete_url, headers=headers, timeout=TIMEOUT)
                # If delete fails, log but don't fail test
                if del_resp.status_code not in (200, 204):
                    print(f"Warning: Failed to delete test user {user_id}, status: {del_resp.status_code}")
            except Exception as ex:
                print(f"Warning: Exception deleting test user {user_id}: {ex}")


test_invalid_role_assignment_on_user()
