from __future__ import annotations

import os

from pydantic import BaseModel, Field

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_confluence import build_confluence_mcp
from tome_agent.reports.schema import PageSpec, frontmatter_example, CONFLUENCE_PAGE_FRONTMATTER

CONFLUENCE_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md", "dynamic", "Overview", 0),
)


class ConfluencePageItem(BaseModel):
    page_id: str
    title: str
    space_key: str


class ConfluenceExtra(BaseModel):
    pages: list[ConfluencePageItem] = Field(default_factory=list)


class ConfluenceConnector(Connector[ConfluenceExtra]):
    slug = "confluence"
    name = "Confluence"
    source_prefix = "confluence"
    extra_model = ConfluenceExtra

    def is_enabled(self, token: str) -> bool:
        # Confluence cloud requires both token and cloud_id; the backend
        # injects both as env when starting the agent. The connector
        # checks for the cloud_id env directly here so empty strings vs
        # missing keys behave the same.
        cloud_id = os.environ.get("CONFLUENCE_CLOUD_ID", "")
        return bool(token and cloud_id)

    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        cloud_id = os.environ.get("CONFLUENCE_CLOUD_ID", "")
        return build_confluence_mcp(token=token, cloud_id=cloud_id)

    @property
    def mcp_tools(self) -> list[str]:
        return [
            "mcp__confluence__confluence_list_spaces",
            "mcp__confluence__confluence_get_pages",
            "mcp__confluence__confluence_get_page_content",
        ]

    def page_template(self) -> tuple[PageSpec, ...]:
        return CONFLUENCE_TEMPLATE

    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: ConfluenceExtra | None = None,
    ) -> str:
        from tome_agent.reports import schema as report_schema

        if not sources:
            spaces_section = "(no Confluence spaces attached — connector also not yet wired)"
        else:
            blocks = []
            for source in sources:
                expanded = report_schema.expand_template(
                    f"confluence/{source.slug}", CONFLUENCE_TEMPLATE
                )
                blocks.append(
                    f"### Confluence space `{source.slug}` ({source.display_name}, "
                    f"key={source.extra.get('space_key', '')})\n"
                    + format_pages(expanded)
                )
            spaces_section = "\n\n".join(blocks)

        pages_section = ""
        pages = extra_data.pages if extra_data else []
        if pages:
            page_lines = "\n".join(
                f"  - space: \"{p.space_key}\", page_id: \"{p.page_id}\", title: \"{p.title}\""
                for p in pages
            )
            pages_section = (
                "\n\nCONFLUENCE PAGES TO INGEST:\n\n"
                "For each page below, call `confluence_get_page_content` (with page_id) to fetch "
                "the page body and inline comments.\n"
                "Write each to `confluence/<space-key>/<sanitized-title>.md` where <space-key> is "
                "lowercased and <sanitized-title> is the title lowercased with spaces replaced by "
                "hyphens and non-alphanumeric characters removed.\n\n"
                f"Each file should have this frontmatter:\n{frontmatter_example(CONFLUENCE_PAGE_FRONTMATTER)}\n\n"
                "Include the page content converted from Confluence storage format to markdown. "
                "If inline comments exist, include them as a \"Discussion\" section at the end. "
                "One file per page.\n\n"
                f"Pages:\n{page_lines}"
            )

        return (
            f"PER-CONFLUENCE-SPACE SUBTREES (each space under `confluence/`):\n\n"
            f"{spaces_section}{pages_section}"
        )

    def prompt_extension(self, extra_data: ConfluenceExtra | None) -> str:
        pages = extra_data.pages if extra_data else []
        if not pages:
            return ""
        return (
            f"\n\nThe user selected {len(pages)} Confluence page(s) for "
            "content ingestion. Process them per the CONFLUENCE PAGES TO INGEST section."
        )

    def log_lines(self, sources: list[SourceItem], extra_data: ConfluenceExtra | None = None) -> list[str]:
        lines = []
        if sources:
            lines.append(f"· confluence spaces: {', '.join(s.slug for s in sources)}")
        pages = extra_data.pages if extra_data else []
        if pages:
            lines.append(f"· confluence pages: {len(pages)} selected for content ingestion")
        return lines
