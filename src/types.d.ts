declare global {
  interface Window {
    dashboardRuntime?: { readonly mode: 'live' | 'offline-fixture' };
    dashboardApi?: DashboardApi;
  }
}

export interface UsageWindowSnapshot {
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface UsageSnapshot {
  primary: UsageWindowSnapshot | null;
  secondary: UsageWindowSnapshot | null;
  availableResetCredits: number | null;
  syncedAt: string | null;
}

export interface ResetCreditOption {
  handle: string;
  title: string | null;
  description: string | null;
  grantedAt: number | null;
  expiresAt: number | null;
  expirationStatus: 'scheduled' | 'never' | 'unavailable';
}

export interface DashboardAccount {
  id: string;
  alias: string;
  createdAt: string;
  state: 'not-connected' | 'starting' | 'pending' | 'checking' | 'authenticated' | 'failed' | 'login-required' | 'cancelled' | 'cleaned' | 'disconnected';
  usageReadable: boolean;
  usage: UsageSnapshot | null;
  error: string;
  resetCredits: ResetCreditOption[] | null;
  resetDetailsLoaded: boolean;
  resetNeedsRefresh: boolean;
}

export interface ResetConsumeResult {
  outcome: 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed';
  account: DashboardAccount;
}

export interface DeviceLoginResult {
  account: Pick<DashboardAccount, 'id' | 'alias'>;
  login: { userCode: string; verificationUrl: string };
}

export interface DashboardApi {
  listAccounts(): Promise<DashboardAccount[]>;
  addAccount(alias: string): Promise<DeviceLoginResult>;
  startLogin(accountId: string): Promise<DeviceLoginResult>;
  refreshAccount(accountId: string): Promise<DashboardAccount | undefined>;
  refreshResetCredits(accountId: string): Promise<DashboardAccount | undefined>;
  consumeResetCredit(accountId: string, creditHandle: string): Promise<ResetConsumeResult>;
  removeAccount(accountId: string): Promise<boolean>;
  onAccountsChanged(callback: (accounts: DashboardAccount[]) => void): () => void;
}

export interface UsageWindowFixture {
  label: string;
  usedPercent: number | null;
  resetLabel: string | null;
}

export interface AccountFixture {
  key: 'A' | 'B';
  name: string;
  context: string;
  windows: UsageWindowFixture[];
  credits: number | null;
}

export {};
