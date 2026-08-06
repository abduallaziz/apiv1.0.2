import requests
import uuid
from datetime import datetime

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
SCHEDULES_URL = f"{BASE_URL}/schedules"
SHIFT_PATTERNS_URL = f"{BASE_URL}/shift-patterns"
EMPLOYEES_URL = f"{BASE_URL}/employees"
USERS_URL = f"{BASE_URL}/users"

TIMEOUT = 30

def test_create_schedule_shift_pattern_and_link_employee():
    session = requests.Session()
    try:
        # Login
        login_payload = {
            "email": "owner@sefay.com",
            "password": "12345678",
            "device_name": "test-device"
        }
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        access_token = login_resp.json().get("access_token")
        assert access_token, "No access_token in login response"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        # Create Schedule with minimal required fields including start_time and end_time
        # Need to provide user_id, scheduled_date, start_time, end_time
        # Pick user_id from fetched users
        users_resp = session.get(USERS_URL, headers=headers, timeout=TIMEOUT)
        assert users_resp.status_code == 200, f"Fetching users failed: {users_resp.text}"
        users = users_resp.json()
        if not users or not isinstance(users, list):
            raise AssertionError("No users found to link")
        user_for_schedule = users[0]
        user_id_for_schedule = user_for_schedule.get("id")
        assert user_id_for_schedule, "User has no ID"

        schedule_payload = {
            "user_id": user_id_for_schedule,
            "scheduled_date": datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
            "start_time": "09:00",
            "end_time": "17:00"
        }
        schedule_resp = session.post(SCHEDULES_URL, json=schedule_payload, headers=headers, timeout=TIMEOUT)
        assert schedule_resp.status_code == 201, f"Create schedule failed: {schedule_resp.text}"
        schedule_data = schedule_resp.json()
        schedule_id = schedule_data.get("id")
        assert schedule_id, "No schedule id returned"

        # Create Shift Pattern
        shift_pattern_payload = {
            "name": "Test Shift Pattern",
            "description": "Shift pattern created by test",
            "pattern": [
                {"day": 1, "start_time": "09:00", "end_time": "13:00"},
                {"day": 1, "start_time": "14:00", "end_time": "18:00"},
                {"day": 2, "start_time": "09:00", "end_time": "17:00"}
            ]
        }
        shift_pattern_resp = session.post(SHIFT_PATTERNS_URL, json=shift_pattern_payload, headers=headers, timeout=TIMEOUT)
        assert shift_pattern_resp.status_code == 201, f"Create shift pattern failed: {shift_pattern_resp.text}"
        shift_pattern_data = shift_pattern_resp.json()
        shift_pattern_id = shift_pattern_data.get("id")
        assert shift_pattern_id, "No shift pattern id returned"

        user_to_link = user_for_schedule
        user_id = user_to_link.get("id")
        assert user_id, "User has no ID"

        # Create employee to link
        employee_payload = {
            "first_name": "Test",
            "last_name": "Employee",
            "email": user_to_link.get("email"),
            "position": "Tester"
        }
        employee_resp = session.post(EMPLOYEES_URL, json=employee_payload, headers=headers, timeout=TIMEOUT)
        assert employee_resp.status_code == 201, f"Create employee failed: {employee_resp.text}"
        employee_data = employee_resp.json()
        employee_id = employee_data.get("id")
        assert employee_id, "No employee id returned"

        # Link employee to user
        link_url = f"{EMPLOYEES_URL}/{employee_id}/link"
        link_payload = {"user_id": user_id}
        link_resp = session.post(link_url, json=link_payload, headers=headers, timeout=TIMEOUT)
        assert link_resp.status_code == 200, f"Link employee to user failed: {link_resp.text}"

    finally:
        # Cleanup created resources if possible
        # Delete employee
        if 'employee_id' in locals():
            try:
                del_resp = session.delete(f"{EMPLOYEES_URL}/{employee_id}", headers=headers, timeout=TIMEOUT)
                if del_resp.status_code not in (200,204):
                    pass
            except Exception:
                pass
        # Delete schedule
        if 'schedule_id' in locals():
            try:
                del_resp = session.delete(f"{SCHEDULES_URL}/{schedule_id}", headers=headers, timeout=TIMEOUT)
                if del_resp.status_code not in (200,204):
                    pass
            except Exception:
                pass
        # Delete shift pattern
        if 'shift_pattern_id' in locals():
            try:
                del_resp = session.delete(f"{SHIFT_PATTERNS_URL}/{shift_pattern_id}", headers=headers, timeout=TIMEOUT)
                if del_resp.status_code not in (200,204):
                    pass
            except Exception:
                pass

test_create_schedule_shift_pattern_and_link_employee()
