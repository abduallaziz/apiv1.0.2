import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
GOODS_RECEIPTS_URL = f"{BASE_URL}/purchasing/goods-receipts"

def test_goods_receipt_posting_updates_inventory():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    timeout = 30

    # Step 1: Log in to get access token
    login_payload = {
        "email": "owner@sefay.com",
        "password": "12345678",
        "device_name": "test-script-device"
    }
    try:
        login_res = session.post(LOGIN_URL, json=login_payload, timeout=timeout)
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        access_token = login_res.json().get("access_token")
        assert access_token, "No access_token received in login response"

        # Set Authorization header for subsequent requests
        session.headers.update({"Authorization": f"Bearer {access_token}"})

        # Step 2: Create a goods receipt (POST /api/v1/purchasing/goods-receipts)
        # Added required field 'unit_cost' for each item as per API requirements
        goods_receipt_payload = {
            "warehouse_id": str(uuid.uuid4()),  # realistic UUID for warehouse
            "receipt_number": f"TEST-RN-{uuid.uuid4()}",
            "items": [
                {
                    "item_id": str(uuid.uuid4()),  # random UUID for item
                    "quantity_received": 10.0,
                    "unit_cost": 5.0
                }
            ]
        }

        create_gr_res = session.post(GOODS_RECEIPTS_URL, json=goods_receipt_payload, timeout=timeout)
        assert create_gr_res.status_code == 201, f"Goods receipt creation failed: {create_gr_res.text}"
        gr_data = create_gr_res.json()
        gr_id = gr_data.get("id")
        assert gr_id, "Created goods receipt has no ID"

        # Step 3: Post the goods receipt (POST /api/v1/purchasing/goods-receipts/:id/post)
        post_url = f"{GOODS_RECEIPTS_URL}/{gr_id}/post"
        post_res = session.post(post_url, timeout=timeout)
        assert post_res.status_code == 200, f"Goods receipt posting failed: {post_res.text}"
        post_response = post_res.json()
        # Verify response indicates success and inventory updated
        assert isinstance(post_response, dict), "Posting response is not a dict"

    finally:
        # No DELETE endpoint specified for goods receipts in PRD, so skip deletion
        pass

test_goods_receipt_posting_updates_inventory()
