#!/usr/bin/env bash
#
# Rewindex Rofi UI - Universal launcher integration
#
# This script provides a Rofi/dmenu-based search interface for Rewindex.
# Works with Rofi, dmenu, wofi, or any similar launcher.
#
# Usage:
#   rofi-ui.sh                    # Interactive mode
#   rofi-ui.sh "search query"     # Direct search
#
# Keybindings in Rofi:
#   Enter  - Open file in editor
#   Ctrl+Y - Copy file path to clipboard
#

set -euo pipefail

# Configuration
REWINDEX_HOST="${REWINDEX_HOST:-127.0.0.1}"
REWINDEX_PORT="${REWINDEX_PORT:-8899}"
REWINDEX_URL="http://${REWINDEX_HOST}:${REWINDEX_PORT}"

# Detect launcher (Rofi, wofi, dmenu, etc.)
detect_launcher() {
    if command -v rofi &> /dev/null; then
        echo "rofi -dmenu -i -p 'Rewindex'"
    elif command -v wofi &> /dev/null; then
        echo "wofi --dmenu -i -p 'Rewindex'"
    elif command -v dmenu &> /dev/null; then
        echo "dmenu -i -p 'Rewindex:'"
    else
        echo ""
    fi
}

# Detect text editor
detect_editor() {
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

# Show notification (Omarchy-aware)
notify() {
    local title="$1"
    local message="$2"

    if command -v notify-send &> /dev/null; then
        notify-send "$title" "$message" -i folder-saved-search
    fi
}

# Search Rewindex
search_rewindex() {
    local query="$1"
    local limit="${2:-50}"

    local request
    request=$(cat <<EOF
{
  "query": "$query",
  "options": {
    "limit": $limit,
    "context_lines": 2,
    "highlight": false
  }
}
EOF
)

    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$request" \
        "${REWINDEX_URL}/search/simple" 2>/dev/null
}

# Format results for display
format_results() {
    local json="$1"

    # Check for errors
    if echo "$json" | jq -e '.error' >/dev/null 2>&1; then
        echo "❌ Error: $(echo "$json" | jq -r '.error')"
        echo "💡 Start Rewindex: systemctl --user start rewindex"
        return 1
    fi

    # Parse and format results
    echo "$json" | jq -r '.results[] |
        .file_path as $path |
        .language as $lang |
        .matches[0] // {} |
        "\($path):\(.line // 1)\t\($lang)\t\(.context[1] // "")"
    ' | while IFS=$'\t' read -r path lang context; do
        # Icons for languages
        local icon="📄"
        case "$lang" in
            python) icon="🐍" ;;
            javascript|typescript) icon="🟨" ;;
            rust) icon="🦀" ;;
            go) icon="🐹" ;;
            java|kotlin|scala) icon="☕" ;;
            cpp|c) icon="⚙️" ;;
            ruby) icon="💎" ;;
            php) icon="🐘" ;;
            html|xml) icon="🌐" ;;
            css|scss|sass) icon="🎨" ;;
            sh|bash) icon="🐚" ;;
            markdown) icon="📝" ;;
        esac

        # Clean up context
        local clean_context
        clean_context=$(echo "$context" | tr '\n' ' ' | sed 's/^[[:space:]]*//' | cut -c1-100)

        # Output: icon path:line - context
        if [ -n "$clean_context" ]; then
            echo "$icon $path  │  $clean_context"
        else
            echo "$icon $path"
        fi
    done
}

# Open file in editor
open_in_editor() {
    local selection="$1"
    local editor
    editor=$(detect_editor)

    # Extract path:line from selection
    # Format: "icon /path/to/file:123  │  context"
    local file_ref
    file_ref=$(echo "$selection" | sed -E 's/^[^ ]+ //' | sed -E 's/ *│.*$//')

    local path line
    path=$(echo "$file_ref" | cut -d: -f1)
    line=$(echo "$file_ref" | cut -d: -f2)

    # Default to line 1
    if [ -z "$line" ] || ! [[ "$line" =~ ^[0-9]+$ ]]; then
        line=1
    fi

    # Expand relative paths
    if [[ ! "$path" =~ ^/ ]]; then
        path="${HOME}/${path}"
    fi

    # Open with appropriate syntax
    case "$editor" in
        omarchy-edit|code)
            "$editor" --goto "${path}:${line}:1" &
            notify "Rewindex" "Opened $(basename "$path"):${line}"
            ;;
        nvim|vim|vi)
            if command -v kitty &> /dev/null; then
                kitty "$editor" "+${line}" "$path" &
            elif command -v alacritty &> /dev/null; then
                alacritty -e "$editor" "+${line}" "$path" &
            elif command -v ghostty &> /dev/null; then
                ghostty "$editor" "+${line}" "$path" &
            else
                "$editor" "+${line}" "$path"
            fi
            notify "Rewindex" "Opened $(basename "$path"):${line} in $editor"
            ;;
        nano)
            if command -v kitty &> /dev/null; then
                kitty nano "+${line}" "$path" &
            else
                nano "+${line}" "$path"
            fi
            ;;
        *)
            "$editor" "$path" &
            ;;
    esac
}

# Copy path to clipboard
copy_to_clipboard() {
    local selection="$1"

    # Extract path from selection
    local file_ref
    file_ref=$(echo "$selection" | sed -E 's/^[^ ]+ //' | sed -E 's/ *│.*$//')

    local path
    path=$(echo "$file_ref" | cut -d: -f1)

    # Expand to absolute
    if [[ ! "$path" =~ ^/ ]]; then
        path="${HOME}/${path}"
    fi

    # Copy to clipboard
    if command -v wl-copy &> /dev/null; then
        echo "$path" | wl-copy
        notify "Rewindex" "Copied: $path"
    elif command -v xclip &> /dev/null; then
        echo "$path" | xclip -selection clipboard
        notify "Rewindex" "Copied: $path"
    elif command -v xsel &> /dev/null; then
        echo "$path" | xsel --clipboard
        notify "Rewindex" "Copied: $path"
    else
        notify "Rewindex" "No clipboard tool found"
    fi
}

# Main
main() {
    local launcher
    launcher=$(detect_launcher)

    if [ -z "$launcher" ]; then
        echo "Error: No launcher found (rofi, wofi, or dmenu required)"
        exit 1
    fi

    # Get query
    local query="${*:-}"

    if [ -z "$query" ]; then
        # Interactive mode
        query=$(echo "" | eval "$launcher -p 'Search Code:'")
        [ -z "$query" ] && exit 0
    fi

    # Search
    local results
    results=$(search_rewindex "$query" 50)

    # Format
    local formatted
    formatted=$(format_results "$results")

    if [ -z "$formatted" ]; then
        notify "Rewindex" "No results found for: $query"
        exit 0
    fi

    # Show results in launcher
    local selection
    selection=$(echo "$formatted" | eval "$launcher -p '$query:'")

    if [ -z "$selection" ]; then
        exit 0
    fi

    # Handle selection
    if [[ "$selection" == "❌"* ]]; then
        # Error message selected, do nothing
        exit 1
    fi

    # Open in editor
    open_in_editor "$selection"
}

# Run
main "$@"
