#!/usr/bin/env bash
#
# Test the Rofi UI without having Rofi installed
#
# This script simulates what rofi-ui.sh would do and shows the output
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROFI_SCRIPT="${SCRIPT_DIR}/rofi-ui.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                ║${NC}"
echo -e "${CYAN}║         Rewindex Rofi UI - Test Mode           ║${NC}"
echo -e "${CYAN}║                                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Check if rofi-ui.sh exists
if [ ! -f "$ROFI_SCRIPT" ]; then
    echo -e "${RED}Error: rofi-ui.sh not found at $ROFI_SCRIPT${NC}"
    exit 1
fi

chmod +x "$ROFI_SCRIPT"

# Check Rewindex
echo -e "${BLUE}→${NC} Checking Rewindex status..."
if curl -s http://127.0.0.1:8899/index/status &>/dev/null; then
    echo -e "${GREEN}✓${NC} Rewindex server is running"
else
    echo -e "${RED}✗${NC} Rewindex server is NOT running"
    echo -e "${YELLOW}!${NC} Start it with: systemctl --user start rewindex"
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

# Simulate a search directly (bypass rofi)
echo -e "${GREEN}Direct Search Test${NC}"
echo -e "This shows what would appear in Rofi's list"
echo ""

while true; do
    echo -e "${BLUE}→${NC} Enter search query (or 'quit' to exit):"
    read -p "> " query

    if [ "$query" = "quit" ] || [ "$query" = "exit" ] || [ "$query" = "q" ]; then
        break
    fi

    if [ -z "$query" ]; then
        continue
    fi

    echo ""
    echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
    echo -e "${YELLOW}Rofi would show:${NC}"
    echo -e "${CYAN}─────────────────────────────────────────────────${NC}"

    # Call the search directly
    REWINDEX_URL="http://127.0.0.1:8899"

    request=$(cat <<EOF
{
  "query": "$query",
  "options": {
    "limit": 50,
    "context_lines": 2,
    "highlight": false
  }
}
EOF
)

    results=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$request" \
        "${REWINDEX_URL}/search/simple" 2>/dev/null || echo '{"results":[]}')

    # Format results like rofi-ui.sh does
    formatted=$(echo "$results" | jq -r '.results[] |
        .file_path as $path |
        .language as $lang |
        .matches[0] // {} |
        "\($path):\(.line // 1)\t\($lang)\t\(.context[1] // "")"
    ' | while IFS=$'\t' read -r path lang context; do
        # Icons
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

        clean_context=$(echo "$context" | tr '\n' ' ' | sed 's/^[[:space:]]*//' | cut -c1-100)

        if [ -n "$clean_context" ]; then
            echo "$icon $path  │  $clean_context"
        else
            echo "$icon $path"
        fi
    done)

    if [ -z "$formatted" ]; then
        echo -e "${YELLOW}!${NC} No results found"
    else
        echo "$formatted" | nl -w2 -s'. '
    fi

    echo -e "${CYAN}─────────────────────────────────────────────────${NC}"

    # Check result count
    count=$(echo "$results" | jq -r '.results | length' 2>/dev/null || echo "0")
    echo -e "${BLUE}→${NC} Found ${GREEN}$count${NC} results"

    if [ -n "$formatted" ]; then
        echo ""
        echo -e "${YELLOW}→${NC} Select a number to see details (or press Enter for new search):"
        read -p "> " selection

        if [ -n "$selection" ] && [[ "$selection" =~ ^[0-9]+$ ]]; then
            selected=$(echo "$formatted" | sed -n "${selection}p")

            if [ -n "$selected" ]; then
                echo ""
                echo -e "${GREEN}Selected:${NC} $selected"
                echo ""

                # Extract path and line
                file_ref=$(echo "$selected" | sed -E 's/^[^ ]+ //' | sed -E 's/ *│.*$//')
                path=$(echo "$file_ref" | cut -d: -f1)
                line=$(echo "$file_ref" | cut -d: -f2)

                # Expand to absolute
                if [[ ! "$path" =~ ^/ ]]; then
                    path="${HOME}/${path}"
                fi

                echo -e "${BLUE}File:${NC} $path"
                echo -e "${BLUE}Line:${NC} $line"
                echo ""

                # Show what editor command would run
                if command -v omarchy-edit &> /dev/null; then
                    cmd="omarchy-edit --goto ${path}:${line}:1"
                elif command -v code &> /dev/null; then
                    cmd="code --goto ${path}:${line}:1"
                elif command -v nvim &> /dev/null; then
                    cmd="kitty nvim +${line} ${path}"
                else
                    cmd="\$EDITOR +${line} ${path}"
                fi

                echo -e "${BLUE}Command:${NC} ${GREEN}$cmd${NC}"
                echo ""
                echo -e "${YELLOW}→${NC} Open this file? [y/N]"
                read -p "> " -n 1 -r confirm
                echo

                if [[ $confirm =~ ^[Yy]$ ]]; then
                    echo -e "${GREEN}✓${NC} Opening..."
                    if command -v omarchy-edit &> /dev/null; then
                        omarchy-edit --goto "${path}:${line}:1" &
                    elif command -v code &> /dev/null; then
                        code --goto "${path}:${line}:1" &
                    elif command -v nvim &> /dev/null; then
                        if command -v kitty &> /dev/null; then
                            kitty nvim "+${line}" "$path" &
                        else
                            nvim "+${line}" "$path"
                        fi
                    else
                        ${EDITOR:-vi} "+${line}" "$path"
                    fi
                fi
            fi
        fi
    fi

    echo ""
done

echo ""
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Test Summary:${NC}"
echo ""
echo -e "To use the actual Rofi UI:"
echo -e "  ${GREEN}rewindex-rofi \"search query\"${NC}"
echo ""
echo -e "Or bind to keyboard shortcut (Hyprland example):"
echo -e "  ${YELLOW}bind = SUPER, S, exec, rewindex-rofi${NC}"
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
