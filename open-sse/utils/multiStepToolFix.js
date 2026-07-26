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
 *
 * ROOT CAUSE FOUND: kimi-k2.7-code on CF misinterprets assistant messages that
 * contain BOTH `content` (thinking text) AND `tool_calls`. The model sees the
 * content as its "answer" and stops with finish_reason:"stop" instead of calling
 * the next tool. This happens when agents like Pi send conversation history with
 * thinking/reasoning stored in the `content` field.
 *
 * Fix: cleanConversationHistory() moves `content` → `reasoning_content` for
 * assistant messages that have tool_calls, so the model doesn't confuse thinking
 * with a completed response.
 */
export function needsMultiStepFix(provider, model) {
  if (!model || !provider) return false;
  const KIMI_PATTERNS = [
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
  ];
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  return KIMI_PATTERNS.some((p) => baseModel === p);
}

/**
 * Clean conversation history for kimi-k2.7-code.
 *
 * Moves `content` → `reasoning_content` for assistant messages that have
 * tool_calls. Without this, kimi sees the thinking text as a completed
 * response and stops prematurely (finish_reason:"stop" with no tool call).
 *
 * Mutates `body` in-place.
 *
 * @param {object} body - The translated request body (OpenAI-compatible shape).
 */
export function cleanConversationHistory(body) {
  if (!Array.isArray(body.messages)) return;

  let cleaned = 0;
  for (const msg of body.messages) {
    if (msg.role !== "assistant") continue;
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

    // Log the actual format we see (for debugging)
    console.log(`[MULTISTEP] assistant msg: content_type=${typeof msg.content} content_val=${JSON.stringify(msg.content)?.slice(0, 100)} has_tool_calls=${hasToolCalls} keys=${Object.keys(msg).join(",")}`);

    if (hasToolCalls && typeof msg.content === "string" && msg.content.length > 0) {
      msg.reasoning_content = (msg.reasoning_content || "") + msg.content;
      msg.content = null;
      cleaned++;
    }

    if (Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b?.type === "tool_use");
      if (hasToolUse && !hasToolCalls) {
        const toolUses = msg.content.filter(b => b?.type === "tool_use");
        const thinking = msg.content.filter(b => b?.type === "thinking");
        const textParts = msg.content.filter(b => b?.type === "text");

        msg.tool_calls = toolUses.map((tu, idx) => ({
          id: tu.id || `call_${idx}`,
          type: "function",
          function: {
            name: tu.name,
            arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input || {}),
          },
        }));

        const thinkText = thinking.map(b => b.thinking || "").join("") + textParts.map(b => b.text || "").join("");
        if (thinkText) {
          msg.reasoning_content = (msg.reasoning_content || "") + thinkText;
        }
        msg.content = null;
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.log(`[MULTISTEP] cleanConversationHistory: fixed ${cleaned} assistant message(s)`);
  }
}

/**
 * Inject the sentinel tool for multi-step tool calling.
 *
 * IMPORTANT: We do NOT force tool_choice:"required". Forcing "required" causes
 * infinite tool-call loops — the model can't output a text-only final response,
 * so it keeps calling filler tools (name_session, biome_check, etc.) forever.
 *
 * Instead we keep tool_choice at whatever the client set (usually "auto") and
 * inject the sentinel tool with a very explicit description. If the model calls
 * _router_finish → we rewrite it to a clean stop. If the model stops naturally
 * with text → that's fine too, the response passes through unchanged.
 *
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
  // Keep existing tool_choice (usually "auto"). Do NOT force "required".

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

/**
 * Create a TransformStream that filters _router_finish sentinel tool calls
 * from live SSE streams. Strips sentinel tool-call deltas, accumulates the
 * summary argument, and converts the final finish_reason:tool_calls → stop,
 * emitting the summary as content delta.
 *
 * This is what makes the fix work for streaming passthrough (Pi TUI, etc.).
 * Without it, the client sees _router_finish as an unknown tool call and
 * can't properly terminate.
 *
 * @returns {TransformStream<Uint8Array, Uint8Array>}
 */
export function createSentinelFilterStream() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let sentinelActive = false;
  let sentinelIndex = null;
  let accumulatedArgs = "";

  function processEvent(rawEvent) {
    // Extract data: payload(s) from SSE event
    const lines = rawEvent.split("\n");
    const dataLines = lines.filter((l) => l.trim().startsWith("data:"));
    // Keep non-data lines (comments, event: etc) as-is
    const metaLines = lines.filter((l) => !l.trim().startsWith("data:")).join("\n");

    if (dataLines.length === 0) return rawEvent + "\n\n";

    const payload = dataLines.map((l) => l.trim().slice(5).trim()).join("\n");

    if (payload === "[DONE]") return (metaLines ? metaLines + "\n" : "") + "data: [DONE]\n\n";

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      // Not valid JSON — pass through untouched
      return "data: " + payload + "\n\n";
    }

    const choice = chunk?.choices?.[0];
    if (!choice) return "data: " + JSON.stringify(chunk) + "\n\n";

    const delta = choice.delta || {};

    // Detect sentinel tool call by name in any delta
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (tc?.function?.name === SENTINEL_TOOL_NAME) {
          sentinelActive = true;
          sentinelIndex = tc.index ?? 0;
        }
      }
    }

    if (!sentinelActive) {
      return "data: " + JSON.stringify(chunk) + "\n\n";
    }

    // --- Sentinel filtering mode ---

    // Accumulate arguments from sentinel tool call deltas
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if ((tc?.index ?? 0) === sentinelIndex && tc?.function?.arguments) {
          accumulatedArgs += tc.function.arguments;
        }
      }
      // Remove all sentinel-index tool calls
      const filtered = delta.tool_calls.filter(
        (tc) => (tc?.index ?? 0) !== sentinelIndex
      );
      if (filtered.length > 0) {
        delta.tool_calls = filtered;
      } else {
        delete delta.tool_calls;
      }
    }

    // Rewrite finish_reason when sentinel was the completion trigger
    if (choice.finish_reason === "tool_calls") {
      choice.finish_reason = "stop";
      // Emit accumulated summary as content
      try {
        const parsed = JSON.parse(accumulatedArgs);
        if (parsed.summary) {
          delta.content = (delta.content || "") + parsed.summary;
        }
      } catch { /* malformed args — no summary */ }
    }

    // Suppress chunks that are now empty (no content, no reasoning, no tool_calls, no finish)
    const hasContent = delta.content || delta.reasoning_content;
    const hasRole = delta.role;
    const hasTools = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
    const hasFinish = choice.finish_reason;
    if (!hasContent && !hasRole && !hasTools && !hasFinish) {
      return null; // suppress this event entirely
    }

    return "data: " + JSON.stringify(chunk) + "\n\n";
  }

  return new TransformStream({
    transform(rawChunk, controller) {
      buffer += decoder.decode(rawChunk, { stream: true });

      // SSE events are separated by \n\n
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const output = processEvent(event);
        if (output !== null) controller.enqueue(encoder.encode(output));
      }
    },
    flush(controller) {
      // Process any remaining buffered data
      const trimmed = buffer.trim();
      if (trimmed) {
        const output = processEvent(trimmed);
        if (output !== null) controller.enqueue(encoder.encode(output));
      }
    },
  });
}
