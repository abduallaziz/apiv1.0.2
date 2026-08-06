import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
TIMEOUT = 30

def test_superadmin_analytics_auditlogs_queues_health():
    try:
        # Step 1: Login to get bearer token with owner (superadmin) role
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": "test-device"
        }
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        access_token = login_data.get("access_token")
        assert access_token and isinstance(access_token, str), "access_token missing or invalid"

        headers = {"Authorization": f"Bearer {access_token}"}

        # Step 2: GET /superadmin/analytics/summary
        analytics_url = f"{BASE_URL}/superadmin/analytics/summary"
        resp_analytics = requests.get(analytics_url, headers=headers, timeout=TIMEOUT)
        assert resp_analytics.status_code == 200, f"Analytics summary failed: {resp_analytics.text}"

        # Step 3: GET /superadmin/audit-logs
        audit_logs_url = f"{BASE_URL}/superadmin/audit-logs"
        resp_audit_logs = requests.get(audit_logs_url, headers=headers, timeout=TIMEOUT)
        assert resp_audit_logs.status_code == 200, f"Audit logs failed: {resp_audit_logs.text}"

        # Step 4: GET /superadmin/queues
        queues_url = f"{BASE_URL}/superadmin/queues"
        resp_queues = requests.get(queues_url, headers=headers, timeout=TIMEOUT)
        assert resp_queues.status_code == 200, f"Queues failed: {resp_queues.text}"

        # Step 5: GET /superadmin/health
        health_url = f"{BASE_URL}/superadmin/health"
        resp_health = requests.get(health_url, headers=headers, timeout=TIMEOUT)
        assert resp_health.status_code == 200, f"Health check failed: {resp_health.text}"

    except requests.RequestException as e:
        assert False, f"Request error occurred: {e}"

test_superadmin_analytics_auditlogs_queues_health()
