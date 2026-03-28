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
let lastCompletedHash = '';
let lastCheckpointState = {};
let lastResources = '';
let clients = new Set();
let recentEvalTps = []; // Track last 10 generation speeds

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
    const nvidiaSmi = execSync('nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu,clocks.current.graphics --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf8' });
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
  const activeSlots = {};
  const completedSlots = [];
  const lines = output.split('\n');
  
  // First pass: find all completed tasks with their timing stats
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for print_timing header
    const timingMatch = line.match(/slot print_timing: id\s+(\d+)\s+\|\s+task\s+(\d+)/);
    if (timingMatch) {
      const slotId = parseInt(timingMatch[1]);
      const taskId = parseInt(timingMatch[2]);
      
      // Extract timing stats from the next few lines
      let promptEvalTime = null, promptTokens = null, promptTps = null;
      let evalTime = null, evalTokens = null, evalTps = null;
      let totalTime = null, totalTokens = null;
      
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j];
        
        const promptMatch = nextLine.match(/prompt eval time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*(\d+\.?\d*)\s*ms per token,\s*(\d+\.?\d*)\s*tokens per second\)/);
        if (promptMatch) {
          promptEvalTime = parseFloat(promptMatch[1]);
          promptTokens = parseInt(promptMatch[2]);
          promptTps = parseFloat(promptMatch[4]);
        }
        
        const evalMatch = nextLine.match(/eval time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*(\d+\.?\d*)\s*ms per token,\s*(\d+\.?\d*)\s*tokens per second\)/);
        if (evalMatch) {
          evalTime = parseFloat(evalMatch[1]);
          evalTokens = parseInt(evalMatch[2]);
          evalTps = parseFloat(evalMatch[4]);
        }
        
        const totalMatch = nextLine.match(/total time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens/);
        if (totalMatch) {
          totalTime = parseFloat(totalMatch[1]);
          totalTokens = parseInt(totalMatch[2]);
        }
      }
      
      // Only add if we got the key stats
      if (promptTps && evalTps) {
        // Calculate times in reverse from tokens and t/s (since stdout doesn't give us the time directly)
        const promptTimeSeconds = promptTokens / promptTps;
        const evalTimeSeconds = evalTokens / evalTps;
        
        completedSlots.push({
          slotId,
          taskId,
          state: 'done',
          promptTps,
          promptTokens,
          promptTimeSeconds,
          evalTps,
          evalTokens,
          evalTimeSeconds,
          totalTime: totalTime || (promptTimeSeconds + evalTimeSeconds) * 1000,
          totalTimeSeconds: totalTime || (promptTimeSeconds + evalTimeSeconds),
          totalTokens: totalTokens || (promptTokens || 0) + (evalTokens || 0),
          timestamp: Date.now()
        });
        
        // Track for average calculation
        recentEvalTps.push(evalTps);
        if (recentEvalTps.length > 10) {
          recentEvalTps.shift();
        }
      }
      continue;
    }
  }
  
  // Keep only last 5 completed tasks (most recent first)
  const completedToReturn = completedSlots.slice(-5).reverse();
  
  // Second pass: find active slots
  for (const line of lines) {
    const processingMatch = line.match(/slot update_slots: id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing progress.*?progress\s*=\s*([\d.]+)/);
    if (processingMatch) {
      const slotId = parseInt(processingMatch[1]);
      const taskId = parseInt(processingMatch[2]);
      const progress = parseFloat(processingMatch[3]);
      
      lastCheckpointState[slotId] = null;
      
      // Don't add if this task is already in completed
      const isInCompleted = completedSlots.some(c => c.taskId === taskId);
      if (!isInCompleted) {
        activeSlots[slotId] = {
          slotId,
          taskId,
          state: 'processing',
          progress,
          lastSeen: Date.now()
        };
      }
      continue;
    }
    
    const checkpointMatch = line.match(/slot update_slots: id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+(?:Checking checkpoint|restored context checkpoint|erased invalidated context)/);
    if (checkpointMatch) {
      const slotId = parseInt(checkpointMatch[1]);
      const taskId = parseInt(checkpointMatch[2]);
      
      if (lastCheckpointState[slotId] !== taskId) {
        lastCheckpointState[slotId] = taskId;
        
        const isInCompleted = completedSlots.some(c => c.taskId === taskId);
        if (!activeSlots[slotId] || activeSlots[slotId].state !== 'processing') {
          if (!isInCompleted) {
            activeSlots[slotId] = {
              slotId,
              taskId,
              state: 'checkpoint',
              progress: 0,
              lastSeen: Date.now()
            };
          }
        }
      }
      continue;
    }
    
    const generatingMatch = line.match(/slot update_slots: id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing done/);
    if (generatingMatch) {
      const slotId = parseInt(generatingMatch[1]);
      const taskId = parseInt(generatingMatch[2]);
      
      lastCheckpointState[slotId] = null;
      
      const isInCompleted = completedSlots.some(c => c.taskId === taskId);
      if (activeSlots[slotId] && !isInCompleted) {
        activeSlots[slotId].state = 'generating';
        activeSlots[slotId].progress = 1.0;
        activeSlots[slotId].lastSeen = Date.now();
        
        // Calculate estimated tokens generated based on average speed
        if (recentEvalTps.length > 0) {
          const avgTps = recentEvalTps.reduce((a, b) => a + b, 0) / recentEvalTps.length;
          // Estimate how long we've been generating (rough guess: 2 seconds after "prompt processing done")
          const secondsGenerating = 2;
          activeSlots[slotId].estimatedTokens = Math.round(avgTps * secondsGenerating);
        }
      }
      continue;
    }
  }
  
  const activeSlotsArray = Object.values(activeSlots);
  
  return {
    active: activeSlotsArray,
    completed: completedToReturn,
    avgTps: recentEvalTps.length > 0 ? recentEvalTps.reduce((a, b) => a + b, 0) / recentEvalTps.length : 20
  };
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
    const parsed = parseLlamaLogs(output);
    const resources = getSystemResources();
    
    const activeHash = getSlotsHash(parsed.active);
    const completedHash = getSlotsHash(parsed.completed);
    const resourcesStr = JSON.stringify({
      ram: { percent: resources.ram.percent, used: resources.ram.used, total: resources.ram.total },
      vram: { percent: resources.vram.percent, used: resources.vram.used, total: resources.vram.total, available: resources.vram.available }
    });
    
    // Only return data if something changed
    if (activeHash === lastSlotsHash && completedHash === lastCompletedHash && resourcesStr === lastResources) {
      return null;
    }
    
    lastSlotsHash = activeHash;
    lastCompletedHash = completedHash;
    lastResources = resourcesStr;
    
    return {
      timestamp: Date.now(),
      active: parsed.active,
      completed: parsed.completed,
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
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      color: #00d4ff;
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .tasks {
      flex: 1;
      min-height: 0;
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
    .task-state.done { color: #7aa37a; }
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
    .task-stats {
      font-size: 9px;
      color: #94a3b8;
      margin-top: 4px;
      line-height: 1.4;
    }
    .task-stats-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .task-stats-left {
      color: #94a3b8;
    }
    .task-stats-right {
      color: #7aa37a;
      font-weight: bold;
      text-align: right;
    }
    
    .idle {
      color: #64748b;
      font-style: italic;
      padding: 10px;
      text-align: center;
    }
    .resources {
      margin-top: auto;
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
      align-items: center;
      margin-bottom: 2px;
    }
    .resource-label {
      font-weight: bold;
      display: flex;
      align-items: baseline;
      gap: 4px;
    }
    .resource-name {
      font-size: 12px;
    }
    .resource-detail {
      font-size: 10px;
      color: #94a3b8;
    }
    .resource-percent {
      font-size: 11px;
      color: #94a3b8;
    }
    .resource-bar {
      height: 3px;
      background: #0f3460;
      border-radius: 2px;
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
  </style>
</head>
<body>
  <div class="header">🦞 Llama Server Monitor</div>
  
  <div class="main-content">
    <div class="tasks" id="tasks">
      <div class="idle">Waiting for activity...</div>
    </div>
    
    <div class="resources">
    <div class="resource-row">
      <div class="resource-header">
        <div class="resource-label">
          <span class="resource-name">RAM</span>
          <span class="resource-detail" id="ram-detail">--</span>
          <span class="resource-percent" id="ram-percent">--</span>
        </div>
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
          <span class="resource-percent" id="vram-percent">--</span>
        </div>
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
          <span class="resource-percent" id="temp-percent">--</span>
        </div>
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
          <span class="resource-percent" id="clock-percent">--</span>
        </div>
      </div>
      <div class="resource-bar">
        <div class="resource-bar-fill" id="clock-bar" style="width: 0%"></div>
      </div>
    </div>
  </div>
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
        const vramGB = (data.resources.vram.used / 1024).toFixed(1);
        const vramTotalGB = (data.resources.vram.total / 1024).toFixed(1);
        document.getElementById('vram-detail').textContent = vramGB + 'GB/' + vramTotalGB + 'GB';
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
      const hasActive = data.active && data.active.length > 0;
      const hasCompleted = data.completed && data.completed.length > 0;
      
      if (!hasActive && !hasCompleted) {
        tasksContainer.innerHTML = '<div class="idle">No active tasks (server is idle)</div>';
        return;
      }
      
      let tasksHTML = '';
      
      // Render active slots first
      if (hasActive) {
        for (const slot of data.active) {
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
          
          if (slot.state === 'generating') {
            // Show estimated tokens generated
            const avgTps = data.avgTps || 20;
            // Update estimate based on time since last update
            const estimatedTokens = slot.estimatedTokens ? slot.estimatedTokens + Math.round(avgTps * 0.1) : Math.round(avgTps * 0.1);
            slot.estimatedTokens = estimatedTokens; // Store for next update
            tasksHTML += '<div class="task-progress">Estimated tokens generated: ' + estimatedTokens + '</div>';
          } else if (slot.state !== 'checkpoint') {
            tasksHTML += '<div class="task-progress">Progress: ' + progressPercent + '%</div>';
          } else {
            tasksHTML += '<div class="task-progress">Loading checkpoint...</div>';
          }
          
          const barColor = slot.state === 'generating' ? '#4ade80' : (slot.state === 'checkpoint' ? '#22d3ee' : '#fbbf24');
          const barWidth = slot.state === 'generating' ? 100 : (filled * 2);
          
          tasksHTML += '<div class="task-bar">';
          tasksHTML += '<div class="task-bar-fill" style="width: ' + barWidth + '%; background: ' + barColor + '"></div>';
          tasksHTML += '<span class="task-bar-percent">' + progressPercent + '%</span>';
          tasksHTML += '</div>';
          tasksHTML += '</div>';
        }
      }
      
      // Render completed slots
      if (hasCompleted) {
        for (const slot of data.completed) {
          tasksHTML += '<div class="task">';
          tasksHTML += '<div class="task-header">';
          tasksHTML += '<span class="task-id">Slot ' + slot.slotId + ' - Task #' + slot.taskId + '</span>';
          tasksHTML += '<span class="task-state done">Completed</span>';
          tasksHTML += '</div>';
          
          if (slot.promptTps && slot.evalTps) {
            // Calculate overall tokens per second
            const totalSeconds = slot.totalTime / 1000;
            const overallTps = slot.totalTokens / totalSeconds;
            
            tasksHTML += '<div class="task-stats">';
            tasksHTML += '<div class="task-stats-row">';
            tasksHTML += '<span class="task-stats-left">Prompt: ' + (slot.promptEvalTime / 1000).toFixed(1) + 's / ' + slot.promptTokens + ' tokens</span>';
            tasksHTML += '<span class="task-stats-right">' + slot.promptTps.toFixed(1) + ' t/s</span>';
            tasksHTML += '</div>';
            tasksHTML += '<div class="task-stats-row">';
            tasksHTML += '<span class="task-stats-left">Eval: ' + (slot.evalTime / 1000).toFixed(1) + 's / ' + slot.evalTokens + ' tokens</span>';
            tasksHTML += '<span class="task-stats-right">' + slot.evalTps.toFixed(1) + ' t/s</span>';
            tasksHTML += '</div>';
            tasksHTML += '<div class="task-stats-row">';
            tasksHTML += '<span class="task-stats-left">Total: ' + totalSeconds.toFixed(1) + 's / ' + slot.totalTokens + ' tokens</span>';
            tasksHTML += '<span class="task-stats-right">' + overallTps.toFixed(1) + ' t/s</span>';
            tasksHTML += '</div>';
            tasksHTML += '</div>';
          } else {
            tasksHTML += '<div class="task-progress">Completed</div>';
          }
          
          tasksHTML += '</div>';
        }
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
