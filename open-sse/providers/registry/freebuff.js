// Freebuff — free coding agent by Codebuff (codebuff.com).
// Uses self-hosted freebuff-proxy (OpenAI-compatible) that handles
// CLI fingerprint spoofing, session management, and 22-account pooling.

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
      apiHint: 'Proxy API key (default: moccilabs-freebuff-2026)',
    },
  },
  category: "freeTier",
  authType: "apikey",
  hasOAuth: false,
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://freebuff.patchfly.dev/v1/chat/completions",
    format: "openai",
    headers: {},
    retry: {
      429: { attempts: 2, delayMs: 3000 },
      502: { attempts: 2, delayMs: 1000 },
      503: { attempts: 2, delayMs: 2000 },
    },
  },
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", upstreamModelId: "deepseek/deepseek-v4-flash" },
    { id: "minimax-m2.7", name: "MiniMax M2.7", upstreamModelId: "minimax/minimax-m2.7" },
    { id: "minimax-m3", name: "MiniMax M3", upstreamModelId: "minimax/minimax-m3" },
    { id: "mimo-v2.5", name: "MiMo 2.5", upstreamModelId: "mimo/mimo-v2.5" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", upstreamModelId: "deepseek/deepseek-v4-pro" },
    { id: "mimo-v2.5-pro", name: "MiMo 2.5 Pro", upstreamModelId: "mimo/mimo-v2.5-pro" },
    { id: "kimi-k2.6", name: "Kimi K2.6", upstreamModelId: "moonshotai/kimi-k2.6" },
  ],
};
