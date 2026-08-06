// Freebuff — free coding agent by Codebuff (codebuff.com).
// Free-tier models (MiniMax M2.7/M3, DeepSeek V4, MiMo 2.5, etc.) accessible
// via auth token from `npm i -g freebuff && freebuff` CLI login.
// Token stored at ~/.config/manicode/credentials.json → default.authToken.
//
// Custom executor (executors/freebuff.js) handles:
//  - Agent run lifecycle (POST /api/v1/agent-runs → START/FINISH)
//  - Free session management (POST/GET/DELETE /api/v1/freebuff/session)
//  - Metadata injection ({ run_id, cost_mode:"free", client_id, freebuff_instance_id })

export default {
  id: "freebuff",
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#FF6B35",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com/login",
      apiHint:
        'Run `npm i -g freebuff && freebuff` to login, then paste the authToken from ~/.config/manicode/credentials.json',
    },
  },
  category: "freeTier",
  authType: "apikey",
  hasOAuth: false, // token from CLI, no dashboard OAuth flow
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "Freebuff-CLI/0.0.96",
    },
    retry: {
      429: { attempts: 2, delayMs: 3000 },
      502: { attempts: 2, delayMs: 1000 },
      503: { attempts: 2, delayMs: 2000 },
    },
  },
  models: [
    { id: "minimax-m2.7", name: "MiniMax M2.7", upstreamModelId: "minimax/minimax-m2.7" },
    { id: "minimax-m3", name: "MiniMax M3", upstreamModelId: "minimax/minimax-m3" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", upstreamModelId: "deepseek/deepseek-v4-flash" },
    { id: "mimo-v2.5", name: "MiMo 2.5", upstreamModelId: "mimo/mimo-v2.5" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", upstreamModelId: "deepseek/deepseek-v4-pro" },
    { id: "mimo-v2.5-pro", name: "MiMo 2.5 Pro", upstreamModelId: "mimo/mimo-v2.5-pro" },
    { id: "kimi-k2.6", name: "Kimi K2.6", upstreamModelId: "moonshotai/kimi-k2.6" },
  ],
};
