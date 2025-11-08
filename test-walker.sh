#!/usr/bin/env bash
#
# Test the Walker UI without installing
#
# This script simulates Walker's behavior and lets you test the integration
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WALKER_SCRIPT="${SCRIPT_DIR}/walker-ui.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                ║${NC}"
echo -e "${CYAN}║        Rewindex Walker UI - Test Mode          ║${NC}"
echo -e "${CYAN}║                                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Check if walker-ui.sh exists
if [ ! -f "$WALKER_SCRIPT" ]; then
    echo -e "${RED}Error: walker-ui.sh not found at $WALKER_SCRIPT${NC}"
    exit 1
fi

# Make sure it's executable
chmod +x "$WALKER_SCRIPT"

# Check if Rewindex is running
echo -e "${BLUE}→${NC} Checking Rewindex status..."
if curl -s http://127.0.0.1:8899/index/status &>/dev/null; then
    echo -e "${GREEN}✓${NC} Rewindex server is running"
    echo ""
else
    echo -e "${RED}✗${NC} Rewindex server is NOT running"
    echo -e "${YELLOW}!${NC} Start it with: systemctl --user start rewindex"
    echo -e "${YELLOW}!${NC} Or run: python3 -m rewindex.cli serve"
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    echo ""
fi

# Show help
echo -e "${BLUE}→${NC} Testing help mode..."
echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
"$WALKER_SCRIPT" help | head -20
echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
echo ""

# Test status
echo -e "${BLUE}→${NC} Testing status mode..."
echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
"$WALKER_SCRIPT" status
echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
echo ""

# Interactive test mode
echo -e "${GREEN}Interactive Test Mode${NC}"
echo -e "This simulates what Walker would show when you type 'rw <query>'"
echo ""

while true; do
    echo -e "${BLUE}→${NC} Enter search query (or 'quit' to exit):"
    read -p "> " query

    if [ "$query" = "quit" ] || [ "$query" = "exit" ] || [ "$query" = "q" ]; then
        echo -e "${GREEN}✓${NC} Exiting test mode"
        break
    fi

    if [ -z "$query" ]; then
        continue
    fi

    echo ""
    echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
    echo -e "${YELLOW}Results for:${NC} \"$query\""
    echo -e "${CYAN}─────────────────────────────────────────────────${NC}"

    # Run the search
    output=$("$WALKER_SCRIPT" search "$query" 2>&1 || true)

    if [ -z "$output" ]; then
        echo -e "${YELLOW}!${NC} No results found"
    else
        # Show results with line numbers
        echo "$output" | nl -w2 -s'. '
    fi

    echo -e "${CYAN}─────────────────────────────────────────────────${NC}"
    echo ""

    # Simulate selection
    if [ -n "$output" ]; then
        echo -e "${BLUE}→${NC} Select a result (number), or press Enter to search again:"
        read -p "> " selection

        if [ -n "$selection" ] && [[ "$selection" =~ ^[0-9]+$ ]]; then
            # Get the selected line
            selected_line=$(echo "$output" | sed -n "${selection}p")

            if [ -n "$selected_line" ]; then
                echo ""
                echo -e "${GREEN}✓${NC} Selected: $selected_line"
                echo -e "${BLUE}→${NC} Would open in editor:"

                # Extract path from selection
                path=$(echo "$selected_line" | sed -E 's/^[^ ]+ //' | sed -E 's/ *│.*$//' | cut -d: -f1)
                line=$(echo "$selected_line" | sed -E 's/^[^ ]+ //' | sed -E 's/ *│.*$//' | cut -d: -f2)

                echo -e "   Path: ${CYAN}$path${NC}"
                echo -e "   Line: ${CYAN}$line${NC}"

                # Show what command would run
                if command -v omarchy-edit &> /dev/null; then
                    echo -e "   Cmd:  ${GREEN}omarchy-edit --goto $path:$line:1${NC}"
                elif command -v code &> /dev/null; then
                    echo -e "   Cmd:  ${GREEN}code --goto $path:$line:1${NC}"
                else
                    echo -e "   Cmd:  ${GREEN}\$EDITOR +$line $path${NC}"
                fi

                echo ""
                echo -e "${YELLOW}→${NC} Actually open this file? [y/N]"
                read -p "> " -n 1 -r open_confirm
                echo

                if [[ $open_confirm =~ ^[Yy]$ ]]; then
                    echo -e "${GREEN}✓${NC} Opening file..."
                    "$WALKER_SCRIPT" open "$selected_line"
                fi
            else
                echo -e "${RED}✗${NC} Invalid selection"
            fi
        fi
    fi

    echo ""
done

echo ""
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Test Summary:${NC}"
echo ""
echo -e "Walker UI script: ${GREEN}$WALKER_SCRIPT${NC}"
echo ""
echo -e "To use with Walker:"
echo -e "  1. Copy to: ${CYAN}~/.config/walker/scripts/rewindex.sh${NC}"
echo -e "  2. Add to ${CYAN}~/.config/walker/config.toml${NC}:"
echo ""
echo -e "     ${YELLOW}[[plugin]]${NC}"
echo -e "     ${YELLOW}name = \"rewindex\"${NC}"
echo -e "     ${YELLOW}src = \"~/.config/walker/scripts/rewindex.sh\"${NC}"
echo -e "     ${YELLOW}prefix = \"rw\"${NC}"
echo ""
echo -e "  3. In Walker, type: ${GREEN}rw <query>${NC}"
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
