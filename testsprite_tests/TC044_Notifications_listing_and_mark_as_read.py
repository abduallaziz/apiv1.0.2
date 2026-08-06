import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
NOTIFICATIONS_URL = f"{BASE_URL}/notifications"
TIMEOUT = 30

def login(email: str, password: str, device_name: str) -> str:
    try:
        response = requests.post(
            LOGIN_URL,
            json={"email": email, "password": password, "device_name": device_name},
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
        access_token = data.get("access_token")
        assert access_token, "No access_token received on login"
        return access_token
    except requests.RequestException as e:
        raise RuntimeError(f"Login failed: {e}")

def test_notifications_listing_and_mark_as_read():
    email = "owner@sefay.com"
    password = "12345678"
    device_name = "test-device"
    token = login(email, password, device_name)
    headers = {"Authorization": f"Bearer {token}"}

    # Get notifications list
    try:
        resp = requests.get(NOTIFICATIONS_URL, headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        notifications = resp.json()
        assert isinstance(notifications, list), "Expected response to be a list of notifications"
    except requests.RequestException as e:
        raise RuntimeError(f"Failed to list notifications: {e}")

    if notifications:
        notif_id = notifications[0].get("id")
        assert notif_id, "Notification item missing 'id' field"

        # PATCH /notifications/:id/read to mark one as read
        try:
            patch_url = f"{NOTIFICATIONS_URL}/{notif_id}/read"
            patch_resp = requests.patch(patch_url, headers=headers, timeout=TIMEOUT)
            patch_resp.raise_for_status()
            assert patch_resp.status_code == 200, "Expected 200 for mark-as-read single notification"
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to mark notification as read: {e}")

    # PATCH /notifications/read-all to mark all as read
    try:
        patch_all_url = f"{NOTIFICATIONS_URL}/read-all"
        patch_all_resp = requests.patch(patch_all_url, headers=headers, timeout=TIMEOUT)
        patch_all_resp.raise_for_status()
        assert patch_all_resp.status_code == 200, "Expected 200 for mark-all-as-read"
    except requests.RequestException as e:
        raise RuntimeError(f"Failed to mark all notifications as read: {e}")

    # PATCH with missing notification ID expects 404
    try:
        missing_id = "00000000-0000-0000-0000-000000000000"
        patch_missing_url = f"{NOTIFICATIONS_URL}/{missing_id}/read"
        missing_resp = requests.patch(patch_missing_url, headers=headers, timeout=TIMEOUT)
        assert missing_resp.status_code == 404, f"Expected 404 for missing notification id, got {missing_resp.status_code}"
    except requests.RequestException as e:
        raise RuntimeError(f"Error during patching missing notification id: {e}")

test_notifications_listing_and_mark_as_read()