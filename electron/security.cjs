const DEV_ORIGIN = 'http://127.0.0.1:5173';

function isAllowedDevNavigation(target) {
  try {
    const url = new URL(target);
    return url.origin === DEV_ORIGIN;
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(target) {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'openai.com' || host.endsWith('.openai.com') ||
      host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
  } catch {
    return false;
  }
}

function isTrustedIpcSender(event, mainWebContents) {
  return Boolean(mainWebContents && event?.sender === mainWebContents &&
    event.senderFrame && event.senderFrame === mainWebContents.mainFrame);
}

module.exports = { DEV_ORIGIN, isAllowedDevNavigation, isAllowedExternalUrl, isTrustedIpcSender };
