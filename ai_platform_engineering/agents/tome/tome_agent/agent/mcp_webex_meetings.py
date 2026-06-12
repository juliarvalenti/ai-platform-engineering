"""In-process MCP server exposing the Webex Meetings REST API to the agents.

Follows the same pattern as mcp_github.py: in-process, no subprocess, no Docker.

Tools returned by `build_webex_meetings_mcp(token)`:
  webex_meetings_list_meetings(meetingType?, state?, from?, to?, max?, hostEmail?, meetingNumber?)
  webex_meetings_list_transcripts(meetingId?, hostEmail?, from?, to?, max?)
  webex_meetings_get_summary(meetingId)
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from claude_agent_sdk import create_sdk_mcp_server, tool

API = "https://webexapis.com/v1"
DEFAULT_MAX = 10


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_webex_meetings_mcp(token: str = ""):
    """Create the MCP server for Webex Meetings API calls."""

    def _headers() -> dict[str, str]:
        h = {"Content-Type": "application/json", "User-Agent": "ttt-ingest-agent"}
        if token:
            h["Authorization"] = f"Bearer {token}"
        return h

    async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            for attempt in range(3):
                resp = await client.get(f"{API}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    @tool(
        "webex_meetings_list_meetings",
        "List Webex meetings. All params optional. `meetingType`: meetingSeries|scheduledMeeting|meeting. `state`: active|scheduled|ready|lobby|ended|missed|expired. `from`/`to` are ISO8601 timestamps.",
        {"meetingType": str, "state": str, "from": str, "to": str, "max": int, "hostEmail": str, "meetingNumber": str},
    )
    async def list_meetings(args: dict) -> dict[str, Any]:
        if not token:
            return _err("webex_token is not configured")
        params: dict[str, Any] = {}
        if args.get("meetingType"):
            params["meetingType"] = args["meetingType"]
        if args.get("state"):
            params["state"] = args["state"]
        if args.get("from"):
            params["from"] = args["from"]
        if args.get("to"):
            params["to"] = args["to"]
        params["max"] = args.get("max") or DEFAULT_MAX
        if args.get("hostEmail"):
            params["hostEmail"] = args["hostEmail"]
        if args.get("meetingNumber"):
            params["meetingNumber"] = args["meetingNumber"]
        try:
            data = await _get("/meetings", params)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        items = data.get("items") or []
        out = [
            {
                "id": m.get("id"),
                "title": m.get("title"),
                "meetingNumber": m.get("meetingNumber"),
                "start": m.get("start"),
                "end": m.get("end"),
                "hostDisplayName": m.get("hostDisplayName"),
                "hostEmail": m.get("hostEmail"),
                "meetingType": m.get("meetingType"),
                "state": m.get("state"),
                "timezone": m.get("timezone"),
            }
            for m in items
        ]
        return _ok(out)

    @tool(
        "webex_meetings_list_transcripts",
        "List Webex meeting transcripts. All params optional. Provide `meetingId` to filter to a specific meeting. `from`/`to` are ISO8601 timestamps.",
        {"meetingId": str, "hostEmail": str, "from": str, "to": str, "max": int},
    )
    async def list_transcripts(args: dict) -> dict[str, Any]:
        if not token:
            return _err("webex_token is not configured")
        params: dict[str, Any] = {}
        if args.get("meetingId"):
            params["meetingId"] = args["meetingId"]
        if args.get("hostEmail"):
            params["hostEmail"] = args["hostEmail"]
        if args.get("from"):
            params["from"] = args["from"]
        if args.get("to"):
            params["to"] = args["to"]
        params["max"] = args.get("max") or DEFAULT_MAX
        try:
            data = await _get("/meetingTranscripts", params)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        items = data.get("items") or []
        out = [
            {
                "id": t.get("id"),
                "meetingId": t.get("meetingId"),
                "title": t.get("title"),
                "createTime": t.get("createTime"),
                "downloadUrl": t.get("downloadUrl"),
            }
            for t in items
        ]
        return _ok(out)

    @tool(
        "webex_meetings_get_summary",
        "Get the AI-generated summary for a specific Webex meeting. `meetingId` is required.",
        {"meetingId": str},
    )
    async def get_summary(args: dict) -> dict[str, Any]:
        if not token:
            return _err("webex_token is not configured")
        meeting_id = args.get("meetingId") or ""
        if not meeting_id:
            return _err("meetingId is required")
        try:
            data = await _get("/meetingSummaries", {"meetingId": meeting_id})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        if "items" in data and isinstance(data["items"], list):
            items = data["items"]
            if not items:
                return _err(f"no summary found for meetingId={meeting_id}")
            summary = items[0]
        else:
            summary = data
        out = {
            "id": summary.get("id"),
            "meetingId": summary.get("meetingId"),
            "title": summary.get("title"),
            "summary": summary.get("summary"),
            "keywords": summary.get("keywords"),
            "highlights": summary.get("highlights"),
            "actionItems": summary.get("actionItems"),
        }
        return _ok(out)

    return create_sdk_mcp_server(
        name="webex_meetings",
        version="0.1.0",
        tools=[list_meetings, list_transcripts, get_summary],
    )
