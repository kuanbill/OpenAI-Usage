const path = require('path');

function getProfileHomes(scratchRoot) {
  if (typeof scratchRoot !== 'string' || scratchRoot.trim() === '') {
    throw new TypeError('scratchRoot must be a non-empty path');
  }
  const root = path.resolve(scratchRoot);
  return {
    accountA: path.join(root, 'account-a'),
    accountB: path.join(root, 'account-b')
  };
}

function normalizedChatGptEmail(account) {
  if (!account || account.type !== 'chatgpt' || typeof account.email !== 'string') return null;
  const email = account.email.trim().toLocaleLowerCase('en-US');
  return email || null;
}

function compareChatGptIdentity(accountA, accountB) {
  const emailA = normalizedChatGptEmail(accountA);
  const emailB = normalizedChatGptEmail(accountB);
  if (!emailA || !emailB) return 'unavailable';
  return emailA === emailB ? 'same' : 'different';
}

module.exports = { getProfileHomes, compareChatGptIdentity };
