import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
TRANSFERS_URL = f"{BASE_URL}/inventory/transfers"
TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"


def test_reject_transfer_received_before_dispatch():
    session = requests.Session()
    try:
        # Login and get token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        auth_data = login_resp.json()
        access_token = auth_data.get("access_token")
        assert access_token, "No access_token in login response"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        # Get warehouses
        wh_resp = session.get(f"{BASE_URL}/inventory/warehouses", headers=headers, timeout=TIMEOUT)
        assert wh_resp.status_code == 200, f"Failed to get warehouses: {wh_resp.text}"
        warehouses = wh_resp.json()
        assert isinstance(warehouses, list) and len(warehouses) >= 2, "Need at least two warehouses to create transfer"
        from_warehouse_id = warehouses[0]["id"]
        to_warehouse_id = warehouses[1]["id"]
        assert from_warehouse_id != to_warehouse_id, "Source and destination warehouses must differ"

        transfer_payload = {
            "from_warehouse_id": from_warehouse_id,
            "to_warehouse_id": to_warehouse_id,
            "items": [
                {
                    "item_id": "00000000-0000-0000-0000-000000000000",  # dummy UUID
                    "quantity": 1
                }
            ]
        }

        create_resp = session.post(TRANSFERS_URL, headers=headers, json=transfer_payload, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Failed to create transfer: {create_resp.text}"
        transfer = create_resp.json()
        transfer_id = transfer.get("id")
        assert transfer_id, "No transfer ID returned after creation"

        # Attempt to receive the transfer before dispatch (should fail with 409)
        receive_url = f"{TRANSFERS_URL}/{transfer_id}/receive"
        receive_resp = session.post(receive_url, headers=headers, timeout=TIMEOUT)
        assert receive_resp.status_code == 409, f"Expected 409 when receiving transfer before dispatch, got {receive_resp.status_code}"

    finally:
        # Cleanup: delete the created transfer to not leave test data
        if 'transfer_id' in locals():
            del_url = f"{TRANSFERS_URL}/{transfer_id}"
            try:
                session.delete(del_url, headers=headers, timeout=TIMEOUT)
            except Exception:
                pass


test_reject_transfer_received_before_dispatch()
