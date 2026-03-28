# Monitor Improvements (2026-03-28 14:37 GMT)

**Trigger:** Alex noted "I'm still seeing some NaN" in the monitor output

## Issues Fixed

### 1. NaN Values in Completed Tasks

**Root Cause:** Division by zero or undefined values when calculating times from t/s

**Fix:**
- Added validation: `promptTps > 0 && evalTps > 0` before calculations
- Added `isNaN()` checks on all numeric values
- Added `isFinite()` check for overall t/s calculation
- Fallback to '0.0' for any invalid calculations

### 2. Duplicate Completed Tasks

**Root Cause:** Same task appearing multiple times in journalctl output (log rotation, repeated parsing)

**Fix:**
- Added `seenTaskIds` Set to track task IDs
- Skip tasks already seen in current parse cycle
- Clears set each parse cycle to allow new tasks

### 3. Timestamp Accuracy

**Issue:** Using `Date.now()` for all timestamps made it hard to tell when tasks actually completed

**Fix:**
- Added `extractTimestamp()` function to parse journalctl timestamps
- Format: "Mar 28 13:23:45" → milliseconds
- Use actual log timestamp instead of current time
- Shows "Xm ago" or "Xs ago" in UI for better context

### 4. Safer Calculations

**Before:**
```javascript
const totalSeconds = slot.totalTime / 1000;
const overallTps = slot.totalTokens / totalSeconds;
// Could be NaN if totalTime is 0 or undefined
```

**After:**
```javascript
const totalSeconds = slot.totalTimeSeconds || (slot.totalTime / 1000);
const overallTps = slot.totalTokens / totalSeconds;
const overallTpsFormatted = !isNaN(overallTps) && isFinite(overallTps) ? overallTps.toFixed(1) : '0.0';
```

### 5. Better Time Display

**Before:** Just showed "Completed"

**After:** Shows relative time:
- "Slot 0 - Task #123 (2m ago)"
- "Slot 0 - Task #124 (45s ago)"
- "Slot 0 - Task #125 (just now)"

## Changes Summary

**Files Modified:**
- `monitor-llama-web.js` - Added NaN protection, duplicate prevention, timestamp parsing

**Backups Created:**
- `monitor-llama-web.js.backup-20260328-1437`

**Lines Changed:**
- Added ~30 lines of validation and safety checks
- Added ~20 lines for timestamp extraction and display
- Added ~15 lines for duplicate prevention

## Testing

Monitor is now running with fixes. Should see:
- ✅ No NaN values in completed task stats
- ✅ No duplicate completed tasks
- ✅ Relative timestamps ("Xm ago")
- ✅ All calculations safe with fallbacks

---

**Thread Thought:** The visualizer taught us important lessons - parse timestamps from logs, prevent duplicates, validate all calculations. These improvements make the monitor more robust and informative.

**Next:** When you push to GitHub, these improvements will be part of the initial commit - a more polished, production-ready tool.
