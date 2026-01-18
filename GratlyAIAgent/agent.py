"""Core AI Agent using DeepSeek API."""

import json
import logging
import re
from typing import AsyncGenerator, Dict, Any, List, Optional, Tuple
import httpx

from .config import AgentConfig
from .context_retriever import ContextRetriever
from .tools import AGENT_TOOLS
from .prompts import build_system_prompt
from .models import ChatMessage, MessageRole

logger = logging.getLogger(__name__)

# Pattern to detect DeepSeek's DSML function call format
DSML_PATTERN = re.compile(
    r'<｜DSML｜function_calls>(.*?)</｜DSML｜function_calls>',
    re.DOTALL
)
DSML_INVOKE_PATTERN = re.compile(
    r'<｜DSML｜invoke\s+name="([^"]+)"[^>]*>(.*?)</｜DSML｜invoke>',
    re.DOTALL
)
DSML_PARAM_PATTERN = re.compile(
    r'<｜DSML｜parameter\s+name="([^"]+)"[^>]*>([^<]*)</｜DSML｜parameter>'
)


class GratlyAgent:
    """AI Agent that uses DeepSeek API with permission-aware data access."""

    def __init__(self, user_id: int):
        self.user_id = user_id
        self.context_retriever = ContextRetriever(user_id)
        self.config = AgentConfig()

    def _build_messages(
        self,
        user_message: str,
        conversation_history: List[ChatMessage]
    ) -> List[Dict[str, str]]:
        """Build the messages array for the API request."""
        system_prompt = build_system_prompt(
            user_id=self.user_id,
            restaurant_id=self.context_retriever.restaurant_id or 0,
            restaurant_name=self.context_retriever.restaurant_name or "Unknown",
            is_admin=self.context_retriever.is_admin,
            permissions=self.context_retriever.permissions
        )

        messages = [{"role": "system", "content": system_prompt}]

        # Add conversation history (limited to last N messages)
        history_limit = self.config.MAX_CONVERSATION_HISTORY
        for msg in conversation_history[-history_limit:]:
            messages.append({"role": msg.role.value, "content": msg.content})

        # Add current user message
        messages.append({"role": "user", "content": user_message})

        return messages

    def _parse_dsml_tool_calls(self, content: str) -> List[Tuple[str, Dict[str, Any]]]:
        """Parse DeepSeek's DSML format for function calls.

        Returns a list of (function_name, arguments) tuples.
        """
        tool_calls = []

        # Find all function_calls blocks
        fc_match = DSML_PATTERN.search(content)
        if not fc_match:
            return tool_calls

        fc_content = fc_match.group(1)

        # Find all invoke blocks
        for invoke_match in DSML_INVOKE_PATTERN.finditer(fc_content):
            func_name = invoke_match.group(1)
            invoke_content = invoke_match.group(2)

            # Extract parameters
            arguments = {}
            for param_match in DSML_PARAM_PATTERN.finditer(invoke_content):
                param_name = param_match.group(1)
                param_value = param_match.group(2).strip()

                # Try to parse as JSON, otherwise use as string
                try:
                    arguments[param_name] = json.loads(param_value)
                except (json.JSONDecodeError, ValueError):
                    arguments[param_name] = param_value

            tool_calls.append((func_name, arguments))
            logger.info(f"Parsed DSML tool call: {func_name} with args: {arguments}")

        return tool_calls

    def _has_dsml_tool_calls(self, content: str) -> bool:
        """Check if content contains DSML function calls."""
        return bool(DSML_PATTERN.search(content))

    def _call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool call and return the result."""
        tool_map = {
            "get_employees": self.context_retriever.get_employees,
            "get_payout_summary": self.context_retriever.get_payout_summary,
            "calculate_employee_payout": self.context_retriever.calculate_employee_payout,
            "get_payout_schedules": self.context_retriever.get_payout_schedules,
            "get_report": self.context_retriever.get_report,
            "get_pending_approvals": self.context_retriever.get_pending_approvals,
        }

        if name not in tool_map:
            return {"error": f"Unknown tool: {name}"}

        try:
            return tool_map[name](**arguments)
        except Exception as e:
            logger.error(f"Tool execution error for {name}: {e}")
            return {"error": f"Tool execution failed: {str(e)}"}

    async def _make_api_request(
        self,
        client: httpx.AsyncClient,
        messages: List[Dict],
        stream: bool = False,
        tools: Optional[List[Dict]] = None
    ) -> httpx.Response:
        """Make a request to the DeepSeek API."""
        payload = {
            "model": AgentConfig.get_deepseek_model(),
            "messages": messages,
            "max_tokens": self.config.MAX_TOKENS,
            "temperature": self.config.TEMPERATURE,
            "stream": stream,
        }

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        return await client.post(
            f"{AgentConfig.get_deepseek_base_url()}/chat/completions",
            headers={
                "Authorization": f"Bearer {AgentConfig.get_api_key()}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120.0 if stream else 60.0,
        )

    async def chat(
        self,
        message: str,
        conversation_history: List[ChatMessage]
    ) -> str:
        """Send a message and get a complete response (non-streaming)."""
        messages = self._build_messages(message, conversation_history)

        async with httpx.AsyncClient() as client:
            # First request with tools
            response = await self._make_api_request(client, messages, stream=False, tools=AGENT_TOOLS)

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"DeepSeek API error: {response.status_code} - {error_text}")
                return f"I'm sorry, I encountered an error processing your request. Please try again."

            result = response.json()
            assistant_message = result["choices"][0]["message"]
            content = assistant_message.get("content", "")

            # Handle standard OpenAI-style tool calls
            if assistant_message.get("tool_calls"):
                messages.append(assistant_message)

                for tool_call in assistant_message["tool_calls"]:
                    function_name = tool_call["function"]["name"]
                    try:
                        arguments = json.loads(tool_call["function"]["arguments"])
                    except json.JSONDecodeError:
                        arguments = {}

                    tool_result = self._call_tool(function_name, arguments)

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": json.dumps(tool_result)
                    })

                # Add instruction to respond naturally without more function calls
                messages.append({
                    "role": "user",
                    "content": "Please respond to my original question using the data above. Respond in plain conversational English - do not call any more functions or use any XML/markup tags."
                })

                # Get final response after tool calls
                final_response = await self._make_api_request(client, messages, stream=False)

                if final_response.status_code != 200:
                    return "I'm sorry, I encountered an error after processing the data. Please try again."

                final_result = final_response.json()
                response_content = final_result["choices"][0]["message"]["content"]

                # Clean any DSML markup from response
                clean_content = DSML_PATTERN.sub("", response_content).strip()
                return clean_content if clean_content else response_content

            # Handle DeepSeek DSML format (when model outputs tool calls as text)
            elif content and self._has_dsml_tool_calls(content):
                logger.info("Detected DSML format tool calls in response")
                dsml_tool_calls = self._parse_dsml_tool_calls(content)

                if dsml_tool_calls:
                    # Add assistant message
                    messages.append({
                        "role": "assistant",
                        "content": "I'll look up that information for you."
                    })

                    # Execute each tool and collect results
                    tool_results = []
                    for func_name, arguments in dsml_tool_calls:
                        logger.info(f"Executing DSML tool: {func_name} with args: {arguments}")
                        tool_result = self._call_tool(func_name, arguments)
                        tool_results.append({
                            "function": func_name,
                            "result": tool_result
                        })

                    # Add tool results as a user message
                    results_text = "Here are the results from the database:\n\n"
                    for tr in tool_results:
                        results_text += f"**{tr['function']}**:\n```json\n{json.dumps(tr['result'], indent=2)}\n```\n\n"

                    messages.append({
                        "role": "user",
                        "content": f"Based on the following data, please provide a helpful response:\n\n{results_text}"
                    })

                    # Get final response
                    final_response = await self._make_api_request(client, messages, stream=False)

                    if final_response.status_code != 200:
                        return "I'm sorry, I encountered an error after processing the data. Please try again."

                    final_result = final_response.json()
                    return final_result["choices"][0]["message"]["content"]

            return content if content else "I'm sorry, I couldn't generate a response."

    def _fetch_all_context(self) -> str:
        """Fetch comprehensive data summary for the user's restaurant."""
        context_parts = []

        # 1. Fetch all employees
        try:
            employees = self.context_retriever.get_employees()
            logger.info(f"Fetched {employees.get('count', 0)} employees")
            if employees.get("employees"):
                emp_list = "\n".join([
                    f"- {e['name']} | Job: {e.get('jobTitle', 'N/A')} | Email: {e.get('email', 'N/A')} | Status: {'Active' if e.get('isActive') else 'Inactive'}"
                    for e in employees["employees"][:30]
                ])
                context_parts.append(f"## EMPLOYEES ({employees.get('count', 0)} total)\n{emp_list}")
            elif employees.get("error"):
                context_parts.append(f"## EMPLOYEES\nError: {employees.get('error')}")
            else:
                context_parts.append("## EMPLOYEES\nNo employees found.")
        except Exception as e:
            logger.error(f"Error fetching employees: {e}")

        # 2. Fetch payout reports for different periods
        try:
            # Yesterday
            yesterday = self.context_retriever.get_report("yesterday")
            if not yesterday.get("error"):
                context_parts.append(
                    f"## YESTERDAY'S PAYOUTS ({yesterday.get('startDate')})\n"
                    f"Total: ${yesterday.get('totalPayout', 0):.2f} | Employees: {yesterday.get('employeeCount', 0)}"
                )
                if yesterday.get("employees"):
                    context_parts[-1] += "\n" + "\n".join([
                        f"- {e['name']}: ${e['totalPayout']:.2f}"
                        for e in yesterday["employees"][:10]
                    ])

            # This week
            this_week = self.context_retriever.get_report("this-week")
            if not this_week.get("error"):
                context_parts.append(
                    f"## THIS WEEK'S PAYOUTS ({this_week.get('startDate')} to {this_week.get('endDate')})\n"
                    f"Total: ${this_week.get('totalPayout', 0):.2f} | Employees: {this_week.get('employeeCount', 0)}"
                )
                if this_week.get("employees"):
                    context_parts[-1] += "\n" + "\n".join([
                        f"- {e['name']}: ${e['totalPayout']:.2f} ({e['daysWorked']} days)"
                        for e in this_week["employees"][:10]
                    ])

            # This month
            this_month = self.context_retriever.get_report("this-month")
            if not this_month.get("error"):
                context_parts.append(
                    f"## THIS MONTH'S PAYOUTS ({this_month.get('startDate')} to {this_month.get('endDate')})\n"
                    f"Total: ${this_month.get('totalPayout', 0):.2f} | Employees: {this_month.get('employeeCount', 0)}"
                )
                if this_month.get("employees"):
                    context_parts[-1] += "\n" + "\n".join([
                        f"- {e['name']}: ${e['totalPayout']:.2f} ({e['daysWorked']} days)"
                        for e in this_month["employees"][:10]
                    ])
        except Exception as e:
            logger.error(f"Error fetching payouts: {e}")

        # 3. Fetch sales and tips data
        try:
            sales = self.context_retriever.get_sales_and_tips()
            logger.info(f"Sales fetch result: {sales.get('employeeCount', 0)} employees, {len(sales.get('dailyRecords', []))} daily records")
            if not sales.get("error"):
                context_parts.append(
                    f"## SALES & TIPS SUMMARY ({sales.get('startDate')} to {sales.get('endDate')})\n"
                    f"Total Sales: ${sales.get('totalSales', 0):.2f} | Total Tips: ${sales.get('totalTips', 0):.2f}"
                )
                if sales.get("employees"):
                    context_parts[-1] += "\n\nBy Employee (totals):\n" + "\n".join([
                        f"- {e['name']}: Sales ${e['totalSales']:.2f} | Tips ${e['totalTips']:.2f} | Gratuity ${e['totalGratuity']:.2f} ({e['daysWorked']} days)"
                        for e in sales["employees"][:15]
                    ])
                if sales.get("dailyRecords"):
                    context_parts.append("## DAILY SALES BREAKDOWN (recent)\n" + "\n".join([
                        f"- {r['date']} | {r['name']}: Sales ${r['sales']:.2f} | Tips ${r['tips']:.2f}"
                        for r in sales["dailyRecords"][:30]
                    ]))
        except Exception as e:
            logger.error(f"Error fetching sales: {e}")

        # 4. Fetch payout schedules
        try:
            schedules = self.context_retriever.get_payout_schedules()
            if schedules.get("schedules"):
                sched_list = "\n".join([
                    f"- {s['name']} | Rule: {s.get('payoutRule', 'N/A')} | Status: {'Active' if s.get('isActive') else 'Inactive'}"
                    for s in schedules["schedules"]
                ])
                context_parts.append(f"## PAYOUT SCHEDULES ({schedules.get('count', 0)} total)\n{sched_list}")
        except Exception as e:
            logger.error(f"Error fetching schedules: {e}")

        # 4. Fetch pending approvals (admin only)
        try:
            approvals = self.context_retriever.get_pending_approvals()
            if not approvals.get("error"):
                if approvals.get("approvals"):
                    appr_list = "\n".join([
                        f"- {a['scheduleName']} on {a['businessDate']}: ${a['totalAmount']:.2f} ({a['employeeCount']} employees)"
                        for a in approvals["approvals"][:10]
                    ])
                    context_parts.append(f"## PENDING APPROVALS ({approvals.get('count', 0)} total)\n{appr_list}")
                else:
                    context_parts.append("## PENDING APPROVALS\nNo pending approvals.")
        except Exception as e:
            logger.error(f"Error fetching approvals: {e}")

        return "\n\n".join(context_parts) if context_parts else "No data available."

    async def chat_stream(
        self,
        message: str,
        conversation_history: List[ChatMessage]
    ) -> AsyncGenerator[str, None]:
        """Stream a chat response from the AI agent."""
        # Fetch ALL context data upfront
        context_data = self._fetch_all_context()
        logger.info(f"Fetched comprehensive context: {len(context_data)} chars")

        messages = self._build_messages(message, conversation_history)

        # Replace the user message with one that includes all context
        # Remove the original user message and add one with context
        messages = [m for m in messages if not (m["role"] == "user" and m["content"] == message)]
        messages.append({
            "role": "user",
            "content": f"""Here is the current data from the restaurant database:

{context_data}

---

User's question: {message}

Please answer the user's question using ONLY the data provided above. Be specific and accurate. If the data doesn't contain what the user is asking about, say so politely."""
        })

        async with httpx.AsyncClient() as client:
            # Stream the response directly (no function calling)
            logger.info(f"Making streaming request with {len(messages)} messages")
            async with client.stream(
                "POST",
                f"{AgentConfig.get_deepseek_base_url()}/chat/completions",
                headers={
                    "Authorization": f"Bearer {AgentConfig.get_api_key()}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": AgentConfig.get_deepseek_model(),
                    "messages": messages,
                    "max_tokens": self.config.MAX_TOKENS,
                    "temperature": self.config.TEMPERATURE,
                    "stream": True,
                },
                timeout=120.0,
            ) as stream:
                full_response = ""
                async for line in stream.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data = line[6:]  # Remove "data: " prefix
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        chunk_content = delta.get("content")
                        if chunk_content:
                            full_response += chunk_content
                    except json.JSONDecodeError:
                        continue

                # Clean the full response - remove ALL DSML content
                clean_response = re.sub(r'<｜DSML｜.*?(?:</｜DSML｜[^>]*>|$)', '', full_response, flags=re.DOTALL)
                clean_response = clean_response.strip()

                logger.info(f"Streamed response preview: {full_response[:500] if full_response else 'EMPTY'}")

                if clean_response:
                    yield clean_response
                else:
                    yield "I was able to find some information. Let me summarize what I found in the data."
