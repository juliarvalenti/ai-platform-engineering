from __future__ import annotations

from pydantic import BaseModel, Field

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_webex_meetings import build_webex_meetings_mcp
from tome_agent.reports.schema import PageSpec, frontmatter_example, WEBEX_MEETING_FRONTMATTER

WEBEX_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("activity.md",       "dynamic", "Activity",       10),
)


class WebexMeetingItem(BaseModel):
    id: str
    title: str
    start: str  # ISO timestamp from the user-facing meeting picker


class WebexExtra(BaseModel):
    meetings: list[WebexMeetingItem] = Field(default_factory=list)


class WebexConnector(Connector[WebexExtra]):
    slug = "webex"  # backend posts connector_data.webex; MCP prefix is independent (webex_meetings)
    name = "Webex"
    source_prefix = "webex"  # wiki folder stays `webex/<slug>/`
    extra_model = WebexExtra

    def is_enabled(self, token: str) -> bool:
        return True  # Always enabled; token may be empty → tools return an error gracefully

    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        return build_webex_meetings_mcp(token=token)

    @property
    def mcp_tools(self) -> list[str]:
        return [
            "mcp__webex_meetings__webex_meetings_list_meetings",
            "mcp__webex_meetings__webex_meetings_list_transcripts",
            "mcp__webex_meetings__webex_meetings_get_summary",
        ]

    def page_template(self) -> tuple[PageSpec, ...]:
        return WEBEX_TEMPLATE

    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: WebexExtra | None = None,
    ) -> str:
        from tome_agent.reports import schema as report_schema

        if not sources:
            rooms_section = "(no Webex rooms attached — connector also not yet wired)"
        else:
            blocks = []
            for source in sources:
                expanded = report_schema.expand_template(
                    f"webex/{source.slug}", WEBEX_TEMPLATE
                )
                blocks.append(
                    f"### Webex room `{source.slug}` ({source.display_name})\n"
                    + format_pages(expanded)
                )
            rooms_section = "\n\n".join(blocks)

        meetings_section = ""
        meetings = extra_data.meetings if extra_data else []
        if meetings:
            meeting_lines = "\n".join(
                f"  - id: {m.id}, title: \"{m.title}\", date: {m.start}"
                for m in meetings
            )
            meetings_section = (
                "\n\nWEBEX MEETINGS TO INGEST:\n\n"
                "For each meeting below, call `webex_meetings_list_transcripts` (with meetingId) "
                "and `webex_meetings_get_summary` (with meetingId) to fetch content.\n"
                "Write each to `webex/meetings/<date>-<sanitized-title>.md` where <date> is "
                "YYYY-MM-DD from the start time and <sanitized-title> is the title lowercased "
                "with spaces replaced by hyphens and non-alphanumeric characters removed.\n\n"
                f"Each file should have this frontmatter:\n{frontmatter_example(WEBEX_MEETING_FRONTMATTER)}\n\n"
                "Include the AI summary, highlights, action items, and keywords from the "
                "summary endpoint. If a transcript is available, note the transcript ID and "
                "creation time. One file per meeting.\n\n"
                f"Meetings:\n{meeting_lines}"
            )

        return (
            f"PER-WEBEX-ROOM SUBTREES (each room under `webex/`):\n\n"
            f"{rooms_section}{meetings_section}"
        )

    def prompt_extension(self, extra_data: WebexExtra | None) -> str:
        meetings = extra_data.meetings if extra_data else []
        if not meetings:
            return ""
        return (
            f"\n\nThe user selected {len(meetings)} Webex meeting(s) for transcript "
            "ingestion. Process them per the WEBEX MEETINGS TO INGEST section."
        )

    def log_lines(self, sources: list[SourceItem], extra_data: WebexExtra | None = None) -> list[str]:
        lines = []
        if sources:
            lines.append(f"· webex rooms: {', '.join(s.slug for s in sources)} (connector not yet wired)")
        meetings = extra_data.meetings if extra_data else []
        if meetings:
            lines.append(f"· webex meetings: {len(meetings)} selected for transcript ingestion")
        return lines
