import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
LEAVES_URL = f"{BASE_URL}/leaves"
TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"

def test_leave_request_approve_reject_workflow():
    # Authenticate user and get token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    try:
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        login_resp.raise_for_status()
        token = login_resp.json().get("access_token")
        assert token is not None, "Access token not found in login response"
    except Exception as e:
        assert False, f"Login failed: {e}"

    headers = {
        "Authorization": f"Bearer {token}"
    }

    # 1. GET /leaves - list leave requests (expect 200)
    try:
        resp_list = requests.get(LEAVES_URL, headers=headers, timeout=TIMEOUT)
        resp_list.raise_for_status()
        leaves = resp_list.json()
        assert isinstance(leaves, list), "Leaves list response is not a list"
    except Exception as e:
        assert False, f"Failed to get leaves list: {e}"

    # If no leave requests exist, create one for testing approval/rejection
    leave_id = None
    # The PRD does not show a POST /leaves endpoint, so we'll try to find a leave to test with.
    # If none exists, this test cannot continue properly.
    if len(leaves) == 0:
        assert False, "No leave requests available to test approval/rejection workflow"

    leave_id = leaves[0].get("id")
    assert leave_id is not None, "Leave ID missing in leave request item"

    # 2. PATCH /leaves/:id/approve - approve leave request (expect 200)
    try:
        approve_url = f"{LEAVES_URL}/{leave_id}/approve"
        resp_approve = requests.patch(approve_url, headers=headers, timeout=TIMEOUT)
        resp_approve.raise_for_status()
        approve_data = resp_approve.json()
        # Check key presence or typical approval status, if possible
        # We do not know exact schema, so at minimum check 200 and presence of id
        assert approve_data.get("id") == leave_id, "Approved leave ID mismatch"
    except Exception as e:
        assert False, f"Failed to approve leave request: {e}"

    # 3. PATCH /leaves/:id/reject on already processed request
    # Should return 200 or 409 depending on state
    reject_url = f"{LEAVES_URL}/{leave_id}/reject"
    try:
        resp_reject = requests.patch(reject_url, headers=headers, timeout=TIMEOUT)
        # The response can be 200 or 409
        if resp_reject.status_code not in (200, 409):
            assert False, f"Unexpected status code on rejecting processed leave: {resp_reject.status_code}"
    except requests.HTTPError as e:
        # If HTTPError not handled above; treat as failure unless 409
        if e.response is not None and e.response.status_code == 409:
            pass  # accepted error case
        else:
            assert False, f"HTTP error occurred during leave reject: {e}"
    except Exception as e:
        assert False, f"Unexpected error during leave reject: {e}"


test_leave_request_approve_reject_workflow()