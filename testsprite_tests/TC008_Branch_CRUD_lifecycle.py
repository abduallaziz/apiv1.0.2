import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
BRANCHES_URL = f"{BASE_URL}/branches"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
TIMEOUT = 30

def test_branch_crud_lifecycle():
    # Login and get bearer token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    try:
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {token}"}

        # Create a branch (POST /branches)
        create_payload = {
            "name": "Test Branch",
            "address": "123 Test St."
        }
        create_resp = requests.post(BRANCHES_URL, json=create_payload, headers=headers, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Branch creation failed: {create_resp.text}"
        branch_data = create_resp.json()
        branch_id = branch_data.get("id")
        assert branch_id, "Created branch missing id"

        try:
            # List all branches and check the created branch is present (GET /branches)
            list_resp = requests.get(BRANCHES_URL, headers=headers, timeout=TIMEOUT)
            assert list_resp.status_code == 200, f"Listing branches failed: {list_resp.text}"
            branches = list_resp.json()
            assert any(b.get("id") == branch_id for b in branches), "Created branch not found in branch list"

            # Update the branch (PATCH /branches/:id)
            update_payload = {
                "name": "Updated Test Branch"
            }
            patch_url = f"{BRANCHES_URL}/{branch_id}"
            patch_resp = requests.patch(patch_url, json=update_payload, headers=headers, timeout=TIMEOUT)
            assert patch_resp.status_code == 200, f"Branch update failed: {patch_resp.text}"
            updated_data = patch_resp.json()
            assert updated_data.get("name") == update_payload["name"], "Branch name not updated"

            # Delete the branch (DELETE /branches/:id)
            delete_resp = requests.delete(patch_url, headers=headers, timeout=TIMEOUT)
            assert delete_resp.status_code == 204 or delete_resp.status_code == 200, f"Branch deletion failed: {delete_resp.text}"

            # Confirm deletion: GET /branches/:id returns 404
            get_deleted_resp = requests.get(patch_url, headers=headers, timeout=TIMEOUT)
            assert get_deleted_resp.status_code == 404, f"Deleted branch still accessible: {get_deleted_resp.text}"

        finally:
            # Cleanup: ensure branch is deleted in case test failed before delete step
            requests.delete(f"{BRANCHES_URL}/{branch_id}", headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"HTTP request failed: {str(e)}"

test_branch_crud_lifecycle()
