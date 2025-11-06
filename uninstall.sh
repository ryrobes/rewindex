#!/usr/bin/env bash
#
# Rewindex Uninstall Script
#
# Removes Rewindex server, service, and optionally Elasticsearch
#
# Usage:
#   bash uninstall.sh [--keep-data] [--keep-elasticsearch]
#

set -e

# Configuration
INSTALL_DIR="${HOME}/.local/bin"
SERVICE_DIR="${HOME}/.config/systemd/user"
DATA_DIR="${HOME}/.local/share/rewindex"

# Options
KEEP_DATA=false
KEEP_ELASTICSEARCH=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() {
    echo -e "${BLUE}==>${NC} $*"
}

success() {
    echo -e "${GREEN}✓${NC} $*"
}

warn() {
    echo -e "${YELLOW}!${NC} $*"
}

error() {
    echo -e "${RED}✗${NC} $*" >&2
}

prompt() {
    echo -e "${BLUE}?${NC} $*"
}

# Parse arguments
for arg in "$@"; do
    case $arg in
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
        --keep-elasticsearch)
            KEEP_ELASTICSEARCH=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--keep-data] [--keep-elasticsearch]"
            echo ""
            echo "Options:"
            echo "  --keep-data            Keep indexed data and configuration"
            echo "  --keep-elasticsearch   Keep Elasticsearch Docker container"
            exit 0
            ;;
    esac
done

# Banner
echo ""
echo -e "${RED}╔════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║                                                ║${NC}"
echo -e "${RED}║          Rewindex Uninstaller                  ║${NC}"
echo -e "${RED}║                                                ║${NC}"
echo -e "${RED}╚════════════════════════════════════════════════╝${NC}"
echo ""

warn "This will remove Rewindex from your system"
echo ""

# Confirm
prompt "Are you sure you want to uninstall? [y/N]"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    info "Uninstall cancelled"
    exit 0
fi

echo ""

# Stop service
if systemctl --user is-active --quiet rewindex.service 2>/dev/null; then
    info "Stopping Rewindex service..."
    systemctl --user stop rewindex.service
    success "Service stopped"
else
    info "Service is not running"
fi

# Disable service
if systemctl --user is-enabled --quiet rewindex.service 2>/dev/null; then
    info "Disabling Rewindex service..."
    systemctl --user disable rewindex.service
    success "Service disabled"
fi

# Remove service file
if [ -f "${SERVICE_DIR}/rewindex.service" ]; then
    info "Removing service file..."
    rm -f "${SERVICE_DIR}/rewindex.service"
    success "Service file removed"
fi

# Reload systemd
if command -v systemctl &> /dev/null; then
    systemctl --user daemon-reload
    systemctl --user reset-failed 2>/dev/null || true
fi

# Remove binaries
if [ -f "${INSTALL_DIR}/rewindex-server" ]; then
    info "Removing Rewindex binary..."
    rm -f "${INSTALL_DIR}/rewindex-server"
    success "Binary removed"
fi

if [ -f "${INSTALL_DIR}/rewindex-service" ]; then
    info "Removing service wrapper..."
    rm -f "${INSTALL_DIR}/rewindex-service"
    success "Wrapper removed"
fi

# Remove desktop entry
if [ -f "${HOME}/.local/share/applications/REWINDex.desktop" ]; then
    info "Removing desktop entry..."
    rm -f "${HOME}/.local/share/applications/REWINDex.desktop"
    success "Desktop entry removed"

    # Update desktop database
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
    fi
fi

# Remove .rewindexignore
if [ -f "${HOME}/.rewindexignore" ]; then
    prompt "Remove .rewindexignore from home directory? [y/N]"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        info "Removing .rewindexignore..."
        rm -f "${HOME}/.rewindexignore"
        success ".rewindexignore removed"
    else
        info "Keeping .rewindexignore"
    fi
fi

# Remove data
if [ "$KEEP_DATA" = false ]; then
    prompt "Remove indexed data and logs? [y/N]"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        if [ -d "$DATA_DIR" ]; then
            info "Removing data directory..."
            rm -rf "$DATA_DIR"
            success "Data directory removed"
        fi

        # Remove .rewindex.json from home
        if [ -f "${HOME}/.rewindex.json" ]; then
            info "Removing configuration file..."
            rm -f "${HOME}/.rewindex.json"
            success "Configuration removed"
        fi

        # Remove .rewindex directory from home
        if [ -d "${HOME}/.rewindex" ]; then
            info "Removing .rewindex directory..."
            rm -rf "${HOME}/.rewindex"
            success ".rewindex directory removed"
        fi
    else
        info "Keeping data directory: ${DATA_DIR}"
    fi
else
    info "Keeping data (--keep-data specified)"
fi

# Remove Elasticsearch
if [ "$KEEP_ELASTICSEARCH" = false ]; then
    if command -v docker &> /dev/null; then
        if docker ps -a --format '{{.Names}}' | grep -q "^rewindex-elasticsearch$"; then
            prompt "Remove Elasticsearch Docker container? [y/N]"
            read -r response
            if [[ "$response" =~ ^[Yy]$ ]]; then
                info "Stopping Elasticsearch container..."
                docker stop rewindex-elasticsearch 2>/dev/null || true

                info "Removing Elasticsearch container..."
                docker rm rewindex-elasticsearch

                prompt "Remove Elasticsearch data volume? (This deletes all indexed data) [y/N]"
                read -r response
                if [[ "$response" =~ ^[Yy]$ ]]; then
                    info "Removing Elasticsearch data volume..."
                    docker volume rm rewindex-es-data 2>/dev/null || true
                    success "Elasticsearch volume removed"
                else
                    info "Keeping Elasticsearch volume: rewindex-es-data"
                fi

                success "Elasticsearch container removed"
            else
                info "Keeping Elasticsearch container"
            fi
        fi
    fi
else
    info "Keeping Elasticsearch (--keep-elasticsearch specified)"
fi

# Remove logrotate config
if [ -f "${HOME}/.config/logrotate/rewindex" ]; then
    info "Removing logrotate configuration..."
    rm -f "${HOME}/.config/logrotate/rewindex"
    success "Logrotate config removed"
fi

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                ║${NC}"
echo -e "${GREEN}║     Rewindex Uninstalled Successfully          ║${NC}"
echo -e "${GREEN}║                                                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""

info "What was removed:"
echo "  ✓ Rewindex server binary"
echo "  ✓ Systemd user service"
echo "  ✓ Desktop application entry"
if [ "$KEEP_DATA" = false ]; then
    echo "  ✓ Configuration and data"
fi
if [ "$KEEP_ELASTICSEARCH" = false ]; then
    echo "  ✓ Elasticsearch container"
fi

echo ""

if [ "$KEEP_DATA" = true ] || [ "$KEEP_ELASTICSEARCH" = true ]; then
    warn "Some components were kept:"
    [ "$KEEP_DATA" = true ] && echo "  - Data directory: ${DATA_DIR}"
    [ "$KEEP_ELASTICSEARCH" = true ] && echo "  - Elasticsearch container: rewindex-elasticsearch"
    echo ""
    info "To reinstall with existing data:"
    echo "  curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/rewindex/main/install.sh | bash"
    echo ""
fi

info "Thank you for using Rewindex!"
echo ""
