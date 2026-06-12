"""In-process MCP server exposing the Confluence REST API v2 to the agents.

Follows the same pattern as mcp_webex_meetings.py: in-process, no subprocess.

Tools returned by `build_confluence_mcp(token, cloud_id)`:
  confluence_list_spaces()
  confluence_get_pages(space_id, limit?)
  confluence_get_page_content(page_id)
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from claude_agent_sdk import create_sdk_mcp_server, tool


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_confluence_mcp(token: str = "", cloud_id: str = ""):
    """Create the MCP server for Confluence API calls."""

    base_url = f"https://api.atlassian.com/ex/confluence/{cloud_id}/wiki/api/v2"

    def _headers() -> dict[str, str]:
        h = {"Accept": "application/json", "User-Agent": "ttt-ingest-agent"}
        if token:
            h["Authorization"] = f"Bearer {token}"
        return h

    async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            for attempt in range(3):
                resp = await client.get(f"{base_url}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    @tool(
        "confluence_list_spaces",
        "List Confluence spaces accessible to the connected account. Returns id, key, name, type, and status for each space.",
        {},
    )
    async def list_spaces(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        try:
            data = await _get("/spaces", {"limit": 50, "sort": "name"})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        results = data.get("results") or []
        out = [
            {
                "id": s.get("id"),
                "key": s.get("key"),
                "name": s.get("name"),
                "type": s.get("type"),
                "status": s.get("status"),
            }
            for s in results
        ]
        return _ok(out)

    @tool(
        "confluence_get_pages",
        "List pages in a Confluence space. `space_id` is required. Returns id, title, status, spaceId, and parentId for each page.",
        {"space_id": str, "limit": int},
    )
    async def get_pages(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        space_id = args.get("space_id") or ""
        if not space_id:
            return _err("space_id is required")
        limit = args.get("limit") or 50
        try:
            data = await _get(f"/spaces/{space_id}/pages", {"limit": limit, "sort": "title"})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        results = data.get("results") or []
        out = [
            {
                "id": p.get("id"),
                "title": p.get("title"),
                "status": p.get("status"),
                "spaceId": p.get("spaceId"),
                "parentId": p.get("parentId"),
            }
            for p in results
        ]
        return _ok(out)

    @tool(
        "confluence_get_page_content",
        "Get the full content of a Confluence page plus its inline comments. `page_id` is required. Returns the page body in storage format and any inline comments.",
        {"page_id": str},
    )
    async def get_page_content(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        page_id = args.get("page_id") or ""
        if not page_id:
            return _err("page_id is required")
        try:
            page_data = await _get(f"/pages/{page_id}", {"body-format": "storage"})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code} fetching page: {e.response.text[:200]}")

        comments: list[dict] = []
        try:
            comments_data = await _get(f"/pages/{page_id}/inline-comments", {"limit": 50})
            for c in comments_data.get("results") or []:
                body = c.get("body", {}).get("storage", {}).get("value", "")
                comments.append({
                    "body": body,
                    "author": (c.get("author") or {}).get("displayName", ""),
                    "createdAt": c.get("createdAt", ""),
                })
        except httpx.HTTPStatusError:
            pass

        body_content = (page_data.get("body") or {}).get("storage", {}).get("value", "")
        out = {
            "id": page_data.get("id"),
            "title": page_data.get("title"),
            "body": body_content,
            "comments": comments,
        }
        return _ok(out)

    return create_sdk_mcp_server(
        name="confluence",
        version="0.1.0",
        tools=[list_spaces, get_pages, get_page_content],
    )
