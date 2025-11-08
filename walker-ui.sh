#!/usr/bin/env bash
#
# Rewindex Walker UI - Integration for Omarchy Walker
#
# This script provides a Walker-based search interface for Rewindex.
# It queries the Rewindex API and displays results in Walker, allowing
# you to open files directly in your default text editor.
#
# Usage:
#   1. Copy to ~/.config/walker/scripts/rewindex.sh
#   2. Make executable: chmod +x ~/.config/walker/scripts/rewindex.sh
#   3. Add to Walker config:
#      [[plugin]]
#      name = "rewindex"
#      src = "~/.config/walker/scripts/rewindex.sh"
#      prefix = "rw"
#
# Then in Walker:
#   rw search query
#

set -euo pipefail

# Configuration
REWINDEX_HOST="${REWINDEX_HOST:-127.0.0.1}"
REWINDEX_PORT="${REWINDEX_PORT:-8899}"
REWINDEX_URL="http://${REWINDEX_HOST}:${REWINDEX_PORT}"

# Detect Omarchy text editor
detect_editor() {
    # Priority order for Omarchy
    if command -v omarchy-edit &> /dev/null; then
        echo "omarchy-edit"
    elif command -v code &> /dev/null; then
        echo "code"
    elif command -v nvim &> /dev/null; then
        echo "nvim"
    elif command -v vim &> /dev/null; then
        echo "vim"
    elif [ -n "${EDITOR:-}" ]; then
        echo "$EDITOR"
    else
        echo "xdg-open"
    fi
}

# Search Rewindex API
search_rewindex() {
    local query="$1"
    local limit="${2:-20}"

    # Build JSON request
    local request
    request=$(cat <<EOF
{
  "query": "$query",
  "options": {
    "limit": $limit,
    "context_lines": 0,
    "highlight": false
  }
}
EOF
)

    # Query API
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$request" \
        "${REWINDEX_URL}/search/simple" 2>/dev/null || echo '{"results":[],"error":"Failed to connect to Rewindex"}'
}

# Format results for Walker display
format_for_walker() {
    local json="$1"

    # Parse JSON and format as Walker entries
    echo "$json" | jq -r '.results[] |
        "\(.file_path):\(.matches[0].line // 1)\t\(.language // "text")\t\(.matches[0].context[1] // "")"' 2>/dev/null | while IFS=$'\t' read -r path lang context; do
        # Format: icon path (language) - context snippet
        local icon=""
        case "$lang" in
            python) icon="🐍" ;;
            javascript|typescript) icon="🟨" ;;
            rust) icon="🦀" ;;
            go) icon="🐹" ;;
            java) icon="☕" ;;
            cpp|c) icon="⚙️" ;;
            ruby) icon="💎" ;;
            php) icon="🐘" ;;
            html) icon="🌐" ;;
            css) icon="🎨" ;;
            *) icon="📄" ;;
        esac

        # Truncate context to 80 chars
        local short_context
        short_context=$(echo "$context" | sed 's/^[[:space:]]*//' | cut -c1-80)

        # Output: icon path - snippet
        echo "$icon $path - $short_context"
    done
}

# Handle selection (open in editor)
open_file() {
    local selection="$1"
    local editor
    editor=$(detect_editor)

    # Extract file path and line number from selection
    # Format: "icon /path/to/file.py:123 - context"
    local file_path
    file_path=$(echo "$selection" | sed -E 's/^[^/]*//' | sed -E 's/ - .*$//' | tr -d ' ')

    # Split path and line
    local path
    local line
    path=$(echo "$file_path" | cut -d: -f1)
    line=$(echo "$file_path" | cut -d: -f2)

    # Default to line 1 if not specified
    if [ -z "$line" ] || ! [[ "$line" =~ ^[0-9]+$ ]]; then
        line=1
    fi

    # Expand to absolute path if relative
    if [[ ! "$path" =~ ^/ ]]; then
        # Assume relative to home directory (Rewindex indexes from ~/)
        path="${HOME}/${path}"
    fi

    # Open in editor with line number support
    case "$editor" in
        omarchy-edit|code)
            # VS Code / Omarchy Edit syntax: code --goto file:line:column
            "$editor" --goto "${path}:${line}:1" &
            ;;
        nvim|vim|vi)
            # Vim syntax: vim +line file
            # Launch in terminal
            if command -v kitty &> /dev/null; then
                kitty "$editor" "+${line}" "$path" &
            elif command -v alacritty &> /dev/null; then
                alacritty -e "$editor" "+${line}" "$path" &
            else
                "$editor" "+${line}" "$path"
            fi
            ;;
        nano)
            # Nano syntax: nano +line file
            if command -v kitty &> /dev/null; then
                kitty nano "+${line}" "$path" &
            else
                nano "+${line}" "$path"
            fi
            ;;
        *)
            # Fallback: just open the file
            "$editor" "$path" &
            ;;
    esac
}

# Main logic
main() {
    local mode="${1:-search}"
    shift || true

    case "$mode" in
        search)
            # Search mode: query and return results
            local query="${*:-}"
            if [ -z "$query" ]; then
                echo "🔍 Rewindex Search - Type your query"
                echo "📋 Usage: rw <search query>"
                echo "⚙️  Status: $(curl -s "${REWINDEX_URL}/index/status" &>/dev/null && echo "Connected ✓" || echo "Not running ✗")"
                exit 0
            fi

            # Perform search and format for Walker
            local results
            results=$(search_rewindex "$query" 20)

            # Check if we got valid results
            if echo "$results" | jq -e '.error' >/dev/null 2>&1; then
                local error
                error=$(echo "$results" | jq -r '.error')
                echo "❌ Error: $error"
                echo "💡 Make sure Rewindex server is running:"
                echo "   systemctl --user status rewindex"
                exit 1
            fi

            # Format and display results
            format_for_walker "$results"
            ;;

        open)
            # Open mode: handle selection
            local selection="${*:-}"
            if [ -n "$selection" ]; then
                open_file "$selection"
            fi
            ;;

        status)
            # Status check
            if curl -s "${REWINDEX_URL}/index/status" &>/dev/null; then
                local status
                status=$(curl -s "${REWINDEX_URL}/index/status" | jq -r '.status // "unknown"')
                echo "✓ Rewindex is running"
                echo "  Status: $status"
                echo "  URL: $REWINDEX_URL"
            else
                echo "✗ Rewindex is not running"
                echo "  Start with: systemctl --user start rewindex"
            fi
            ;;

        help|--help|-h)
            cat <<EOF
Rewindex Walker UI - Fast code search in Walker

USAGE:
    In Walker, type:
        rw <search query>       Search your codebase
        rw status              Check Rewindex status

EXAMPLES:
    rw authentication         Search for "authentication"
    rw useEffect             Search for "useEffect"
    rw TODO                  Find TODOs

SETUP:
    1. Copy this script to ~/.config/walker/scripts/rewindex.sh
    2. Make executable: chmod +x ~/.config/walker/scripts/rewindex.sh
    3. Add to Walker config (~/.config/walker/config.toml):

       [[plugin]]
       name = "rewindex"
       src = "~/.config/walker/scripts/rewindex.sh"
       prefix = "rw"

    4. Reload Walker

EDITOR:
    Opens files in your default editor:
    - Omarchy: omarchy-edit (auto-detected)
    - VS Code: code --goto
    - Neovim/Vim: terminal with +line
    - Fallback: \$EDITOR or xdg-open

CONFIGURATION:
    Environment variables:
        REWINDEX_HOST    - Server host (default: 127.0.0.1)
        REWINDEX_PORT    - Server port (default: 8899)
        EDITOR           - Text editor command

EOF
            ;;

        *)
            echo "Unknown mode: $mode"
            echo "Try: walker-ui.sh help"
            exit 1
            ;;
    esac
}

# Run
main "$@"
