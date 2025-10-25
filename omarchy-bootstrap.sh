#!/bin/bash
# deploy.sh - hosted on your GitHub repo
# Users run: wget -qO- https://raw.githubusercontent.com/you/repo/main/omarchy-install.sh | bash

set -euo pipefail

INSTALLER_NAME="MyApp Suite"
INSTALLER_VERSION="1.0.0"
OMARCHY_PATH="$HOME/.local/share/omarchy"

echo "🚀 Installing $INSTALLER_NAME installer into Omarchy..."

# Step 1: Create the actual installer script
cat > "$OMARCHY_PATH/install/apps/myapp_installer.sh" << 'INSTALLER_EOF'
#!/bin/bash
# This is the actual installer that will run from Omarchy menu

install_myapp() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "   MyApp Installation"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Pull latest configs from GitHub
    echo "📦 Fetching latest configuration..."
    temp_dir=$(mktemp -d)
    git clone --quiet https://github.com/you/myapp-omarchy.git "$temp_dir"
    
    # Setup Docker containers
    echo "🐳 Setting up Docker containers..."
    cd "$temp_dir"
    docker-compose pull
    docker-compose up -d
    
    # Setup Python server
    echo "🐍 Installing Python server..."
    sudo mkdir -p /opt/myapp
    sudo cp -r "$temp_dir/server" /opt/myapp/
    python3 -m venv /opt/myapp/venv
    /opt/myapp/venv/bin/pip install -r /opt/myapp/server/requirements.txt
    
    # Create systemd service
    echo "⚙️  Creating system service..."
    sudo cp "$temp_dir/systemd/myapp.service" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now myapp
    
    # Create web app shortcuts
    echo "🌐 Adding web app shortcuts..."
    cp "$temp_dir/desktop/"*.desktop ~/.local/share/applications/
    update-desktop-database ~/.local/share/applications/
    
    # Cleanup
    rm -rf "$temp_dir"
    
    echo ""
    echo "✅ Installation complete!"
    echo "   • Web UI: http://localhost:8080"
    echo "   • Launch: Super + Space → 'MyApp'"
    echo ""
    read -p "Press [Enter] to continue..."
}

# Run the installer
install_myapp
INSTALLER_EOF

chmod +x "$OMARCHY_PATH/install/apps/myapp_installer.sh"

# Step 2: Patch the Omarchy menu to add our option
MENU_FILE="$OMARCHY_PATH/bin/omarchy-menu"
MENU_BACKUP="$MENU_FILE.backup.$(date +%s)"

# Backup the original menu
cp "$MENU_FILE" "$MENU_BACKUP"

# Check if our entry already exists
if ! grep -q "MyApp Suite" "$MENU_FILE"; then
    echo "📝 Adding $INSTALLER_NAME to Omarchy menu..."
    
    # Find the show_install_menu function and add our option
    # This is a bit tricky but preserves the existing structure
    
    # Create a temporary patch file
    cat > /tmp/omarchy_menu_patch << 'PATCH_EOF'
# Add MyApp Suite installer option
# This patch adds a new menu item to the Install menu
# Applied by MyApp installer

# Find this line in show_install_menu():
#   *) show_main_menu ;;
# And add before it:
#   *MyApp\ Suite*) present_terminal "$OMARCHY_PATH/install/apps/myapp_installer.sh" ;;

PATCH_EOF
    
    # Apply the patch using sed (more robust than simple append)
    sed -i '/show_install_menu()/,/^}$/{
        /\*) show_main_menu ;;/i\
  *MyApp\ Suite*) present_terminal "$HOME/.local/share/omarchy/install/apps/myapp_installer.sh" ;;
    }' "$MENU_FILE"
    
    # Also need to add the menu option to the list
    sed -i '/show_install_menu()/,/case.*menu/{
        s/\(case.*menu.*Install.*\)\(".*\)$/\1\\n🚀  MyApp Suite\2/
    }' "$MENU_FILE"
fi

# Step 3: Create an uninstaller
cat > "$OMARCHY_PATH/install/apps/myapp_uninstaller.sh" << 'UNINSTALLER_EOF'
#!/bin/bash
echo "Removing MyApp Suite..."

# Stop services
sudo systemctl stop myapp || true
sudo systemctl disable myapp || true
sudo rm -f /etc/systemd/system/myapp.service

# Remove Docker containers
docker-compose -f /opt/myapp/docker-compose.yml down || true
docker rm -f myapp-web myapp-db || true

# Remove files
sudo rm -rf /opt/myapp
rm -f ~/.local/share/applications/myapp*.desktop

# Remove from Omarchy menu
sed -i '/MyApp Suite/d' "$HOME/.local/share/omarchy/bin/omarchy-menu"

echo "✅ MyApp Suite removed"
UNINSTALLER_EOF

chmod +x "$OMARCHY_PATH/install/apps/myapp_uninstaller.sh"

# Step 4: Add to remove menu as well
if ! grep -q "MyApp Suite" "$MENU_FILE"; then
    sed -i '/show_remove_menu()/,/^}$/{
        /\*) show_main_menu ;;/i\
  *MyApp\ Suite*) present_terminal "$HOME/.local/share/omarchy/install/apps/myapp_uninstaller.sh" ;;
    }' "$MENU_FILE"
    
    sed -i '/show_remove_menu()/,/case.*menu/{
        s/\(case.*menu.*Remove.*\)\(".*\)$/\1\\n🚀  MyApp Suite\2/
    }' "$MENU_FILE"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ $INSTALLER_NAME installer added to Omarchy!"
echo ""
echo "To install $INSTALLER_NAME:"
echo "  1. Press Super + Alt + Space"
echo "  2. Select 'Install'"
echo "  3. Select '🚀 MyApp Suite'"
echo ""
echo "To remove this installer:"
echo "  Run: rm $OMARCHY_PATH/install/apps/myapp_*"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"


## GitHub Repository Structure
# Create a repository with this structure:
# myapp-omarchy/
# ├── README.md
# ├── install.sh           # The bootstrap script above
# ├── docker-compose.yml   # Your Docker configuration
# ├── server/             
# │   ├── app.py          # Your Python server
# │   └── requirements.txt
# ├── systemd/
# │   └── myapp.service   # Systemd service file
# ├── desktop/            
# │   ├── myapp-web.desktop    # Web app shortcuts
# │   └── myapp-admin.desktop
# ├── config/
# │   └── nginx.conf      # Any additional configs
# └── assets/
#     └── icon.png        # App icon