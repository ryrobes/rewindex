#!/usr/bin/env bash
#
# Build standalone Rewindex server binary with PyInstaller
#
# Usage:
#   ./build-binary.sh [--clean] [--tui]
#
# Options:
#   --clean   Remove build artifacts before building
#   --tui     Include TUI dependencies (textual + pygments)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
CLEAN=false
INCLUDE_TUI=false

for arg in "$@"; do
    case $arg in
        --clean)
            CLEAN=true
            shift
            ;;
        --tui)
            INCLUDE_TUI=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--clean] [--tui]"
            echo ""
            echo "Options:"
            echo "  --clean   Remove build artifacts before building"
            echo "  --tui     Include TUI dependencies (textual + pygments)"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $arg${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}=== Rewindex Binary Build ===${NC}"
echo ""

# Check if PyInstaller is installed
if ! python3 -c "import PyInstaller" 2>/dev/null; then
    echo -e "${RED}Error: PyInstaller is not installed${NC}"
    echo "Install with: pip install pyinstaller"
    exit 1
fi

# Check if watchdog is installed
if ! python3 -c "import watchdog" 2>/dev/null; then
    echo -e "${RED}Error: watchdog is not installed${NC}"
    echo "Install with: pip install watchdog"
    exit 1
fi

# Check TUI dependencies if requested
if [ "$INCLUDE_TUI" = true ]; then
    echo -e "${YELLOW}Checking TUI dependencies...${NC}"
    if ! python3 -c "import textual" 2>/dev/null; then
        echo -e "${RED}Error: textual is not installed${NC}"
        echo "Install with: pip install textual"
        exit 1
    fi
    if ! python3 -c "import pygments" 2>/dev/null; then
        echo -e "${RED}Error: pygments is not installed${NC}"
        echo "Install with: pip install pygments"
        exit 1
    fi
    echo -e "${GREEN}✓ TUI dependencies found${NC}"
fi

# Clean build artifacts if requested
if [ "$CLEAN" = true ]; then
    echo -e "${YELLOW}Cleaning build artifacts...${NC}"
    rm -rf build/ dist/ *.spec.bak
    echo -e "${GREEN}✓ Clean complete${NC}"
fi

# Build the binary
echo ""
echo -e "${YELLOW}Building standalone binary...${NC}"
echo "This may take a few minutes..."
echo ""

pyinstaller rewindex-server.spec --clean --noconfirm

# Check if build succeeded
if [ -f "dist/rewindex" ]; then
    echo ""
    echo -e "${GREEN}=== Build Complete ===${NC}"
    echo ""
    echo "Binary location: $(pwd)/dist/rewindex"

    # Show binary size
    SIZE=$(du -h dist/rewindex | cut -f1)
    echo "Binary size: $SIZE"

    echo ""
    echo "To install system-wide:"
    echo "  sudo cp dist/rewindex /usr/local/bin/"
    echo ""
    echo "To run locally:"
    echo "  ./dist/rewindex serve --host 127.0.0.1 --port 8899"
    echo ""
    echo "Search shorthand:"
    echo "  ./dist/rewindex \"auth\" --limit 20"
    echo ""

    # Test the binary
    echo -e "${YELLOW}Testing binary...${NC}"
    if ./dist/rewindex --help > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Binary test passed${NC}"
    else
        echo -e "${RED}✗ Binary test failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi
