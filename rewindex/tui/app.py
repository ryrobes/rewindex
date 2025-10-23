"""Main Textual application for Rewindex TUI."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from rich.text import Text
from textual import events
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.message import Message
from textual.widgets import Checkbox, Footer, Header, Input, Static

from ..config import Config, find_project_root
from ..es import ESClient, ensure_indices
from ..search import SearchFilters, SearchOptions, simple_search_es


class SearchBar(Static):
    """Search input bar with live search and options."""

    DEFAULT_CSS = """
    SearchBar {
        height: auto;
        background: transparent;
    }

    #search-input {
        margin-bottom: 1;
    }

    #search-options {
        height: 1;
        background: transparent;
    }

    Checkbox {
        background: transparent;
        margin-right: 2;
    }
    """

    def compose(self) -> ComposeResult:
        yield Input(
            placeholder="🔍 Search code... (e.g., 'auth lang:python path:src/**')",
            id="search-input"
        )
        with Horizontal(id="search-options"):
            yield Checkbox("Fuzzy", id="fuzzy-checkbox", value=False)
            yield Checkbox("Partial", id="partial-checkbox", value=False)


class ResultsList(Static):
    """Scrollable list of search results."""

    DEFAULT_CSS = """
    ResultsList {
        height: 100%;
        overflow-y: auto;
        border: solid $primary;
    }
    """

    # Custom message for when a result is selected
    class ResultSelected(Message):
        """Posted when a result is selected via mouse or keyboard."""
        def __init__(self, result_index: int) -> None:
            self.result_index = result_index
            super().__init__()

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.results = []
        self.selected_index = 0
        self.result_line_map = []  # Maps line numbers to result indices

    def update_results(self, results: list) -> None:
        """Update the displayed results."""
        self.results = results
        self.selected_index = 0
        self.render_results()

    def render_results(self) -> None:
        """Render results to the widget."""
        if not self.results:
            self.update(Text("📊 No results found"))
            self.result_line_map = []
            return

        # Use Rich Text to avoid markup parsing errors
        text = Text()
        text.append(f"📊 Results ({len(self.results)} matches)\n")

        # Build line map: maps each display line to result index
        self.result_line_map = []
        current_line = 1  # Start after header line

        for i, result in enumerate(self.results):
            selected = "►" if i == self.selected_index else " "
            file_path = result.get("file_path", "")
            language = result.get("language", "")

            # Language emoji mapping
            lang_emoji = {
                "python": "🐍",
                "javascript": "🟨",
                "typescript": "🔷",
                "rust": "🦀",
                "go": "🔵",
                "java": "☕",
                "c": "©️",
                "cpp": "©️",
            }.get(language.lower() if language else "", "📄")

            # Get first match for preview
            matches = result.get("matches", [])
            if matches and isinstance(matches, list) and len(matches) > 0:
                match = matches[0]
                # 'line' is the line number (int)
                line_num = match.get("line", 0)
                # 'highlight' or 'content' contains the actual text
                snippet_text = match.get("highlight") or match.get("content", "")
                if snippet_text is None:
                    snippet_text = ""
                elif not isinstance(snippet_text, str):
                    snippet_text = str(snippet_text)
                snippet = snippet_text[:60]  # Truncate long lines
                text.append(
                    f"{selected} {lang_emoji} {file_path}:{line_num}\n"
                    f"   {snippet}\n"
                )
                # Map both lines to this result
                self.result_line_map.append((current_line, i))
                self.result_line_map.append((current_line + 1, i))
                current_line += 2
            else:
                text.append(f"{selected} {lang_emoji} {file_path}\n")
                # Map single line to this result
                self.result_line_map.append((current_line, i))
                current_line += 1

        self.update(text)

    def move_selection(self, delta: int) -> None:
        """Move selection up or down."""
        if not self.results:
            return
        self.selected_index = max(0, min(len(self.results) - 1, self.selected_index + delta))
        self.render_results()

    def get_selected(self):
        """Get currently selected result."""
        if 0 <= self.selected_index < len(self.results):
            return self.results[self.selected_index]
        return None

    def on_click(self, event: events.Click) -> None:
        """Handle mouse clicks to select results."""
        if not self.results or not self.result_line_map:
            return

        # Get the Y coordinate relative to the widget
        click_y = event.y

        # Find the result index for this line
        for line_num, result_idx in self.result_line_map:
            if line_num == click_y:
                if result_idx != self.selected_index:
                    self.selected_index = result_idx
                    self.render_results()
                    # Post message to app to update preview
                    self.post_message(self.ResultSelected(result_idx))
                break

    def on_mouse_scroll_down(self, event: events.MouseScrollDown) -> None:
        """Handle mouse scroll down (next result)."""
        if self.results and self.selected_index < len(self.results) - 1:
            self.move_selection(1)
            # Post message to app to update preview
            self.post_message(self.ResultSelected(self.selected_index))

    def on_mouse_scroll_up(self, event: events.MouseScrollUp) -> None:
        """Handle mouse scroll up (previous result)."""
        if self.results and self.selected_index > 0:
            self.move_selection(-1)
            # Post message to app to update preview
            self.post_message(self.ResultSelected(self.selected_index))


class PreviewPane(Static):
    """Preview pane showing file content with syntax highlighting."""

    DEFAULT_CSS = """
    PreviewPane {
        height: 100%;
        overflow-y: auto;
        border: solid $accent;
    }
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.current_file = None

    def show_file(self, result: dict) -> None:
        """Show file preview from search result."""
        if not result:
            self.update(Text("📄 No file selected"))
            return

        file_path = result.get("file_path", "")
        matches = result.get("matches", [])

        # Use Rich Text to avoid markup parsing errors
        text = Text()
        text.append(f"📄 {file_path}\n\n")

        if matches and isinstance(matches, list) and len(matches) > 0:
            match = matches[0]
            # 'line' is the line number (int)
            line_num = match.get("line", 0)
            # 'context' is a dict with 'before' and 'after' arrays
            context = match.get("context", {})

            # Get the actual matched line text
            matched_text = match.get("highlight") or match.get("content", "")
            if matched_text is None:
                matched_text = ""

            # Build context lines
            before_lines = context.get("before", []) if isinstance(context, dict) else []
            after_lines = context.get("after", []) if isinstance(context, dict) else []

            # Show before context
            start_line = line_num - len(before_lines)
            for i, line_content in enumerate(before_lines):
                current_line = start_line + i
                if line_content is None:
                    line_content = ""
                elif not isinstance(line_content, str):
                    line_content = str(line_content)
                text.append(f"  {current_line:4d} │ {line_content}\n")

            # Show matched line
            text.append(f"► {line_num:4d} │ {matched_text}\n")

            # Show after context
            for i, line_content in enumerate(after_lines):
                current_line = line_num + i + 1
                if line_content is None:
                    line_content = ""
                elif not isinstance(line_content, str):
                    line_content = str(line_content)
                text.append(f"  {current_line:4d} │ {line_content}\n")
        else:
            text.append("(No preview available)")

        self.update(text)


class TimelineBar(Static):
    """Timeline/sparkline showing file activity over time."""

    DEFAULT_CSS = """
    TimelineBar {
        height: 1;
        dock: top;
    }
    """

    def __init__(self, es_client, indices, **kwargs):
        super().__init__(**kwargs)
        self.es = es_client
        self.indices = indices
        self.activity_data = []
        self.fetch_timeline_data()
        self.update(self.render_timeline())

    def fetch_timeline_data(self) -> None:
        """Fetch timeline data from versions index."""
        try:
            from datetime import datetime, timedelta
            from ..tui.sparkline import create_sparkline

            # Query versions index for recent activity
            now = datetime.now()
            week_ago = now - timedelta(days=7)

            body = {
                "query": {
                    "range": {
                        "created_at": {
                            "gte": int(week_ago.timestamp() * 1000)
                        }
                    }
                },
                "size": 0,
                "aggs": {
                    "activity_by_hour": {
                        "date_histogram": {
                            "field": "created_at",
                            "calendar_interval": "hour"
                        }
                    }
                }
            }

            result = self.es.search(self.indices["versions_index"], body)
            buckets = result.get("aggregations", {}).get("activity_by_hour", {}).get("buckets", [])

            # Extract counts
            self.activity_data = [bucket["doc_count"] for bucket in buckets]

        except Exception:
            # If versions index doesn't exist or query fails, use dummy data
            self.activity_data = []

    def render_timeline(self) -> str:
        """Render the timeline sparkline."""
        from datetime import datetime
        from ..tui.sparkline import create_sparkline

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

        if self.activity_data:
            sparkline = create_sparkline(self.activity_data, width=30)
            total = sum(self.activity_data)
            return f"Timeline (7d): {sparkline}  |  Activity: {total} changes  |  {timestamp}"
        else:
            return f"Timeline: ─────────────────────────  |  No version history  |  {timestamp}"


class RewindexTUI(App):
    """Interactive TUI for Rewindex code search."""

    CSS = """
    Screen {
        background: transparent;
    }

    Header {
        background: transparent;
        color: $text;
    }

    Footer {
        background: transparent;
        color: $text-muted;
    }

    SearchBar {
        background: transparent;
        width: 100%;
    }

    #main-container {
        height: 1fr;
        background: transparent;
    }

    #results-container {
        width: 45%;
        background: transparent;
    }

    #preview-container {
        width: 55%;
        background: transparent;
    }

    ResultsList {
        background: transparent;
        border: solid $primary;
        padding: 1;
    }

    PreviewPane {
        background: transparent;
        border: solid $accent;
        padding: 1;
    }

    TimelineBar {
        background: transparent;
        color: $text-muted;
        height: 1;
        content-align: center middle;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit", priority=True),
        Binding("question_mark", "help", "Help"),
        Binding("j", "next_result", "Next", show=False),
        Binding("k", "prev_result", "Prev", show=False),
        Binding("down", "next_result", "Next", show=False),
        Binding("up", "prev_result", "Prev", show=False),
        Binding("e", "edit_file", "Edit", show=True),
        Binding("f", "toggle_fuzzy", "Fuzzy", show=True),
        Binding("p", "toggle_partial", "Partial", show=True),
        Binding("t", "toggle_timeline", "Timeline", show=False),
        Binding("slash", "focus_search", "Search", show=False),
    ]

    def __init__(self, project_root: Optional[Path] = None, initial_query: str = "", **kwargs):
        super().__init__(**kwargs)
        self.project_root = project_root or find_project_root(Path.cwd())
        self.cfg = Config.load(self.project_root)
        self.es = ESClient(self.cfg.elasticsearch.host)
        self.indices = ensure_indices(self.es, self.cfg.resolved_index_prefix())
        self.initial_query = initial_query
        self.results_list = None
        self.preview_pane = None

    def compose(self) -> ComposeResult:
        """Create child widgets for the app."""
        yield Header(show_clock=True)
        yield TimelineBar(es_client=self.es, indices=self.indices)
        yield SearchBar()
        with Horizontal(id="main-container"):
            with Vertical(id="results-container"):
                self.results_list = ResultsList()
                yield self.results_list
            with Vertical(id="preview-container"):
                self.preview_pane = PreviewPane()
                yield self.preview_pane
        yield Footer()

    def on_mount(self) -> None:
        """Handle app mount."""
        # Set initial query if provided
        if self.initial_query:
            search_input = self.query_one("#search-input", Input)
            search_input.value = self.initial_query
            self.perform_search(self.initial_query)

        # Focus search input
        self.set_focus(self.query_one("#search-input"))

    def on_input_changed(self, event: Input.Changed) -> None:
        """Handle search input changes."""
        if event.input.id == "search-input":
            query = event.value
            if query:
                self.perform_search(query)
            else:
                self.results_list.update_results([])
                self.preview_pane.update(Text("📄 No file selected"))

    def on_checkbox_changed(self, event: Checkbox.Changed) -> None:
        """Handle checkbox state changes."""
        if event.checkbox.id in ("fuzzy-checkbox", "partial-checkbox"):
            # Re-run search if there's a query
            search_input = self.query_one("#search-input", Input)
            if search_input.value:
                self.perform_search(search_input.value)

    def perform_search(self, query: str) -> None:
        """Perform search and update results."""
        try:
            # Get checkbox states
            fuzzy_enabled = self.query_one("#fuzzy-checkbox", Checkbox).value
            partial_enabled = self.query_one("#partial-checkbox", Checkbox).value

            # Parse filters from query (simple version)
            # TODO: Implement proper filter parsing
            filters = SearchFilters()
            options = SearchOptions(
                limit=50,
                context_lines=5,
                highlight=False,
                fuzziness="AUTO" if fuzzy_enabled else None,
                partial=partial_enabled
            )

            results = simple_search_es(
                self.es,
                self.indices["files_index"],
                query,
                filters,
                options
            )

            search_results = results.get("results", [])

            # Validate search results structure
            if not isinstance(search_results, list):
                search_results = []

            self.results_list.update_results(search_results)

            # Show first result in preview
            if search_results:
                self.preview_pane.show_file(search_results[0])
            else:
                self.preview_pane.update(Text("📄 No results found"))

        except Exception as e:
            error_msg = Text(f"Search error: {str(e)}")
            self.results_list.update(error_msg)
            self.preview_pane.update(error_msg)

    def action_next_result(self) -> None:
        """Move to next result."""
        try:
            self.results_list.move_selection(1)
            selected = self.results_list.get_selected()
            if selected:
                self.preview_pane.show_file(selected)
        except Exception as e:
            self.preview_pane.update(Text(f"Navigation error: {e}"))

    def action_prev_result(self) -> None:
        """Move to previous result."""
        try:
            self.results_list.move_selection(-1)
            selected = self.results_list.get_selected()
            if selected:
                self.preview_pane.show_file(selected)
        except Exception as e:
            self.preview_pane.update(Text(f"Navigation error: {e}"))

    def on_results_list_result_selected(self, message: ResultsList.ResultSelected) -> None:
        """Handle result selection from mouse interaction."""
        try:
            selected = self.results_list.get_selected()
            if selected:
                self.preview_pane.show_file(selected)
        except Exception as e:
            self.preview_pane.update(Text(f"Preview error: {e}"))

    def action_edit_file(self) -> None:
        """Open selected file in $EDITOR."""
        import os
        import subprocess

        try:
            selected = self.results_list.get_selected()
            if not selected:
                return

            file_path = selected.get("file_path", "")
            if not file_path:
                return

            # Get line number from first match
            matches = selected.get("matches", [])
            line_num = 1
            if matches and isinstance(matches, list) and len(matches) > 0:
                # 'line' is the line number (int)
                line_num = matches[0].get("line", 1)
                if not isinstance(line_num, int):
                    line_num = 1

            # Construct editor command
            editor = os.environ.get("EDITOR", "vim")
            full_path = self.project_root / file_path

            # Different editors have different line number syntax
            if "vim" in editor or "nvim" in editor:
                cmd = [editor, f"+{line_num}", str(full_path)]
            elif "code" in editor:
                cmd = [editor, "-g", f"{full_path}:{line_num}"]
            else:
                cmd = [editor, str(full_path)]

            # Suspend TUI and run editor
            with self.suspend():
                subprocess.run(cmd)
        except Exception as e:
            # Show error in preview pane
            self.preview_pane.update(Text(f"Editor error: {e}"))

    def action_focus_search(self) -> None:
        """Focus the search input."""
        self.set_focus(self.query_one("#search-input"))

    def action_toggle_fuzzy(self) -> None:
        """Toggle fuzzy search mode."""
        try:
            checkbox = self.query_one("#fuzzy-checkbox", Checkbox)
            checkbox.value = not checkbox.value
            # Re-run search if there's a query
            search_input = self.query_one("#search-input", Input)
            if search_input.value:
                self.perform_search(search_input.value)
        except Exception:
            pass  # Ignore if checkbox doesn't exist yet

    def action_toggle_partial(self) -> None:
        """Toggle partial search mode."""
        try:
            checkbox = self.query_one("#partial-checkbox", Checkbox)
            checkbox.value = not checkbox.value
            # Re-run search if there's a query
            search_input = self.query_one("#search-input", Input)
            if search_input.value:
                self.perform_search(search_input.value)
        except Exception:
            pass  # Ignore if checkbox doesn't exist yet

    def action_toggle_timeline(self) -> None:
        """Toggle timeline mode (TODO)."""
        # Placeholder for timeline functionality
        pass

    def action_help(self) -> None:
        """Show help screen."""
        # TODO: Implement help modal
        pass
