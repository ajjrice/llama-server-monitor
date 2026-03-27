#!/usr/bin/env node

/**
 * OpenClaw Llama Monitor - Web Server Version
 * 
 * Serves a web interface that can be embedded in OpenClaw Control UI via iframe
 * 
 * Usage: node monitor-llama-web.js
 * Then embed in Control UI: <iframe src="http://127.0.0.1:8789" />
 */

const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.MONITOR_PORT || 8789;
const WS_PORT = process.env.MONITOR_WS_PORT || 8790;

// Track state
let lastSlotsHash = '';
let lastCheckpointState = {};
let lastResources = '';
let clients = new Set();

function getSystemResources() {
  const resources = {
    ram: { used: 0, total: 0, percent: 0 },
    vram: { used: 0, total: 0, percent: 0, available: false },
    gpuTemp: { value: 0, available: false },
    gpuClock: { value: 0, available: false }
  };
  
  try {
    const meminfo = execSync('cat /proc/meminfo', { encoding: 'utf8' });
    const memAvailableMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
    const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    
    if (memAvailableMatch && memTotalMatch) {
      const memAvailable = parseInt(memAvailableMatch[1]);
      const memTotal = parseInt(memTotalMatch[1]);
      const memUsed = memTotal - memAvailable;
      
      resources.ram.used = Math.round(memUsed / 1024 / 1024);
      resources.ram.total = Math.round(memTotal / 1024 / 1024);
      resources.ram.percent = Math.round((memUsed / memTotal) * 100);
    }
  } catch (e) {}
  
  try {
    const nvidiaSmi = execSync('nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu,gpu_clocks --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf8' });
    const lines = nvidiaSmi.trim().split('\n');
    
    // Parse VRAM (first GPU's memory)
    for (const line of lines) {
      const vramMatch = line.match(/(\d+),\s*(\d+)/);
      if (vramMatch) {
        const vramUsed = parseInt(vramMatch[1]);
        const vramTotal = parseInt(vramMatch[2]);
        
        resources.vram.used = vramUsed;
        resources.vram.total = vramTotal;
        resources.vram.percent = Math.round((vramUsed / vramTotal) * 100);
        resources.vram.available = true;
        break;
      }
    }
    
    // Parse temperature and clock (last line usually has temp and clock)
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 4) {
        const tempMatch = parts[2]?.match(/^(\d+)$/);
        const clockMatch = parts[3]?.match(/^(\d+)$/);
        
        if (tempMatch) {
          resources.gpuTemp.value = parseInt(tempMatch[1]);
          resources.gpuTemp.available = true;
        }
        if (clockMatch) {
          resources.gpuClock.value = parseInt(clockMatch[1]);
          resources.gpuClock.available = true;
        }
      }
    }
  } catch (e) {}
  
  return resources;
}

function parseLlamaLogs(output) {
  const slots = {};
  const lines = output.split('\n');
  
  for (const line of lines) {
    const processingMatch = line.match(/slot update_slots: id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing progress.*?progress\s*=\s*([\d.]+)/);
    if (processingMatch) {
      const slotId = parseInt(processingMatch[1]);
      const taskId = parseInt(processingMatch[2]);
      const progress = parseFloat(processingMatch[3]);
      
      lastCheckpointState[slotId] = null;
      
      slots[slotId] = {
        slotId,
        taskId,
        state: 'processing',
        progress,
        lastSeen: Date.now()
      };
      continue;
    }
    
    const checkpointMatch = line.match(/slot update_slots: id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+(?:Checking checkpoint|restored context checkpoint|erased invalidated context)/);
    if (checkpointMatch) {
      const slotId = parseInt(checkpointMatch[1]);
      const taskId = parseInt(checkpointMatch[2]);
      
      if (lastCheckpointState[slotId] !== taskId) {
        lastCheckpointState[slotId] = taskId;
        
        if (!slots[slotId] || slots[slotId].state !== 'processing') {
          slots[slotId] = {
            slotId,
            taskId,
            state: 'checkpoint',
            progress: 0,
            lastSeen: Date.now()
          };
        }
      }
      continue;
    }
    
    const generatingMatch = line.match(/slot update_slots: id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing done/);
    if (generatingMatch) {
      const slotId = parseInt(generatingMatch[1]);
      const taskId = parseInt(generatingMatch[2]);
      
      lastCheckpointState[slotId] = null;
      
      if (slots[slotId]) {
        slots[slotId].state = 'generating';
        slots[slotId].progress = 1.0;
        slots[slotId].lastSeen = Date.now();
      }
      continue;
    }
    
    const doneMatch = line.match(/slot print_timing: id\s+(\d+)\s+\|\s+task\s+(\d+)/);
    if (doneMatch) {
      const slotId = parseInt(doneMatch[1]);
      if (slots[slotId]) {
        slots[slotId].state = 'done';
      }
      lastCheckpointState[slotId] = null;
      continue;
    }
  }
  
  return Object.values(slots).filter(slot => slot.state !== 'done');
}

function getSlotsHash(slots) {
  return JSON.stringify(slots.map(s => ({
    slotId: s.slotId,
    taskId: s.taskId,
    state: s.state,
    progress: Math.round(s.progress * 100) / 100
  })));
}

function getMonitorData() {
  try {
    const output = execSync('sudo journalctl -u llama-server -n 500 --no-pager 2>&1', { encoding: 'utf8' });
    const slots = parseLlamaLogs(output);
    const resources = getSystemResources();
    
    const slotsHash = getSlotsHash(slots);
    const resourcesStr = JSON.stringify({
      ram: { percent: resources.ram.percent, used: resources.ram.used, total: resources.ram.total },
      vram: { percent: resources.vram.percent, used: resources.vram.used, total: resources.vram.total, available: resources.vram.available }
    });
    
    // Only return data if something changed
    if (slotsHash === lastSlotsHash && resourcesStr === lastResources) {
      return null;
    }
    
    lastSlotsHash = slotsHash;
    lastResources = resourcesStr;
    
    return {
      timestamp: Date.now(),
      slots: slots,
      resources: resources
    };
  } catch (error) {
    return null;
  }
}

// Serve static HTML
const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Llama Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 10px;
      font-size: 12px;
    }
    .header {
      color: #00d4ff;
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .resources {
      margin-bottom: 10px;
      padding: 8px;
      background: #16213e;
      border-radius: 4px;
    }
    .resource-row {
      margin-bottom: 10px;
    }
    .resource-row:last-child { margin-bottom: 0; }
    .resource-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .resource-label {
      font-weight: bold;
      display: flex;
      flex-direction: column;
    }
    .resource-name {
      font-size: 12px;
    }
    .resource-detail {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 1px;
    }
    .resource-percent {
      font-size: 11px;
      color: #94a3b8;
    }
    .resource-bar {
      height: 8px;
      background: #0f3460;
      border-radius: 4px;
      overflow: hidden;
    }
    .resource-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.2s;
    }
    .resource-bar-fill.green { background: #4ade80; }
    .resource-bar-fill.yellow { background: #fbbf24; }
    .resource-bar-fill.red { background: #f87171; }
    .tasks {
      margin-top: 10px;
    }
    .task {
      padding: 8px;
      background: #16213e;
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .task-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .task-id {
      color: #94a3b8;
    }
    .task-state {
      font-weight: bold;
    }
    .task-state.checkpoint { color: #22d3ee; }
    .task-state.processing { color: #fbbf24; }
    .task-state.generating { color: #4ade80; }
    .task-progress {
      font-size: 10px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .task-bar {
      height: 6px;
      background: #0f3460;
      border-radius: 3px;
      overflow: hidden;
    }
    .task-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.1s;
    }
    .idle {
      color: #64748b;
      font-style: italic;
      padding: 10px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">🦞 Llama Server Monitor</div>
  
  <div class="resources">
    <div class="resource-row">
      <div class="resource-header">
        <div class="resource-label">
          <span class="resource-name">RAM</span>
          <span class="resource-detail" id="ram-detail">--</span>
        </div>
        <span class="resource-percent" id="ram-percent">--</span>
      </div>
      <div class="resource-bar">
        <div class="resource-bar-fill" id="ram-bar" style="width: 0%"></div>
      </div>
    </div>
    
    <div class="resource-row" id="vram-row" style="display: none;">
      <div class="resource-header">
        <div class="resource-label">
          <span class="resource-name">VRAM</span>
          <span class="resource-detail" id="vram-detail">--</span>
        </div>
        <span class="resource-percent" id="vram-percent">--</span>
      </div>
      <div class="resource-bar">
        <div class="resource-bar-fill" id="vram-bar" style="width: 0%"></div>
      </div>
    </div>
    
    <div class="resource-row" id="temp-row" style="display: none;">
      <div class="resource-header">
        <div class="resource-label">
          <span class="resource-name">GPU Temp</span>
          <span class="resource-detail" id="temp-detail">--</span>
        </div>
        <span class="resource-percent" id="temp-percent">--</span>
      </div>
      <div class="resource-bar">
        <div class="resource-bar-fill" id="temp-bar" style="width: 0%"></div>
      </div>
    </div>
    
    <div class="resource-row" id="clock-row" style="display: none;">
      <div class="resource-header">
        <div class="resource-label">
          <span class="resource-name">GPU Clock</span>
          <span class="resource-detail" id="clock-detail">--</span>
        </div>
        <span class="resource-percent" id="clock-percent">--</span>
      </div>
      <div class="resource-bar">
        <div class="resource-bar-fill" id="clock-bar" style="width: 0%"></div>
      </div>
    </div>
  </div>
  
  <div class="tasks" id="tasks">
    <div class="idle">Waiting for activity...</div>
  </div>
  
  <script>
    const ws = new WebSocket('ws://' + location.host.replace(':' + location.port, ':' + (parseInt(location.port) + 1)));
    
    ws.onmessage = function(event) {
      const data = JSON.parse(event.data);
      updateUI(data);
    };
    
    function getColorClass(percent) {
      if (percent < 60) return 'green';
      if (percent < 80) return 'yellow';
      return 'red';
    }
    
    function updateUI(data) {
      // Update RAM
      document.getElementById('ram-detail').textContent = data.resources.ram.used + 'GB/' + data.resources.ram.total + 'GB';
      document.getElementById('ram-percent').textContent = data.resources.ram.percent + '%';
      const ramBar = document.getElementById('ram-bar');
      ramBar.style.width = data.resources.ram.percent + '%';
      ramBar.className = 'resource-bar-fill ' + getColorClass(data.resources.ram.percent);
      
      // Update VRAM
      const vramRow = document.getElementById('vram-row');
      if (data.resources.vram.available) {
        vramRow.style.display = 'block';
        document.getElementById('vram-detail').textContent = data.resources.vram.used + 'MB/' + data.resources.vram.total + 'MB';
        document.getElementById('vram-percent').textContent = data.resources.vram.percent + '%';
        const vramBar = document.getElementById('vram-bar');
        vramBar.style.width = data.resources.vram.percent + '%';
        vramBar.className = 'resource-bar-fill ' + getColorClass(data.resources.vram.percent);
      } else {
        vramRow.style.display = 'none';
      }
      
      // Update GPU Temp
      const tempRow = document.getElementById('temp-row');
      if (data.resources.gpuTemp.available) {
        tempRow.style.display = 'block';
        document.getElementById('temp-detail').textContent = data.resources.gpuTemp.value + '°C';
        const tempPercent = Math.min(Math.round((data.resources.gpuTemp.value / 85) * 100), 100);
        document.getElementById('temp-percent').textContent = tempPercent + '%';
        const tempBar = document.getElementById('temp-bar');
        tempBar.style.width = tempPercent + '%';
        tempBar.className = 'resource-bar-fill ' + getColorClass(tempPercent);
      } else {
        tempRow.style.display = 'none';
      }
      
      // Update GPU Clock
      const clockRow = document.getElementById('clock-row');
      if (data.resources.gpuClock.available) {
        clockRow.style.display = 'block';
        document.getElementById('clock-detail').textContent = data.resources.gpuClock.value + ' MHz';
        const clockPercent = Math.min(Math.round((data.resources.gpuClock.value / 1800) * 100), 100);
        document.getElementById('clock-percent').textContent = clockPercent + '%';
        const clockBar = document.getElementById('clock-bar');
        clockBar.style.width = clockPercent + '%';
        clockBar.className = 'resource-bar-fill ' + getColorClass(clockPercent);
      } else {
        clockRow.style.display = 'none';
      }
      
      // Update tasks
      const tasksContainer = document.getElementById('tasks');
      if (data.slots.length === 0) {
        tasksContainer.innerHTML = '<div class="idle">No active tasks (server is idle)</div>';
        return;
      }
      
      let tasksHTML = '';
      for (const slot of data.slots) {
        const progressPercent = Math.round(slot.progress * 100);
        const filled = Math.min(Math.round(slot.progress * 50), 50);
        
        let stateText = slot.state;
        if (slot.state === 'checkpoint') {
          stateText = 'checkpoint loading';
        }
        
        tasksHTML += '<div class="task">';
        tasksHTML += '<div class="task-header">';
        tasksHTML += '<span class="task-id">Slot ' + slot.slotId + ' - Task #' + slot.taskId + '</span>';
        tasksHTML += '<span class="task-state ' + slot.state + '">' + stateText + '</span>';
        tasksHTML += '</div>';
        
        if (slot.state !== 'checkpoint') {
          tasksHTML += '<div class="task-progress">Progress: ' + progressPercent + '%</div>';
        } else {
          tasksHTML += '<div class="task-progress">Loading checkpoint...</div>';
        }
        
        const barColor = slot.state === 'generating' ? '#4ade80' : (slot.state === 'checkpoint' ? '#22d3ee' : '#fbbf24');
        const barWidth = slot.state === 'generating' ? 100 : (filled * 2);
        
        tasksHTML += '<div class="task-bar">';
        tasksHTML += '<div class="task-bar-fill" style="width: ' + barWidth + '%; background: ' + barColor + '"></div>';
        tasksHTML += '<span class="task-bar-percent">' + progressPercent + '%</span>';
        tasksHTML += '</div></div>';
      }
      
      tasksContainer.innerHTML = tasksHTML;
    }
  </script>
</body>
</html>`;

// HTTP server
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(htmlContent);
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  clients.add(ws);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Poll and broadcast updates
function pollAndBroadcast() {
  const data = getMonitorData();
  
  if (data) {
    const message = JSON.stringify(data);
    
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

// Start polling every 100ms
setInterval(pollAndBroadcast, 100);

// Start servers
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('🦞 Llama Monitor Web Server running at http://0.0.0.0:' + PORT);
  console.log('📡 WebSocket server running at ws://0.0.0.0:' + WS_PORT);
  console.log('');
  console.log('To embed in OpenClaw Control UI, add this iframe:');
  console.log('<iframe src="http://godzilla.local:' + PORT + '" style="width: 100%; height: 400px; border: none; border-radius: 8px;"></iframe>');
  console.log('');
  console.log('Or open in browser: http://godzilla.local:' + PORT);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  httpServer.close();
  wss.close();
  process.exit(0);
});
