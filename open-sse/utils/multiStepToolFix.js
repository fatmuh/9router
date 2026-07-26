/**
 * Multi-step tool calling fix for models that stop prematurely.
 *
 * Problem: Some CF Workers AI models (kimi-k2.7-code) return text-only responses
 * (finish_reason: "stop") in the middle of a multi-step tool-calling task instead
 * of calling the next tool. This breaks agentic loops in coding agents (Pi, etc.).
 *
 * Fix: When tools are present, force tool_choice:"required" and inject a sentinel
 * "_router_finish" tool. The model must call a tool every turn. When done, it calls
 * _router_finish → the router rewrites the response to a normal "stop" with the
 * summary as text content. The client never sees the sentinel — it just sees a
 * natural conversation end.
 *
 * Scope: Only models flagged with multiStepToolFix capability. GLM-5.2, Llama, etc.
 * work fine with tool_choice:"auto" and are NOT touched.
 */

const SENTINEL_TOOL_NAME = "_router_finish";
const SENTINEL_TOOL = {
  type: "function",
  function: {
    name: SENTINEL_TOOL_NAME,
    description:
      "Call this when the task is fully complete and no more tool calls are needed. " +
      "Provide a brief summary of what was accomplished.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of what was accomplished.",
        },
      },
      required: ["summary"],
    },
  },
};

/**
 * Check if a model needs the multi-step tool fix.
 * Only specific CF models that exhibit the premature-stop behavior.
 */
export function needsMultiStepFix(provider, model) {
  if (!model || !provider) return false;

  // Only apply when the request includes tools (agentic / function-calling context).
  // Plain chat requests are never affected.

  // Kimi K2.7 Code on CF Workers — confirmed premature stop in multi-turn tool calling.
  // GLM-5.2 and Llama on the same CF backend work fine with tool_choice:"auto".
  const KIMI_PATTERNS = [
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
  ];

  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  return KIMI_PATTERNS.some((p) => baseModel === p);
}

/**
 * Inject the sentinel tool and force tool_choice:"required".
 * Mutates `body` in-place. Only acts when tools are already present.
 *
 * @param {object} body - The translated request body (OpenAI-compatible shape).
 * @returns {boolean} true if injection was applied.
 */
export function injectSentinelTool(body) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return false;

  // Don't double-inject
  if (body.tools.some((t) => t?.function?.name === SENTINEL_TOOL_NAME)) return false;

  // Don't override an explicit "none" from the client
  if (body.tool_choice === "none") return false;

  body.tools = [...body.tools, SENTINEL_TOOL];
  body.tool_choice = "required";

  return true;
}

/**
 * Check if a tool_calls array contains the sentinel tool.
 * @param {array} toolCalls
 * @returns {object|null} The sentinel tool call, or null.
 */
function findSentinelCall(toolCalls) {
  if (!Array.isArray(toolCalls)) return null;
  return toolCalls.find(
    (tc) => tc?.function?.name === SENTINEL_TOOL_NAME
  ) || null;
}

/**
 * Rewrite a non-streaming (JSON) response that contains the sentinel tool call.
 * Converts it to a natural "stop" response with the summary as content.
 *
 * @param {object} responseData - The parsed JSON response from the provider.
 * @returns {object|null} The rewritten response, or null if no sentinel found.
 */
export function rewriteNonStreamingSentinel(responseData) {
  if (!responseData?.choices?.[0]) return null;

  const choice = responseData.choices[0];
  const msg = choice.message || {};
  const sentinel = findSentinelCall(msg.tool_calls);

  if (!sentinel) return null;

  // Extract summary from sentinel args
  let summary = "";
  try {
    const args = JSON.parse(sentinel.function.arguments || "{}");
    summary = args.summary || "";
  } catch {
    summary = "";
  }

  // Build clean message: keep any non-sentinel tool calls, set text content
  const remainingTools = msg.tool_calls.filter(
    (tc) => tc?.function?.name !== SENTINEL_TOOL_NAME
  );

  const newMessage = {
    ...msg,
    content: summary || (msg.content || ""),
    tool_calls: remainingTools.length > 0 ? remainingTools : undefined,
  };
  if (!newMessage.tool_calls) delete newMessage.tool_calls;
  if (!newMessage.content) newMessage.content = "";

  return {
    ...responseData,
    choices: [
      {
        ...choice,
        message: newMessage,
        finish_reason: remainingTools.length > 0 ? "tool_calls" : "stop",
      },
      ...responseData.choices.slice(1),
    ],
  };
}

/**
 * Check if accumulated streaming tool calls include the sentinel.
 * Used by SSE-to-JSON / streaming handlers to decide if rewriting is needed.
 *
 * @param {array} toolCalls - Accumulated tool_calls from streaming deltas.
 * @returns {boolean}
 */
export function streamHasSentinel(toolCalls) {
  return findSentinelCall(toolCalls) !== null;
}

/**
 * Rewrite streaming SSE chunks to convert sentinel calls.
 * This is called per-chunk; if the chunk's delta contains sentinel tool call
 * info, it's converted to a content delta + eventual stop.
 *
 * For simplicity in streaming, we handle this at the assembled-message level
 * in sseToJsonHandler. For raw streaming passthrough, the sentinel tool call
 * passes through to the client — the client will see _router_finish as a tool
 * call and can handle it (most agents just return "OK" for unknown tools).
 *
 * @param {object} assembledMessage - Fully assembled message from stream.
 * @param {string} finishReason - The finish reason from the stream.
 * @returns {object|null} { message, finishReason } or null if no sentinel.
 */
export function rewriteStreamingSentinel(assembledMessage, finishReason) {
  if (!assembledMessage) return null;

  const sentinel = findSentinelCall(assembledMessage.tool_calls);
  if (!sentinel) return null;

  let summary = "";
  try {
    const args = JSON.parse(sentinel.function.arguments || "{}");
    summary = args.summary || "";
  } catch {
    summary = "";
  }

  const remainingTools = (assembledMessage.tool_calls || []).filter(
    (tc) => tc?.function?.name !== SENTINEL_TOOL_NAME
  );

  const newMessage = {
    ...assembledMessage,
    content: summary || (assembledMessage.content || ""),
    tool_calls: remainingTools.length > 0 ? remainingTools : undefined,
  };
  if (!newMessage.tool_calls) delete newMessage.tool_calls;
  if (!newMessage.content) newMessage.content = "";

  return {
    message: newMessage,
    finishReason: remainingTools.length > 0 ? "tool_calls" : "stop",
  };
}
