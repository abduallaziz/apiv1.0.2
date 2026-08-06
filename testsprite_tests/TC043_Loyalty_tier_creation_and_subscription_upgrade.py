import requests

BASE_URL = "http://localhost:3001/api/v1"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"
TIMEOUT = 30


def test_loyalty_tier_creation_and_subscription_upgrade():
    session = requests.Session()
    try:
        # Authenticate and get token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = session.post(
            f"{BASE_URL}/auth/login", json=login_payload, timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {token}"}

        # Create a loyalty tier with correct payload as per API
        tier_payload = {
            "name": "Test Loyalty Tier",
            "min_lifetime_points": 0,
            "points_multiplier": 1.0
        }
        create_tier_resp = session.post(
            f"{BASE_URL}/loyalty-tiers", json=tier_payload, headers=headers, timeout=TIMEOUT
        )
        assert create_tier_resp.status_code == 201, f"Failed to create loyalty tier: {create_tier_resp.text}"
        tier_data = create_tier_resp.json()
        tier_id = tier_data.get("id")
        assert tier_id, "No tier ID returned after creation"

        # Get current subscription, expect 200
        current_sub_resp = session.get(
            f"{BASE_URL}/subscriptions/current", headers=headers, timeout=TIMEOUT
        )
        assert current_sub_resp.status_code == 200, f"Failed to get current subscription: {current_sub_resp.text}"

        # Attempt subscription upgrade without billing eligibility
        # Provide a valid UUID formatted string as plan_id to pass validation
        upgrade_payload = {
            "plan_id": "00000000-0000-0000-0000-000000000000"
        }
        upgrade_resp = session.post(
            f"{BASE_URL}/subscriptions/upgrade",
            json=upgrade_payload,
            headers=headers,
            timeout=TIMEOUT
        )
        assert upgrade_resp.status_code in (402, 409), (
            f"Expected 402 or 409 for upgrade without billing eligibility, "
            f"got {upgrade_resp.status_code}: {upgrade_resp.text}"
        )
    finally:
        # No defined DELETE endpoint for loyalty-tiers, so no cleanup
        pass


test_loyalty_tier_creation_and_subscription_upgrade()
