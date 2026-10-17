function mapWindow(source) {
  if (!source || !Number.isInteger(source.usedPercent) || source.usedPercent < 0 || source.usedPercent > 100) return null;
  const resetsAt = Number.isSafeInteger(source.resetsAt) && source.resetsAt > 0 ? source.resetsAt : null;
  const windowDurationMins = Number.isSafeInteger(source.windowDurationMins) && source.windowDurationMins > 0
    ? source.windowDurationMins
    : null;
  return { usedPercent: source.usedPercent, resetsAt, windowDurationMins };
}

function mapUsageResponse(response, syncedAt = null) {
  if (!response || typeof response !== 'object') {
    return { primary: null, secondary: null, availableResetCredits: null, syncedAt: null };
  }
  const rateLimits = response.rateLimits && typeof response.rateLimits === 'object' ? response.rateLimits : {};
  const resetCount = response.rateLimitResetCredits?.availableCount;
  const validSyncedAt = typeof syncedAt === 'string' && Number.isFinite(Date.parse(syncedAt))
    ? new Date(syncedAt).toISOString()
    : null;
  return {
    primary: mapWindow(rateLimits.primary),
    secondary: mapWindow(rateLimits.secondary),
    availableResetCredits: Number.isSafeInteger(resetCount) && resetCount >= 0 ? resetCount : null,
    syncedAt: validSyncedAt
  };
}

module.exports = { mapUsageResponse };
