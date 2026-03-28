#!/usr/bin/env node

/**
 * Llama Server Visualizer - Window into the Heart of Llama Server
 * 
 * Shows cache state, checkpoint lifecycle, and real-time cache hits/evictions
 * 
 * Usage: node llama-server-visualizer.js
 * Access: http://localhost:8791
 */

const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.VISUALIZER_PORT || 8791;
const WS_PORT = process.env.VISUALIZER_WS_PORT || 8792;

// Server state
let serverState = {
  cache: {
    totalPrompts: 0,
    totalMemoryMB: 0,
    memoryLimitMB: 0,
    tokenLimit: 0,
    utilizationPercent: 0,
    prompts: {}
  },
  activeTasks: {},
  events: {
    cacheHits: [],
    evictions: [],
    checkpointCreates: [],
    completions: [],
    slotSelections: []
  },
  lastUpdate: Date.now(),
  // Track seen events to prevent duplicates
  seenEvents: new Set()
};

// Extract timestamp from journalctl line
function extractTimestamp(line) {
  // journalctl format: "Mar 28 13:23:45 godzilla llama-server[12345]: message"
  const match = line.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
  if (match) {
    const dateStr = match[1];
    const year = new Date().getFullYear();
    const fullDate = `${year} ${dateStr}`;
    const date = new Date(fullDate);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  return Date.now();
}

// Create unique event ID for deduplication
function makeEventId(type, ...params) {
  return `${type}:${params.join(':')}`;
}

// Log patterns
const patterns = {
  cacheState: /cache state:\s+(\d+)\s+prompts,\s+([\d.]+)\s+MiB\s*\(\s*limits:\s*([\d.]+)\s+MiB,\s*(\d+)\s+tokens/,
  promptEntry: /prompt\s+(0x[0-9a-f]+):\s+(\d+)\s+tokens,\s+checkpoints:\s+(\d+),\s+([\d.]+)\s+MiB/,
  checkpointCreate: /created context checkpoint\s+(\d+)\s+of\s+(\d+)\s*\(pos_min\s*=\s*(\d+),\s*pos_max\s*=\s*(\d+),\s*n_tokens\s*=\s*(\d+),\s*size\s*=\s*([\d.]+)\s+MiB\)/,
  checkpointRestore: /restored context checkpoint\s*\(pos_min\s*=\s*(\d+),\s*pos_max\s*=\s*(\d+),\s*n_tokens\s*=\s*(\d+),\s*n_past\s*=\s*(\d+),\s*size\s*=\s*([\d.]+)\s+MiB\)/,
  checkpointErase: /erased invalidated context checkpoint\s*\(pos_min\s*=\s*(\d+),\s*pos_max\s*=\s*(\d+),\s*n_tokens\s*=\s*(\d+)/,
  taskProgress: /slot update_slots:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing progress,\s*n_tokens\s*=\s*(\d+),\s+batch\.n_tokens\s*=\s*(\d+),\s+progress\s*=\s*([\d.]+)/,
  taskGenerate: /slot update_slots:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing done/,
  taskComplete: /slot print_timing:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)/,
  taskRelease: /slot\s+release:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+stop processing:\s*n_tokens\s*=\s*(\d+)/,
  slotSelection: /slot get_availabl:\s+id\s+(\d+)\s+\|\s+task\s+(-?\d+)\s+\|\s+(.*)/,
  serverIdle: /srv\s+update_slots:\s+all slots are idle/,
  promptEvalTime: /prompt eval time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*(\d+\.?\d*)\s*ms per token,\s*(\d+\.?\d*)\s*tokens per second\)/,
  evalTime: /eval time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*(\d+\.?\d*)\s*ms per token,\s*(\d+\.?\d*)\s*tokens per second\)/,
  totalTime: /total time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens/
};

function parseLogs() {
  try {
    const output = execSync('sudo journalctl -u llama-server -n 500 --no-pager 2>&1', { encoding: 'utf8' });
    const lines = output.split('\n');
    let changed = false;
    let timingTasks = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const logTime = extractTimestamp(line);
      
      const cacheMatch = line.match(patterns.cacheState);
      if (cacheMatch) {
        serverState.cache.totalPrompts = parseInt(cacheMatch[1]);
        serverState.cache.totalMemoryMB = parseFloat(cacheMatch[2]);
        serverState.cache.memoryLimitMB = parseFloat(cacheMatch[3]);
        serverState.cache.tokenLimit = parseInt(cacheMatch[4]);
        serverState.cache.utilizationPercent = (serverState.cache.totalMemoryMB / serverState.cache.memoryLimitMB) * 100;
        changed = true;
      }
      
      const promptMatch = line.match(patterns.promptEntry);
      if (promptMatch) {
        const promptId = promptMatch[1];
        const existing = serverState.cache.prompts[promptId];
        if (!existing) changed = true;
        serverState.cache.prompts[promptId] = {
          id: promptId,
          tokenCount: parseInt(promptMatch[2]),
          checkpointCount: parseInt(promptMatch[3]),
          maxCheckpoints: 32,
          memoryMB: parseFloat(promptMatch[4]),
          lastUsed: logTime,
          isActive: false,
          hitCount: existing ? existing.hitCount : 0,
          lastHitTime: existing ? existing.lastHitTime : null
        };
      }
      
      const checkpointCreateMatch = line.match(patterns.checkpointCreate);
      if (checkpointCreateMatch) {
        const checkpointNum = parseInt(checkpointCreateMatch[1]);
        const maxCheckpoints = parseInt(checkpointCreateMatch[2]);
        const eventId = makeEventId('checkpoint-create', checkpointNum, maxCheckpoints, logTime);
        
        if (!serverState.seenEvents.has(eventId)) {
          serverState.seenEvents.add(eventId);
          serverState.events.checkpointCreates.push({
            taskId: checkpointNum,
            checkpointNum: checkpointNum,
            maxCheckpoints: maxCheckpoints,
            time: logTime
          });
          serverState.events.checkpointCreates = serverState.events.checkpointCreates.slice(-20);
          changed = true;
        }
      }
      
      const checkpointRestoreMatch = line.match(patterns.checkpointRestore);
      if (checkpointRestoreMatch) {
        const nTokens = parseInt(checkpointRestoreMatch[3]);
        const posMin = parseInt(checkpointRestoreMatch[1]);
        const eventId = makeEventId('cache-hit', nTokens, posMin, logTime);
        
        if (!serverState.seenEvents.has(eventId)) {
          serverState.seenEvents.add(eventId);
          
          for (const promptId in serverState.cache.prompts) {
            const prompt = serverState.cache.prompts[promptId];
            if (Math.abs(prompt.tokenCount - nTokens) < 100) {
              if (!prompt.lastHitTime || prompt.lastHitTime !== logTime) {
                prompt.hitCount = (prompt.hitCount || 0) + 1;
                prompt.lastHitTime = logTime;
                prompt.lastUsed = logTime;
              }
              break;
            }
          }
          
          serverState.events.cacheHits.push({ promptId: '0x...', tokenCount: nTokens, time: logTime });
          serverState.events.cacheHits = serverState.events.cacheHits.slice(-20);
          changed = true;
        }
      }
      
      const progressMatch = line.match(patterns.taskProgress);
      if (progressMatch) {
        const slotId = parseInt(progressMatch[1]);
        const taskId = parseInt(progressMatch[2]);
        const nTokens = parseInt(progressMatch[3]);
        const batchTokens = parseInt(progressMatch[4]);
        const progress = parseFloat(progressMatch[5]);
        if (!serverState.activeTasks[taskId]) changed = true;
        serverState.activeTasks[taskId] = {
          taskId, slotId, state: 'processing', progress, nTokens, batchTokens,
          startTime: logTime, checkpointCount: 0, maxCheckpoints: 32
        };
      }
      
      const generateMatch = line.match(patterns.taskGenerate);
      if (generateMatch) {
        const taskId = parseInt(generateMatch[2]);
        if (serverState.activeTasks[taskId]) {
          serverState.activeTasks[taskId].state = 'generating';
          serverState.activeTasks[taskId].progress = 1.0;
          changed = true;
        }
      }
      
      const completeMatch = line.match(patterns.taskComplete);
      if (completeMatch) {
        const taskId = parseInt(completeMatch[2]);
        if (serverState.activeTasks[taskId]) timingTasks[taskId] = {};
      }
      
      const promptTimeMatch = line.match(patterns.promptEvalTime);
      if (promptTimeMatch) {
        for (const taskId in timingTasks) {
          if (!timingTasks[taskId].promptTps) {
            timingTasks[taskId].promptTps = parseFloat(promptTimeMatch[4]);
            timingTasks[taskId].promptTokens = parseInt(promptTimeMatch[2]);
          }
        }
      }
      
      const evalTimeMatch = line.match(patterns.evalTime);
      if (evalTimeMatch) {
        for (const taskId in timingTasks) {
          if (!timingTasks[taskId].evalTps) {
            timingTasks[taskId].evalTps = parseFloat(evalTimeMatch[4]);
            timingTasks[taskId].evalTokens = parseInt(evalTimeMatch[2]);
          }
        }
      }
      
      const totalTimeMatch = line.match(patterns.totalTime);
      if (totalTimeMatch) {
        for (const taskId in timingTasks) {
          if (!timingTasks[taskId].totalTime) {
            timingTasks[taskId].totalTime = parseFloat(totalTimeMatch[1]);
            timingTasks[taskId].totalTokens = parseInt(totalTimeMatch[2]);
            
            const eventId = makeEventId('completion', taskId, logTime);
            if (!serverState.seenEvents.has(eventId)) {
              serverState.seenEvents.add(eventId);
              serverState.events.completions.push({ taskId: parseInt(taskId), stats: timingTasks[taskId], time: logTime });
              serverState.events.completions = serverState.events.completions.slice(-20);
              changed = true;
            }
            delete timingTasks[taskId];
          }
        }
      }
      
      const releaseMatch = line.match(patterns.taskRelease);
      if (releaseMatch) {
        const taskId = parseInt(releaseMatch[2]);
        if (serverState.activeTasks[taskId]) {
          delete serverState.activeTasks[taskId];
          changed = true;
        }
      }
      
      const slotMatch = line.match(patterns.slotSelection);
      if (slotMatch) {
        const slotId = parseInt(slotMatch[1]);
        const reason = slotMatch[3];
        const eventId = makeEventId('slot', slotId, reason.substring(0, 20), logTime);
        
        if (!serverState.seenEvents.has(eventId)) {
          serverState.seenEvents.add(eventId);
          serverState.events.slotSelections.push({ slotId, reason, time: logTime });
          serverState.events.slotSelections = serverState.events.slotSelections.slice(-20);
          changed = true;
        }
      }
      
      if (line.match(patterns.serverIdle)) {
        serverState.activeTasks = {};
        changed = true;
      }
    }
    
    const currentPromptIds = new Set();
    for (const line of lines) {
      const promptMatch = line.match(patterns.promptEntry);
      if (promptMatch) currentPromptIds.add(promptMatch[1]);
    }
    
    for (const promptId in serverState.cache.prompts) {
      if (!currentPromptIds.has(promptId)) {
        const eventId = makeEventId('eviction', promptId, Date.now());
        if (!serverState.seenEvents.has(eventId)) {
          serverState.seenEvents.add(eventId);
          serverState.events.evictions.push({ promptId, tokenCount: serverState.cache.prompts[promptId].tokenCount, time: Date.now() });
          serverState.events.evictions = serverState.events.evictions.slice(-20);
          delete serverState.cache.prompts[promptId];
          changed = true;
        }
      }
    }
    
    // Limit seenEvents to prevent memory growth
    if (serverState.seenEvents.size > 1000) {
      const eventsArray = Array.from(serverState.seenEvents);
      eventsArray.sort();
      serverState.seenEvents = new Set(eventsArray.slice(-500));
    }
    
    serverState.lastUpdate = Date.now();
    return changed ? serverState : null;
  } catch (error) {
    return null;
  }
}

const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>🧠 Llama Server Visualizer</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --accent-green: #238636;
      --accent-green-bright: #3fb950;
      --accent-yellow: #d29922;
      --accent-red: #da3633;
      --accent-blue: #58a6ff;
      --accent-purple: #a371f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 10px;
      font-size: 12px;
      min-height: 100vh;
    }
    .header {
      color: var(--accent-blue);
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-status { font-size: 11px; color: var(--text-secondary); }
    .cache-header {
      background: var(--bg-secondary);
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .cache-title {
      font-size: 13px;
      font-weight: bold;
      color: var(--accent-purple);
      margin-bottom: 6px;
    }
    .cache-stats {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      margin-bottom: 6px;
      font-size: 11px;
    }
    .cache-usage { color: var(--accent-blue); }
    .cache-percent { color: var(--accent-yellow); font-weight: bold; }
    .cache-prompts { color: var(--accent-green); }
    .cache-limit { color: var(--text-secondary); }
    .cache-bar-container {
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      overflow: hidden;
    }
    .cache-fill {
      height: 100%;
      background: linear-gradient(to right, var(--accent-green), var(--accent-yellow), var(--accent-red));
      transition: width 0.3s;
    }
    .section { margin-bottom: 10px; }
    .section-title {
      font-size: 12px;
      font-weight: bold;
      color: var(--text-secondary);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .task-block {
      background: var(--bg-secondary);
      padding: 8px;
      border-radius: 6px;
      margin-bottom: 6px;
      border-left: 3px solid var(--accent-yellow);
    }
    .task-block.generating { border-left-color: var(--accent-green-bright); }
    .task-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .task-id { font-weight: bold; }
    .task-state { font-size: 10px; padding: 2px 6px; border-radius: 3px; }
    .task-state.processing { background: var(--accent-yellow); color: #000; }
    .task-state.generating { background: var(--accent-green-bright); color: #000; }
    .task-progress-container { margin-bottom: 4px; }
    .task-progress-label { font-size: 10px; color: var(--text-secondary); margin-bottom: 2px; }
    .task-progress-bar {
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      overflow: hidden;
    }
    .task-progress-fill {
      height: 100%;
      background: var(--accent-yellow);
      transition: width 0.1s;
    }
    .task-block.generating .task-progress-fill { background: var(--accent-green-bright); }
    .task-checkpoint {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .checkpoint-progress-bar {
      flex: 1;
      height: 3px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      overflow: hidden;
    }
    .checkpoint-progress-fill {
      height: 100%;
      background: var(--accent-purple);
      transition: width 0.2s;
    }
    .task-tokens { font-size: 10px; color: var(--text-secondary); }
    .prompt-block {
      background: var(--bg-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      margin-bottom: 3px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 10px;
      transition: all 0.2s;
    }
    .prompt-block.recent { border-left: 2px solid var(--accent-green); }
    .prompt-block.hot { background: var(--bg-tertiary); }
    .prompt-id { color: var(--accent-blue); font-family: monospace; }
    .prompt-tokens { color: var(--text-primary); }
    .prompt-checkpoints { color: var(--accent-purple); }
    .prompt-memory { color: var(--text-secondary); }
    .hit-indicator { color: var(--accent-yellow); }
    .prompt-age { font-size: 9px; color: var(--accent-green); }
    @keyframes cache-hit-flash {
      0%, 100% { background: var(--bg-secondary); box-shadow: none; }
      50% { background: var(--bg-tertiary); box-shadow: 0 0 10px var(--accent-green); }
    }
    .cache-hit-flash { animation: cache-hit-flash 2s ease-in-out; }
    @keyframes eviction-fade {
      0% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(0.95); }
    }
    .eviction-fade { animation: eviction-fade 1s ease-out forwards; }
    .events-log {
      background: var(--bg-secondary);
      padding: 8px;
      border-radius: 6px;
    }
    .events-title {
      font-size: 11px;
      font-weight: bold;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .events-list { font-size: 10px; }
    .event-item {
      padding: 2px 0;
      color: var(--text-primary);
      border-bottom: 1px solid var(--bg-tertiary);
    }
    .event-item:last-child { border-bottom: none; }
    .event-time { color: var(--text-secondary); margin-right: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <span>🧠 Llama Server Visualizer</span>
    <span class="header-status" id="status">Connecting...</span>
  </div>
  
  <div class="cache-header">
    <div class="cache-title">💾 Cache Utilization</div>
    <div class="cache-stats">
      <span class="cache-usage" id="cache-usage">-- GB / -- GB</span>
      <span class="cache-percent" id="cache-percent">--%</span>
      <span class="cache-prompts" id="cache-prompts">-- prompts</span>
      <span class="cache-limit" id="cache-limit">--k token limit</span>
    </div>
    <div class="cache-bar-container">
      <div class="cache-fill" id="cache-fill" style="width: 0%"></div>
    </div>
  </div>
  
  <div class="section">
    <div class="section-title">⚡ Active Tasks</div>
    <div id="active-tasks">
      <div style="color: var(--text-secondary); font-style: italic;">No active tasks</div>
    </div>
  </div>
  
  <div class="section">
    <div class="section-title">🗂️ Cached Prompts</div>
    <div id="cached-prompts"></div>
  </div>
  
  <div class="section">
    <div class="events-log">
      <div class="events-title">📡 Recent Events</div>
      <div class="events-list" id="events-list"></div>
    </div>
  </div>
  
  <script>
    const ws = new WebSocket('ws://' + location.host.replace(':' + location.port, ':' + (parseInt(location.port) + 1)));
    
    ws.onopen = () => {
      document.getElementById('status').textContent = '✓ Connected';
      document.getElementById('status').style.color = 'var(--accent-green)';
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateUI(data);
    };
    
    ws.onerror = (err) => {
      document.getElementById('status').textContent = '✗ Connection error';
      document.getElementById('status').style.color = 'var(--accent-red)';
    };
    
    function updateUI(data) {
      // Update cache header
      document.getElementById('cache-usage').textContent = 
        (data.cache.totalMemoryMB / 1000).toFixed(1) + ' GB / ' + (data.cache.memoryLimitMB / 1000).toFixed(1) + ' GB';
      document.getElementById('cache-percent').textContent = data.cache.utilizationPercent.toFixed(0) + '%';
      document.getElementById('cache-prompts').textContent = data.cache.totalPrompts + ' prompts';
      document.getElementById('cache-limit').textContent = (data.cache.tokenLimit / 1000).toFixed(0) + 'k token limit';
      document.getElementById('cache-fill').style.width = data.cache.utilizationPercent + '%';
      
      // Update active tasks
      const activeTasksEl = document.getElementById('active-tasks');
      const activeTasks = Object.values(data.activeTasks);
      if (activeTasks.length === 0) {
        activeTasksEl.innerHTML = '<div style="color: var(--text-secondary); font-style: italic;">No active tasks</div>';
      } else {
        activeTasksEl.innerHTML = activeTasks.map(task => \
          '<div class="task-block ' + (task.state === 'generating' ? 'generating' : '') + '" id="task-' + task.taskId + '">' +
          '<div class="task-header">' +
          '<span class="task-id">Slot ' + task.slotId + ' - Task #' + task.taskId + '</span>' +
          '<span class="task-state ' + task.state + '">[' + task.state + ']</span>' +
          '</div>' +
          '<div class="task-progress-container">' +
          '<div class="task-progress-label">Progress: ' + Math.round(task.progress * 100) + '%</div>' +
          '<div class="task-progress-bar">' +
          '<div class="task-progress-fill" style="width: ' + (task.progress * 100) + '%"></div>' +
          '</div>' +
          '</div>' +
          '<div class="task-checkpoint">' +
          '<span>Checkpoint:</span>' +
          '<div class="checkpoint-progress-bar">' +
          '<div class="checkpoint-progress-fill" style="width: ' + ((task.checkpointCount || 0) / task.maxCheckpoints * 100) + '%"></div>' +
          '</div>' +
          '<span>' + (task.checkpointCount || 0) + '/' + task.maxCheckpoints + '</span>' +
          '</div>' +
          '<div class="task-tokens">' +
          '<span>📝 ' + task.nTokens.toLocaleString() + ' tokens</span>' +
          '<span>📦 batch: ' + task.batchTokens + '</span>' +
          '</div>' +
          '</div>'
        ).join('');
      }
      
      // Update cached prompts
      const cachedPromptsEl = document.getElementById('cached-prompts');
      const cachedPrompts = Object.values(data.cache.prompts);
      if (cachedPrompts.length === 0) {
        cachedPromptsEl.innerHTML = '<div style="color: var(--text-secondary); font-style: italic;">No cached prompts</div>';
      } else {
        cachedPromptsEl.innerHTML = cachedPrompts.map(prompt => {
          const isRecent = Date.now() - prompt.lastUsed < 60000;
          const isHot = prompt.hitCount > 1;
          const promptIdShort = prompt.id.substring(0, 12) + '...';
          return '<div class="prompt-block ' + (isRecent ? 'recent' : '') + ' ' + (isHot ? 'hot' : '') + '" id="prompt-' + prompt.id.replace('0x', '') + '">' +
            '<div class="prompt-id">' + promptIdShort + '</div>' +
            '<div class="prompt-tokens">' + prompt.tokenCount.toLocaleString() + ' tokens</div>' +
            '<div class="prompt-checkpoints">✓' + prompt.checkpointCount + '/32</div>' +
            '<div class="prompt-memory">' + (prompt.memoryMB / 1000).toFixed(1) + ' GB</div>' +
            '<div class="hit-indicator">' + (isHot ? '🔥 HOT!' : '') + '</div>' +
            '<div class="prompt-age">' + (isRecent ? 'recent' : '') + '</div>' +
            '</div>';
        }).join('');
      }
      
      // Update events
      const eventsListEl = document.getElementById('events-list');
      const allEvents = [
        ...data.events.cacheHits.map(e => ({ type: 'hit', ...e })),
        ...data.events.evictions.map(e => ({ type: 'eviction', ...e })),
        ...data.events.checkpointCreates.map(e => ({ type: 'checkpoint', ...e })),
        ...data.events.completions.map(e => ({ type: 'complete', ...e })),
        ...data.events.slotSelections.map(e => ({ type: 'slot', ...e }))
      ].sort((a, b) => b.time - a.time).slice(0, 10);
      
      eventsListEl.innerHTML = allEvents.map(e => {
        const time = new Date(e.time).toLocaleTimeString();
        let icon, text;
        switch(e.type) {
          case 'hit':
            icon = '🔥';
            text = 'Cache hit: ' + e.tokenCount.toLocaleString() + ' tokens';
            break;
          case 'eviction':
            icon = '🗑️';
            text = 'Eviction: ' + e.tokenCount.toLocaleString() + ' tokens';
            break;
          case 'checkpoint':
            icon = '💾';
            text = 'Checkpoint: task ' + e.taskId + ' (' + e.checkpointNum + '/' + e.maxCheckpoints + ')';
            break;
          case 'complete':
            icon = '✅';
            text = 'Task ' + e.taskId + ' completed';
            break;
          case 'slot':
            icon = '🔀';
            text = 'Slot ' + e.slotId + ': ' + e.reason;
            break;
          default:
            icon = '•';
            text = 'Unknown event';
        }
        return '<div class="event-item">' + icon + ' <span class="event-time">' + time + '</span> ' + text + '</div>';
      }).join('');
    }
  </script>
</body>
</html>`;

// HTTP server
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(htmlContent);
});

// WebSocket server
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('📡 WebSocket client connected');
  
  function broadcast() {
    const state = parseLogs();
    if (state) {
      ws.send(JSON.stringify(state));
    }
  }
  
  broadcast();
  const interval = setInterval(broadcast, 100);
  
  ws.on('close', () => {
    console.log('📡 WebSocket client disconnected');
    clearInterval(interval);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 Llama Server Visualizer running at http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket server running at ws://0.0.0.0:${WS_PORT}`);
  console.log('');
  console.log('Access the visualizer at: http://localhost:' + PORT);
});
