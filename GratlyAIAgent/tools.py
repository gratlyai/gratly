"""Tool definitions for DeepSeek function calling."""

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_employees",
            "description": "Get list of employees for the restaurant. Returns employee names, job titles, email, and active status. For admins/managers, returns all employees. For regular employees, returns only their own information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search_term": {
                        "type": "string",
                        "description": "Optional search term to filter employees by name"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_payout_summary",
            "description": "Get payout summary for a date range. Shows total tips, net payouts, and breakdown by employee (if admin) or just the user's own payouts (if employee).",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date in YYYY-MM-DD format"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date in YYYY-MM-DD format"
                    }
                },
                "required": ["start_date", "end_date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_employee_payout",
            "description": "Calculate detailed payout for a specific employee over a date range. Shows gross tips, deductions, and net payout. Admins can query any employee; employees can only query themselves.",
            "parameters": {
                "type": "object",
                "properties": {
                    "employee_name": {
                        "type": "string",
                        "description": "Employee name to search for (first name, last name, or full name)"
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Start date in YYYY-MM-DD format (optional, defaults to current month)"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date in YYYY-MM-DD format (optional, defaults to today)"
                    }
                },
                "required": ["employee_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_payout_schedules",
            "description": "Get information about payout schedules configured for the restaurant. Shows schedule names, payout rules, and associated employees.",
            "parameters": {
                "type": "object",
                "properties": {
                    "schedule_name": {
                        "type": "string",
                        "description": "Optional schedule name to search for"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_report",
            "description": "Get a summary report for a specific time period. Available report types: 'yesterday' (previous day), 'this-week' (current week), 'this-month' (current month), 'last-month' (previous month), 'custom' (specify dates).",
            "parameters": {
                "type": "object",
                "properties": {
                    "report_type": {
                        "type": "string",
                        "enum": ["yesterday", "this-week", "this-month", "last-month", "custom"],
                        "description": "Type of report to retrieve"
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Start date for custom report (YYYY-MM-DD format)"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date for custom report (YYYY-MM-DD format)"
                    }
                },
                "required": ["report_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_pending_approvals",
            "description": "Get list of payout approvals that are pending review. Only available for admins/managers with approval permissions.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    }
]
