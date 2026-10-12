#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

console.log('\n========================================');
console.log('  🎨 DesignSync Setup for Designers');
console.log('========================================\n');

// 1. Ensure dependencies are installed
if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  console.log('📦 Installing required dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('✔ Dependencies installed successfully.\n');
  } catch (err) {
    console.error('❌ Failed to install dependencies. Please run "npm install" manually.');
  }
}

// 2. Build design tokens so dist/ is up to date
console.log('⚡ Compiling initial design tokens...');
try {
  execSync('npm run build:tokens', { stdio: 'inherit' });
  console.log('✔ Tokens compiled successfully.\n');
} catch (err) {
  console.warn('⚠️ Could not compile tokens right now. Continuing...\n');
}

// 3. Auto-configure Claude Desktop
function getClaudeConfigPath() {
  const platform = os.platform();
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  } else {
    return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
}

const claudeConfigPath = getClaudeConfigPath();
const serverScriptPath = path.resolve(__dirname, 'mcp-server.js');

try {
  const configDir = path.dirname(claudeConfigPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config = {};
  if (fs.existsSync(claudeConfigPath)) {
    try {
      const raw = fs.readFileSync(claudeConfigPath, 'utf8');
      config = JSON.parse(raw);
    } catch (_) {
      config = {};
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers['design-sync'] = {
    command: 'node',
    args: [serverScriptPath]
  };

  fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2), 'utf8');

  console.log('✅ Claude Desktop is now configured!');
  console.log(`   Config updated at: ${claudeConfigPath}\n`);
  console.log('----------------------------------------');
  console.log('🎉 Setup Complete!');
  console.log('----------------------------------------');
  console.log('1. Restart Claude Desktop (close and reopen it).');
  console.log('2. In your chat window, look for the hammer/tools icon.');
  console.log('3. Ask Claude: "What colors are in our design system?" to start!\n');
} catch (err) {
  console.log('⚠️ Could not automatically write Claude Desktop config file: ' + err.message);
  console.log('\nYou can add this manually to your claude_desktop_config.json:');
  console.log(JSON.stringify({
    mcpServers: {
      "design-sync": {
        command: "node",
        args: [serverScriptPath]
      }
    }
  }, null, 2));
}
