#!/usr/bin/env bash
#
# Create a GitHub release with the Rewindex binary
#
# Usage:
#   ./create-release.sh v1.0.0 [--draft] [--prerelease]
#
# Requirements:
#   - gh CLI installed and authenticated
#   - Binary already built in dist/rewindex
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
VERSION=""
DRAFT=""
PRERELEASE=""

for arg in "$@"; do
    case $arg in
        v*)
            VERSION="$arg"
            ;;
        --draft)
            DRAFT="--draft"
            ;;
        --prerelease)
            PRERELEASE="--prerelease"
            ;;
        --help|-h)
            echo "Usage: $0 <version> [--draft] [--prerelease]"
            echo ""
            echo "Arguments:"
            echo "  <version>      Release version (e.g., v1.0.0)"
            echo ""
            echo "Options:"
            echo "  --draft        Create as draft release"
            echo "  --prerelease   Mark as prerelease"
            echo ""
            echo "Example:"
            echo "  $0 v1.0.0"
            echo "  $0 v1.0.0-beta.1 --prerelease"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $arg${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

if [ -z "$VERSION" ]; then
    echo -e "${RED}Error: Version is required${NC}"
    echo "Usage: $0 <version> [--draft] [--prerelease]"
    exit 1
fi

echo -e "${GREEN}=== Creating Rewindex Release ===${NC}"
echo ""
echo "Version: $VERSION"
echo ""

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: gh CLI is not installed${NC}"
    echo "Install from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Check if binary exists
if [ ! -f "dist/rewindex" ]; then
    echo -e "${RED}Error: Binary not found at dist/rewindex${NC}"
    echo "Build with: ./build-binary.sh --clean"
    exit 1
fi

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)
        ARCH_NAME="x86_64"
        ;;
    aarch64|arm64)
        ARCH_NAME="arm64"
        ;;
    *)
        echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
        exit 1
        ;;
esac

# Rename binary to expected format
RELEASE_BINARY="rewindex-Linux-${ARCH_NAME}"
echo -e "${YELLOW}Copying binary to ${RELEASE_BINARY}...${NC}"
cp dist/rewindex "dist/${RELEASE_BINARY}"

# Make executable
chmod +x "dist/${RELEASE_BINARY}"

echo -e "${GREEN}✓ Binary prepared${NC}"
echo ""

# Generate release notes
RELEASE_NOTES="Rewindex ${VERSION}

## Installation

### Quick Install (Linux only)

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/main/install.sh | bash
\`\`\`

### Manual Install

Download the binary for your architecture:

- **x86_64**: \`rewindex-Linux-x86_64\`
- **ARM64**: \`rewindex-Linux-arm64\`

Then:

\`\`\`bash
# Make executable
chmod +x rewindex-Linux-*

# Install system-wide
sudo mv rewindex-Linux-* /usr/local/bin/rewindex

# Start server
rewindex serve --host 127.0.0.1 --port 8899

# Or search directly
rewindex \"authentication\" --limit 20
\`\`\`

## What's Changed

<!-- Add release notes here -->

## Requirements

- Docker (for Elasticsearch)
- Linux (systemd for service management)

## Documentation

- GitHub: https://github.com/ryrobes/rewindex
- Issues: https://github.com/ryrobes/rewindex/issues
"

# Create release
echo -e "${YELLOW}Creating GitHub release...${NC}"

gh release create "$VERSION" \
    "dist/${RELEASE_BINARY}" \
    --title "Rewindex ${VERSION}" \
    --notes "$RELEASE_NOTES" \
    $DRAFT \
    $PRERELEASE

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}=== Release Created Successfully ===${NC}"
    echo ""
    echo "Version: $VERSION"
    echo "Asset: ${RELEASE_BINARY}"
    echo ""
    echo "View release:"
    echo "  gh release view $VERSION --web"
    echo ""
    echo "Download URLs:"
    echo "  x86_64: https://github.com/ryrobes/rewindex/releases/download/${VERSION}/rewindex-Linux-x86_64"
    echo "  arm64:  https://github.com/ryrobes/rewindex/releases/download/${VERSION}/rewindex-Linux-arm64"
    echo ""

    if [ -n "$DRAFT" ]; then
        echo -e "${YELLOW}Note: Release is in draft mode${NC}"
        echo "Publish with: gh release edit $VERSION --draft=false"
        echo ""
    fi

    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Update release notes with actual changes"
    echo "2. Build and upload ARM64 binary (if not on ARM64 machine)"
    echo "3. Test installation: curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/main/install.sh | bash"
else
    echo -e "${RED}Release creation failed${NC}"
    exit 1
fi
