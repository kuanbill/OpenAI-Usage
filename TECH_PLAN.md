# 技術規劃 — ChatGPT／Codex 用量監看

## 使用者已確認的產品邊界
- 只監看 ChatGPT／Codex 訂閱方案的使用情況；不做 OpenAI API Platform 用量／帳單。
- 可管理多個 ChatGPT 帳號，並分開呈現用量窗口、剩餘量（官方來源有提供時）、重設時間、同步狀態與歷史快照。
- 不提供升級／降級方案、購買方案、購買 credits、付費重置或任何付款流程。
- 顯示官方帳號已有的免費／推廣／banked reset 資訊；可由使用者在程式內明確選取並確認後使用免費 reset。禁止自動消耗、付費重置或付款。

## 建議技術

**Windows 優先桌面程式：Electron + React + TypeScript + SQLite（本機），透過本機 Codex App Server JSON-RPC 讀取方案用量。**

選擇 Electron 是為了先快速建立 Windows 桌面 UI、系統匣、通知與不同帳號隔離的登入視窗；React/TypeScript 負責儀表板及元件；SQLite 保存用量快照和告警設定。SQLite 只存必要的摘要，不存對話內容、cookies 或密碼。後續若 MVP 穩定，再評估 Tauri 降低封裝體積。

### 分層
1. **Renderer（React）**：多帳號總覽、各帳號用量卡、5 小時／週／月等窗口、剩餘量、重設倒數、歷史圖表、更新時間、告警設定。
2. **Main process（Electron/TypeScript）**：安全的視窗生命週期、通知、排程輪詢；不允許 renderer 任意讀檔或執行 shell。
3. **Local data service**：目標仍是 SQLite 儲存歷史快照；目前 adapter 階段只用 `accounts.json` 保存合成 profile ID、別名及建立時間，沒有保存用量歷史或帳號識別資訊。
4. **Provider adapter**：定義 `getUsage()`、`getResetWindows()`、`getAccountStatus()` 等介面。每個帳號獨立 adapter/session，失敗時保留最後成功值但醒目標示過期，絕不把舊值偽裝成即時值。
5. **Credential boundary**：使用者已說明其可用 OpenAI 官方 device-code 設定，再由本人於瀏覽器完成認證。裝置碼絕不在聊天中索取、傳送或保存；只由使用者在官方頁面輸入。不讀取／複製密碼、cookies、access token，也不解析私人 ChatGPT backend endpoint。只使用官方 Codex App Server 的登入與 RPC；不設定 API key、不呼叫 API Platform。若登入頁面提出建立 API 帳戶、建立 API key、選擇付費方案或付款，就取消並停下。

### 用量資料來源：Codex App Server
- 由桌面程式啟動本機 `codex app-server --listen stdio://` 子程序，使用 JSON-RPC over stdio；不直接呼叫 ChatGPT 網頁內部 API。
- Codex App Server 的官方協定 schema 包含 `account/rateLimits/read`（一次讀取用量快照）、`account/rateLimits/updated`（用量更新通知），並回傳主要／次要窗口的使用百分比、窗口長度、重設時間及可用 reset credits 數量／細節。
- App Server 也有 `account/rateLimitResetCredit/consume` 操作；它會消耗免費預存 reset credit，屬不可逆帳戶副作用。只有使用者明確在該帳號卡片按下「套用免費重置」並再次確認後才可呼叫，必須指定 credit、使用 idempotency key，呼叫後重新讀取驗證。預設只顯示可用額度，永不自動消耗。
- Codex CLI 目前把 `app-server` 標示為 **experimental**。因此把 JSON-RPC 封裝在單一 adapter，固定已驗證的 CLI 版本，升級前以 fixture 和測試帳號回歸；若協定變動，標示同步失效，不靜默改用私有 endpoint。
- 多帳號以每帳號獨立 Codex profile／App Server 子程序隔離；先前雙帳號 spike 驗證隔離，正式 app 目前也依此建立各自持久化 `CODEX_HOME`。登入由帳號持有人在官方頁輸入 device code；應用程式不自動建立登入流程。

## 重要可行性閘門（先做，不先堆 UI）
Codex App Server 官方協定提供一條比網頁 DOM 抓取穩定得多的本機唯讀候選路徑；CLI 協定本身仍標為 experimental。單帳號及兩個獨立 profile 的認證／用量讀取已驗證，但長時間輪詢、更新通知與跨版本穩定性尚未驗證。不同帳號的 reset credit 亦依帳號、方案、地區和推廣資格而異。

**已完成的單帳號驗證**：臨時執行 Codex CLI `0.163.0`，以官方 schema 確認 `account/rateLimits/read` 等方法；現有 session 可讀到主／次窗口及 reset-credit 欄位。另完成獨立的裝置代碼認證 UI 測試：使用隔離 `CODEX_HOME`，使用者在 OpenAI 官方頁自行輸入代碼，UI 回報認證與唯讀用量讀取成功。測試後已呼叫登出、刪除暫存 profile 並停止本機測試伺服器；沒有執行 reset、方案變更或付款。第二個帳號已通過隔離驗證。

**第二帳號隔離已通過**：在 `spikes/003-multi-account-isolation/` 的測試 UI 中，兩個不同帳號分別完成官方 device-code 認證；status 回報兩邊 `usageReadable=true`，email 僅在記憶體比對後丟棄，身分比較為 `different`。登出／清理流程已執行，兩個 profile 及測試 scratch root 均已移除；沒有使用 reset credit。Electron app 現已接上本機 `ProfileStore`、版本固定的 App Server RPC client 與只讀 usage adapter，另保留離線 fixture 作為非 Electron 預覽。

單帳號與雙帳號隔離登入／讀取 spike 已通過。正式 app adapter 已建立：每個帳號在 Electron user-data 目錄下有獨立持久化 profile；`account/read` 不主動刷新 token，`account/rateLimits/read` 以 `excludeResetCreditDetails: true` 讀取窗口及免費額度數量。啟動時同步一次，程式開啟期間每五分鐘輪詢，並把 sparse `account/rateLimits/updated` 通知轉成完整讀取。2026-10-17 正式 app 的真實 device-code 登入與唯讀用量讀取成功。重啟時 App Server 曾回報 `requiresOpenaiAuth: true`，但同一 ChatGPT profile 的官方唯讀 rate-limit 讀取仍成功；adapter 現在只在帳號型別為 ChatGPT 且該用量讀取成功後，才沿用現有 profile。修正後連續兩次乾淨關閉／重啟均恢復 LIVE 用量，未再次登入、未消耗重置額度。長時間運行及跨版本相容性仍待實測，且不承諾服務關閉時仍在背景同步。

若 App Server 路徑不能在使用者禁止 API 帳務／付款的條件下安全登入，或多帳號隔離不可靠，第一版退回人工更新／CSV 或截圖匯入模式，並明確標示非即時同步；不得以逆向私人 endpoint 或瀏覽器 cookie 抽取補洞。

## 更新與準即時性
- 「即時」先定義為準即時輪詢；目前原型固定五分鐘，只在 app 執行時運作。調整頻率與 Windows 服務／系統匣常駐仍未實作。
- 每筆資料記錄 `fetched_at`、來源、帳號、窗口、來源回報的 reset time、是否估算，以及錯誤狀態。
- UI 顯示「最後更新」和「資料延遲」；官方未回傳精確百分比時只顯示官方原文或可用狀態，不以本機請求次數自行推算方案用量。
- 重設倒數只對來源提供的 reset timestamp 倒數；跨時區儲存 UTC、畫面預設台北時間。

## MVP 順序
1. **第二帳號隔離測試**：已完成，兩個專用 `CODEX_HOME` 分別認證且讀取成功。
2. **UI 看板樣板**：已完成 fixture；Electron app 現有真實資料模式及空帳號狀態。
3. **本機桌面殼／profile 管理**：Electron 安全邊界、每帳號持久化 profile、新增／移除及清除已完成；歷史 SQLite、系統匣與通知未完成。
4. **正式 App Server adapter**：實作完成、CLI 固定 `0.163.0`，但整合後真實登入和讀取仍待使用者測試。
5. **歷史／告警**：日／週趨勢、門檻通知、CSV 匯出。
6. **免費 reset 操作**：只在官方來源回報 earned reset credit 且使用者二次確認後呼叫 consume，讀回驗證結果。

## 需固定的安全與產品規則
- 預設只讀；不做改方案、付費、購買 credits、付費重置。
- 不抓取對話內容，不保存完整 OpenAI 憑證、瀏覽器 cookie 或 session token。
- 不使用私人／未文件化 API，不以網站 DOM scraping 作為正式資料來源。
- 所有多帳號視窗/profile 和本機快照分帳號保存；切換帳號不混用任何狀態。
- 若只有手動模式，明確標示不是「即時自動同步」，不以 OCR 結果冒充官方即時資料。

## 目前已知產品限制需接受
OpenAI 官方文件指出，多帳號切換目前可用於 ChatGPT 網頁版，但尚未支援 Codex desktop。故本程式不能假設使用者能在同一個 Codex desktop 視窗同時登入多帳號；要以隔離的帳號 session 或人工切換並確認帳號標籤處理，而且需先通過可行性 spike。
