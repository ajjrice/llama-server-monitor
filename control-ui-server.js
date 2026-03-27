#!/usr/bin/env node

/**
 * OpenClaw Dashboard Launcher
 * 
 * Serves a launcher page that opens Control UI and Llama Monitor in separate tabs
 * for split-screen viewing (since browsers block iframe embedding due to X-Frame-Options)
 * 
 * Usage: node control-ui-server.js
 * Then open: http://localhost:8788
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.CONTROL_UI_PORT || 8788;
const LAUNCHER_PATH = path.join(__dirname, 'dashboard-launcher.html');

const server = http.createServer((req, res) => {
  // Serve the launcher HTML
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(LAUNCHER_PATH, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading launcher: ' + err.message);
        return;
      }
      res.writeHead(200, { 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('🦸 OpenClaw Dashboard Launcher');
  console.log('==============================');
  console.log('');
  console.log('📱 Dashboard: http://localhost:' + PORT);
  console.log('📱 Remote:    http://godzilla.local:' + PORT);
  console.log('');
  console.log('🔗 Direct Links:');
  console.log('   - Llama Monitor:    http://godzilla.local:8789');
  console.log('   - Control UI:       http://127.0.0.1:18789 (SSH tunnel required)');
  console.log('');
  console.log('⚙️  Running Services:');
  console.log('   1. OpenClaw gateway (port 18789)');
  console.log('   2. monitor-llama-web.js (port 8789)');
  console.log('');
  console.log('📺 To use split view:');
  console.log('   1. Open the dashboard above');
  console.log('   2. Click "Open Both (Split View)"');
  console.log('   3. Arrange windows side by side');
  console.log('');
  console.log('Press Ctrl+C to stop');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  process.exit(0);
});
