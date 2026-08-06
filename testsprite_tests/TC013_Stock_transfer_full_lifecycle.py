import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
TRANSFERS_URL = f"{BASE_URL}/inventory/transfers"
WAREHOUSES_URL = f"{BASE_URL}/inventory/warehouses"
ITEMS_URL = f"{BASE_URL}/items"
TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-stock-transfer"

def test_stock_transfer_full_lifecycle():
    session = requests.Session()
    try:
        # Step 1: Authenticate and get Bearer token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME,
        }
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        access_token = login_resp.json().get("access_token")
        assert access_token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

        # Step 2: Get list of warehouses to find source and destination
        wh_resp = session.get(WAREHOUSES_URL, headers=headers, timeout=TIMEOUT)
        assert wh_resp.status_code == 200, f"Get warehouses failed: {wh_resp.text}"
        warehouses = wh_resp.json()
        assert isinstance(warehouses, list) and len(warehouses) >= 2, "Need at least two warehouses to test transfer"

        source_warehouse = warehouses[0]
        dest_warehouse = warehouses[1]

        # Step 3: Get a valid item_id from items catalog
        items_resp = session.get(ITEMS_URL, headers=headers, timeout=TIMEOUT)
        assert items_resp.status_code == 200, f"Get items failed: {items_resp.text}"
        items = items_resp.json()
        assert isinstance(items, list) and len(items) > 0, "No items found to use in transfer"
        item_id = items[0].get("id")
        assert item_id, "Item has no id"

        # Step 4: Create transfer between warehouses (POST /inventory/transfers)
        transfer_payload = {
            "from_warehouse_id": source_warehouse.get("id"),
            "to_warehouse_id": dest_warehouse.get("id"),
            "transfer_number": str(uuid.uuid4()),
            "items": [
                {
                    "item_id": item_id,
                    "quantity": 1
                }
            ]
        }
        create_resp = session.post(TRANSFERS_URL, headers=headers, json=transfer_payload, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Create transfer failed: {create_resp.text}"
        transfer = create_resp.json()
        transfer_id = transfer.get("id")
        assert transfer_id, "No transfer id returned on creation"

        try:
            # Step 5: Approve the created transfer (POST /inventory/transfers/:id/approve)
            approve_url = f"{TRANSFERS_URL}/{transfer_id}/approve"
            approve_resp = session.post(approve_url, headers=headers, timeout=TIMEOUT)
            assert approve_resp.status_code == 200, f"Approve transfer failed: {approve_resp.text}"

            # Step 6: Dispatch the approved transfer (POST /inventory/transfers/:id/dispatch)
            dispatch_url = f"{TRANSFERS_URL}/{transfer_id}/dispatch"
            dispatch_resp = session.post(dispatch_url, headers=headers, timeout=TIMEOUT)
            assert dispatch_resp.status_code == 200, f"Dispatch transfer failed: {dispatch_resp.text}"

            # Step 7: Receive the dispatched transfer (POST /inventory/transfers/:id/receive)
            receive_url = f"{TRANSFERS_URL}/{transfer_id}/receive"
            receive_resp = session.post(receive_url, headers=headers, timeout=TIMEOUT)
            assert receive_resp.status_code == 200, f"Receive transfer failed: {receive_resp.text}"

        finally:
            # Cleanup: Delete the transfer if possible (not specified in PRD)
            pass

    finally:
        session.close()

test_stock_transfer_full_lifecycle()
