import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
PAYROLL_REPORT_URL = f"{BASE_URL}/reports/payroll"
TIMEOUT = 30

def test_payroll_report_requires_elevated_permission():
    # Step 1: Login as user with role 'cashier' (token lacking hr.manage permission)
    login_payload = {
        "email": "cashier@test.com",
        "password": "testpassword",
        "device_name": "test-device"
    }

    # Since the test account provided is only for owner with full permissions,
    # we need to use the given bearer token for a user lacking hr.manage permission:
    # {"authType":"Bearer token","credential":"eyJhbGc...64S7HBw"}

    # Use the given bearer token from instructions for cashier role (lacking hr.manage)
    bearer_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LWNhc2hpZXItaWQiLCJlbWFpbCI6ImNhc2hpZXJAdGVzdC5jb20iLCJyb2xlIjoiY2FzaGllciIsInRlbmFudF9pZCI6InRlc3QtdGVuYW50LWlkIiwic2Vzc2lvbl9pZCI6InRlc3Qtc2Vzc2lvbi1pZCIsImlhdCI6MTc4NTIwNTIyMiwiZXhwIjoxNzg1MjA4ODIyfQ.vZa97GTw4L-wUlHW7fhp85zuKkOmk7Jye6Mx64S7HBw"

    headers = {
        "Authorization": f"Bearer {bearer_token}"
    }

    # Step 2: Attempt to get payroll report, expect 403 Forbidden
    response = requests.get(PAYROLL_REPORT_URL, headers=headers, timeout=TIMEOUT)

    # Assert the status code is 403 Forbidden
    assert response.status_code == 403, f"Expected 403 Forbidden, got {response.status_code}"

test_payroll_report_requires_elevated_permission()