#!/usr/bin/env bash
#
# Rewindex Installation Script
#
# Install Rewindex server as a systemd user service with Elasticsearch
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/refs/heads/master/install.sh | bash
#   # Or:
#   bash install.sh
#
# Requirements:
#   - Docker (for Elasticsearch)
#   - systemd (for service management)
#   - curl or wget
#

set -e

# Configuration
REWINDEX_VERSION="${REWINDEX_VERSION:-latest}"
GITHUB_REPO="${GITHUB_REPO:-ryrobes/rewindex}"
INSTALL_DIR="${HOME}/.local/bin"
SERVICE_DIR="${HOME}/.config/systemd/user"
DATA_DIR="${HOME}/.local/share/rewindex"
LOG_FILE="${DATA_DIR}/rewindex.log"
ES_PORT="${REWINDEX_ES_PORT:-9200}"
REWINDEX_PORT="${REWINDEX_PORT:-8899}"
REWINDEX_HOST="${REWINDEX_HOST:-127.0.0.1}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
info() {
    echo -e "${CYAN}==>${NC} $*"
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

# Banner
show_banner() {
    cat << "EOF"
    ____                _           __
   / __ \\___ _      __(_)___  ____/ /__  _  __
  / /_/ / _ \ | /| / / / __ \/ __  / _ \| |/_/
 / _, _/  __/ |/ |/ / / / / / /_/ /  __/>  <
/_/ |_|\___/|__/|__/_/_/ /_/\__,_/\___/_/|_|

EOF
}

# Check if running on Linux
check_os() {
    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        error "This installer is designed for Linux systems"
        error "Detected OS: $OSTYPE"
        exit 1
    fi
    success "OS: Linux"
}

# Check if systemd is available
check_systemd() {
    if ! command -v systemctl &> /dev/null; then
        error "systemd is required but not found"
        exit 1
    fi
    success "systemd found"
}

# Check if Docker is available
check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker is required but not found"
        error "Please install Docker first: https://docs.docker.com/engine/install/"
        exit 1
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        error "Docker is installed but not running"
        error "Please start Docker: sudo systemctl start docker"
        exit 1
    fi

    success "Docker is available"
}

# Check if Elasticsearch is already running
check_elasticsearch() {
    info "Checking for Elasticsearch..."

    if curl -fsSL "http://localhost:${ES_PORT}" &> /dev/null; then
        success "Elasticsearch is already running on port ${ES_PORT}"
        return 0
    else
        warn "Elasticsearch is not running"
        return 1
    fi
}

# Setup Elasticsearch via Docker
setup_elasticsearch() {
    info "Setting up Elasticsearch..."

    # Check if container already exists
    if docker ps -a --format '{{.Names}}' | grep -q "^rewindex-elasticsearch$"; then
        prompt "Elasticsearch container 'rewindex-elasticsearch' already exists."
        echo -n "Remove and recreate? [y/N] "
        read -r response < /dev/tty
        if [[ "$response" =~ ^[Yy]$ ]]; then
            info "Removing existing container..."
            docker rm -f rewindex-elasticsearch || true
        else
            info "Starting existing container..."
            docker start rewindex-elasticsearch
            sleep 5
            if check_elasticsearch; then
                success "Elasticsearch started"
                return 0
            else
                error "Failed to start existing container"
                return 1
            fi
        fi
    fi

    info "Creating Elasticsearch Docker container..."

    docker run -d \
        --name rewindex-elasticsearch \
        --restart unless-stopped \
        -p "${ES_PORT}:9200" \
        -e "discovery.type=single-node" \
        -e "xpack.security.enabled=false" \
        -e "ES_JAVA_OPTS=-Xms1024m -Xmx1024m" \
        -v rewindex-es-data:/usr/share/elasticsearch/data \
        docker.elastic.co/elasticsearch/elasticsearch:8.11.0

    if [ $? -ne 0 ]; then
        error "Failed to create Elasticsearch container"
        return 1
    fi

    info "Waiting for Elasticsearch to be ready..."
    for i in {1..30}; do
        if curl -fsSL "http://localhost:${ES_PORT}" &> /dev/null; then
            success "Elasticsearch is ready"
            return 0
        fi
        echo -n "."
        sleep 2
    done

    error "Elasticsearch failed to start within 60 seconds"
    error "Check logs with: docker logs rewindex-elasticsearch"
    return 1
}

# Detect system architecture
detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)
            echo "x86_64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        *)
            error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
}

# Download Rewindex binary
download_binary() {
    local arch
    arch=$(detect_arch)

    info "Downloading Rewindex binary for ${arch}..."

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Determine download URL
    if [ "$REWINDEX_VERSION" = "latest" ]; then
        local download_url="https://github.com/${GITHUB_REPO}/releases/latest/download/rewindex-Linux-${arch}"
    else
        local download_url="https://github.com/${GITHUB_REPO}/releases/download/${REWINDEX_VERSION}/rewindex-Linux-${arch}"
    fi

    info "Download URL: ${download_url}"

    # Download with curl or wget
    if command -v curl &> /dev/null; then
        curl -fsSL -o "${INSTALL_DIR}/rewindex" "$download_url"
    elif command -v wget &> /dev/null; then
        wget -q -O "${INSTALL_DIR}/rewindex" "$download_url"
    else
        error "Neither curl nor wget found"
        exit 1
    fi

    if [ $? -ne 0 ]; then
        error "Failed to download Rewindex binary"
        error "URL: $download_url"
        exit 1
    fi

    # Make executable
    chmod +x "${INSTALL_DIR}/rewindex"

    success "Binary installed to ${INSTALL_DIR}/rewindex"
}

# Create service wrapper script
create_wrapper() {
    local wrapper="${INSTALL_DIR}/rewindex-service"

    info "Creating service wrapper..."

    cat > "$wrapper" << 'WRAPPER_EOF'
#!/usr/bin/env bash
#
# Rewindex service wrapper
# Ensures service runs from home directory with proper environment
#

set -e

# Change to home directory for indexing
cd "$HOME"

# Set Elasticsearch host from environment or default
ES_HOST="${REWINDEX_ES_HOST:-localhost:9200}"
export REWINDEX_ES_HOST="$ES_HOST"

# Initialize project on first run
if [ ! -f "$HOME/.rewindex.json" ]; then
    echo "Initializing Rewindex in $HOME..."
    "$HOME/.local/bin/rewindex" index init
fi

# Start server
exec "$HOME/.local/bin/rewindex" serve \
    --host "${REWINDEX_HOST:-127.0.0.1}" \
    --port "${REWINDEX_PORT:-8899}"
WRAPPER_EOF

    chmod +x "$wrapper"
    success "Wrapper created at ${wrapper}"
}

# Create systemd user service
create_service() {
    info "Creating systemd user service..."

    mkdir -p "$SERVICE_DIR"
    mkdir -p "$DATA_DIR"

    cat > "${SERVICE_DIR}/rewindex.service" << SERVICE_EOF
[Unit]
Description=Rewindex Code Search Server
Documentation=https://github.com/${GITHUB_REPO}
After=network.target

[Service]
Type=simple
WorkingDirectory=%h
Environment="HOME=%h"
Environment="REWINDEX_ES_HOST=localhost:${ES_PORT}"
Environment="REWINDEX_HOST=${REWINDEX_HOST}"
Environment="REWINDEX_PORT=${REWINDEX_PORT}"
ExecStart=%h/.local/bin/rewindex-service
Restart=always
RestartSec=10
StandardOutput=append:%h/.local/share/rewindex/rewindex.log
StandardError=append:%h/.local/share/rewindex/rewindex.log

# Resource limits (adjust as needed)
MemoryMax=2G
CPUQuota=100%

[Install]
WantedBy=default.target
SERVICE_EOF

    success "Service file created at ${SERVICE_DIR}/rewindex.service"
}

# Enable and start service
enable_service() {
    info "Enabling Rewindex service..."

    # Reload systemd daemon
    systemctl --user daemon-reload

    # Enable service
    systemctl --user enable rewindex.service

    # Start service
    systemctl --user start rewindex.service

    # Wait a moment and check status
    sleep 2

    if systemctl --user is-active --quiet rewindex.service; then
        success "Rewindex service is running"
    else
        error "Rewindex service failed to start"
        error "Check logs with: journalctl --user -u rewindex -f"
        return 1
    fi
}

# Install .rewindexignore to home directory
install_rewindexignore() {
    info "Installing .rewindexignore..."

    # Check if .rewindexignore already exists
    if [ -f "${HOME}/.rewindexignore" ]; then
        prompt ".rewindexignore already exists in home directory. Overwrite? [y/N]"
        read -r response < /dev/tty
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            info "Keeping existing .rewindexignore"
            return 0
        fi
    fi

    # Download .rewindexignore from GitHub
    local rewindexignore_url="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/master/.rewindexignore"

    info "Downloading .rewindexignore from ${rewindexignore_url}"

    if command -v curl &> /dev/null; then
        curl -fsSL "$rewindexignore_url" -o "${HOME}/.rewindexignore"
    elif command -v wget &> /dev/null; then
        wget -q -O "${HOME}/.rewindexignore" "$rewindexignore_url"
    else
        error "Neither curl nor wget found"
        return 1
    fi

    if [ $? -eq 0 ]; then
        success ".rewindexignore installed to ${HOME}/.rewindexignore"
        info "This file prevents indexing of caches, build artifacts, and other noise"
    else
        warn "Failed to download .rewindexignore (continuing anyway)"
    fi
}

# Check if Omarchy is installed and meets version requirements
check_omarchy() {
    if ! command -v omarchy-version &> /dev/null; then
        return 1
    fi

    local version
    version=$(omarchy-version 2>/dev/null | grep -oP '^\d+\.\d+\.\d+' || echo "0.0.0")
    local major
    major=$(echo "$version" | cut -d. -f1)

    # Require version 3.x.x or higher
    if [ "$major" -ge 3 ]; then
        return 0
    else
        return 1
    fi
}

# Install desktop entry and icon
install_desktop_entry() {
    info "Installing desktop application entry..."

    # Create directories
    mkdir -p "${HOME}/.local/share/applications"
    mkdir -p "${DATA_DIR}"

    # Download icon
    local icon_url="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/master/rewindex/web/logo.png"
    local icon_path="${DATA_DIR}/logo.png"

    info "Downloading application icon..."

    if command -v curl &> /dev/null; then
        curl -fsSL "$icon_url" -o "$icon_path"
    elif command -v wget &> /dev/null; then
        wget -q -O "$icon_path" "$icon_url"
    else
        error "Neither curl nor wget found"
        return 1
    fi

    if [ $? -ne 0 ]; then
        warn "Failed to download icon (continuing anyway)"
        icon_path=""
    else
        success "Icon installed to ${icon_path}"
    fi

    # Create desktop entry
    local desktop_file="${HOME}/.local/share/applications/REWINDex.desktop"

    cat > "$desktop_file" << DESKTOP_EOF
[Desktop Entry]
Version=1.0
Name=REWINDex
Comment=Fast code search powered by Elasticsearch
Exec=xdg-open http://${REWINDEX_HOST}:${REWINDEX_PORT}/ui
Terminal=false
Type=Application
Icon=${icon_path}
Categories=Development;Utility;
StartupNotify=true
DESKTOP_EOF

    # Use omarchy-launch-webapp if Omarchy 3.x+ is detected
    if check_omarchy; then
        local omarchy_version
        omarchy_version=$(omarchy-version 2>/dev/null | grep -oP '^\d+\.\d+\.\d+' || echo "unknown")
        info "Detected Omarchy ${omarchy_version} - using omarchy-launch-webapp"
        sed -i "s|^Exec=.*|Exec=omarchy-launch-webapp http://${REWINDEX_HOST}:${REWINDEX_PORT}/ui|" "$desktop_file"
    fi

    success "Desktop entry installed to ${desktop_file}"

    # Update desktop database (if available)
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
        success "Desktop database updated"
    fi
}

# Install Omarchy Walker/Rofi integration (optional)
install_launcher_integration() {
    if ! check_omarchy; then
        return 0
    fi

    info "Installing Omarchy launcher integrations..."

    # Download scripts
    local rofi_url="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/master/rofi-ui.sh"
    local walker_url="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/master/walker-ui.sh"

    # Install Rofi UI
    if command -v rofi &> /dev/null || command -v wofi &> /dev/null; then
        info "Installing Rofi/Wofi integration..."
        if command -v curl &> /dev/null; then
            curl -fsSL "$rofi_url" -o "${INSTALL_DIR}/rewindex-rofi"
        elif command -v wget &> /dev/null; then
            wget -q -O "${INSTALL_DIR}/rewindex-rofi" "$rofi_url"
        fi

        if [ -f "${INSTALL_DIR}/rewindex-rofi" ]; then
            chmod +x "${INSTALL_DIR}/rewindex-rofi"
            success "Rofi integration installed: rewindex-rofi"
            info "Usage: rewindex-rofi \"search query\""
        fi
    fi

    # Install Walker integration
    if [ -d "${HOME}/.config/walker" ]; then
        info "Installing Walker plugin..."
        mkdir -p "${HOME}/.config/walker/scripts"

        if command -v curl &> /dev/null; then
            curl -fsSL "$walker_url" -o "${HOME}/.config/walker/scripts/rewindex.sh"
        elif command -v wget &> /dev/null; then
            wget -q -O "${HOME}/.config/walker/scripts/rewindex.sh" "$walker_url"
        fi

        if [ -f "${HOME}/.config/walker/scripts/rewindex.sh" ]; then
            chmod +x "${HOME}/.config/walker/scripts/rewindex.sh"
            success "Walker plugin installed"
            info "Add to ~/.config/walker/config.toml:"
            info "  [[plugin]]"
            info "  name = \"rewindex\""
            info "  src = \"~/.config/walker/scripts/rewindex.sh\""
            info "  prefix = \"rw\""
        fi
    fi
}

# Setup log rotation (optional)
setup_logrotate() {
    local logrotate_config="${HOME}/.config/logrotate/rewindex"

    info "Setting up log rotation..."

    mkdir -p "${HOME}/.config/logrotate"

    cat > "$logrotate_config" << LOGROTATE_EOF
${LOG_FILE} {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ${USER} ${USER}
}
LOGROTATE_EOF

    success "Log rotation configured"
    info "To enable, add to crontab: @daily /usr/bin/logrotate ${logrotate_config}"
}

# Configure PATH
configure_path() {
    local shell_rc

    # Detect shell
    if [ -n "$BASH_VERSION" ]; then
        shell_rc="${HOME}/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then
        shell_rc="${HOME}/.zshrc"
    else
        shell_rc="${HOME}/.profile"
    fi

    # Check if PATH already includes ~/.local/bin
    if [[ ":$PATH:" != *":${HOME}/.local/bin:"* ]]; then
        info "Adding ${HOME}/.local/bin to PATH in ${shell_rc}"
        echo '' >> "$shell_rc"
        echo '# Added by Rewindex installer' >> "$shell_rc"
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_rc"
        success "PATH updated in ${shell_rc}"
        warn "Run 'source ${shell_rc}' or restart your shell"
    else
        success "PATH already includes ${HOME}/.local/bin"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                ║${NC}"
    echo -e "${GREEN}║        Rewindex Installation Complete          ║${NC}"
    echo -e "${GREEN}║                                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
    echo ""

    info "Service Status:"
    systemctl --user status rewindex.service --no-pager || true

    echo ""
    info "Useful Commands:"
    echo "  Web UI:           http://${REWINDEX_HOST}:${REWINDEX_PORT}/ui"
    echo "  Service status:   systemctl --user status rewindex"
    echo "  View logs:        journalctl --user -u rewindex -f"
    echo "  Restart service:  systemctl --user restart rewindex"
    echo "  Stop service:     systemctl --user stop rewindex"
    echo "  CLI search:       rewindex \"query\" --limit 20"
    echo "  CLI help:         rewindex --help"
    echo ""

    info "Configuration:"
    echo "  Binary:           ${INSTALL_DIR}/rewindex"
    echo "  Service:          ${SERVICE_DIR}/rewindex.service"
    echo "  Logs:             ${LOG_FILE}"
    echo "  Desktop Entry:    ${HOME}/.local/share/applications/REWINDex.desktop"
    echo "  Ignore Patterns:  ${HOME}/.rewindexignore"
    echo "  Elasticsearch:    http://localhost:${ES_PORT}"
    echo ""

    info "Next Steps:"
    echo "  1. Open http://${REWINDEX_HOST}:${REWINDEX_PORT}/ui in your browser"
    echo "  2. Wait for initial indexing to complete (check logs)"
    echo "  3. Start searching:"
    echo "     - Web UI: http://${REWINDEX_HOST}:${REWINDEX_PORT}/ui"
    echo "     - CLI: rewindex \"your query\" --limit 20"
    echo ""
}

# Uninstall function (for reference)
show_uninstall_instructions() {
    info "To uninstall Rewindex:"
    echo "  systemctl --user stop rewindex"
    echo "  systemctl --user disable rewindex"
    echo "  rm -f ${INSTALL_DIR}/rewindex"
    echo "  rm -f ${INSTALL_DIR}/rewindex-service"
    echo "  rm -f ${SERVICE_DIR}/rewindex.service"
    echo "  systemctl --user daemon-reload"
    echo "  docker stop rewindex-elasticsearch"
    echo "  docker rm rewindex-elasticsearch"
    echo ""
}

# Main installation flow
main() {
    clear
    show_banner
    echo ""

    info "Starting Rewindex installation..."
    echo ""

    # Pre-flight checks
    check_os
    check_systemd
    check_docker

    echo ""

    # Elasticsearch setup
    if ! check_elasticsearch; then
        prompt "Would you like to set up Elasticsearch via Docker? [Y/n]"
        read -r response < /dev/tty
        if [[ ! "$response" =~ ^[Nn]$ ]]; then
            setup_elasticsearch || exit 1
        else
            warn "Skipping Elasticsearch setup"
            warn "You'll need to configure REWINDEX_ES_HOST manually"
        fi
    fi

    echo ""

    # Prompt for custom configuration
    prompt "Rewindex server port (default: ${REWINDEX_PORT}):"
    read -r custom_port < /dev/tty
    if [ -n "$custom_port" ]; then
        REWINDEX_PORT="$custom_port"
    fi

    prompt "Rewindex server host (default: ${REWINDEX_HOST}):"
    read -r custom_host < /dev/tty
    if [ -n "$custom_host" ]; then
        REWINDEX_HOST="$custom_host"
    fi

    echo ""

    # Download and install
    download_binary
    create_wrapper
    create_service
    install_rewindexignore
    install_desktop_entry
    install_launcher_integration
    configure_path
    setup_logrotate

    echo ""

    # Start service
    enable_service

    echo ""

    # Prompt for initial indexing
    prompt "Would you like to run the initial index now? [Y/n]"
    read -r response < /dev/tty
    if [[ ! "$response" =~ ^[Nn]$ ]]; then
        info "Starting initial indexing of ${HOME}..."
        info "This may take a few minutes depending on the size of your home directory"
        info "The watcher is already running in the background via the systemd service"
        echo ""

        "${INSTALL_DIR}/rewindex" index start || {
            warn "Initial indexing encountered errors (this is normal)"
            info "The watcher will continue indexing in the background"
        }

        echo ""
        success "Initial indexing complete!"
        info "The watcher will now keep your index up-to-date automatically"
    else
        info "Skipping initial indexing"
        info "You can run it later with: rewindex index start"
    fi

    # Show summary
    print_summary

    # Uninstall instructions
    show_uninstall_instructions
}

# Run main function
main "$@"
