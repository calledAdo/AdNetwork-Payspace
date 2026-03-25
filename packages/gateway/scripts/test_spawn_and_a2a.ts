const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8080";
const CONVERSATION_WAIT_MS = Number(process.env.CONVERSATION_WAIT_MS ?? "30000");
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "5000");
const KEEP_TEST_AGENTS = process.env.KEEP_TEST_AGENTS === "1";

type SpawnedAgent = {
  agentId: string;
  a2aUrl: string;
};

/**
 * Requests the gateway to spawn a temporary test agent of the requested type.
 */
async function spawnAgent(
  label: string,
  type: "test_agent_a" | "test_agent_b",
): Promise<SpawnedAgent> {
  console.log(`\n[Test] Spawning ${label} (${type})...`);
  const res = await fetch(`${GATEWAY_URL}/agents/spawn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to spawn ${label}: ${res.status} ${text}`);
  }
  
  const data = await res.json() as SpawnedAgent;
  console.log(`[Test] ${label} spawned! ID: ${data.agentId}, A2A: ${data.a2aUrl}`);
  return data;
}

/**
 * Sends a plain user message to a gateway-managed agent through the management
 * chat endpoint and returns the upstream completion payload.
 */
async function sendChatCommand(agentId: string, message: string) {
  console.log(`\n[Test] Sending chat message to agent ${agentId}...`);
  console.log(`[Test] Message: "${message}"`);
  
  const res = await fetch(`${GATEWAY_URL}/agents/${agentId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat command failed: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  console.log(`[Test] Chat response received!`);
  return data;
}

/**
 * Reads the agent conversation summary endpoint used by this smoke test to
 * confirm whether A2A activity has been persisted yet.
 */
async function checkConversations(agentId: string) {
  console.log(`\n[Test] Checking conversations for agent ${agentId}...`);
  const res = await fetch(`${GATEWAY_URL}/agents/${agentId}/conversations`);
  const data = await res.json();
  console.log(`[Test] ${data.conversations.length} conversation(s) found.`);
  return data.conversations;
}

/**
 * Polls the conversation endpoint until at least one conversation appears or
 * the configured timeout elapses.
 */
async function waitForConversations(agentId: string) {
  const deadline = Date.now() + CONVERSATION_WAIT_MS;

  while (Date.now() < deadline) {
    const conversations = await checkConversations(agentId);
    if (conversations.length > 0) return conversations;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const sleepMs = Math.min(POLL_INTERVAL_MS, remainingMs);
    console.log(`[Test] No conversations yet. Waiting ${sleepMs}ms before retry...`);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  return [];
}

/**
 * Deletes a temporary test agent so local test runs do not accumulate stale
 * workspaces and traces over time.
 */
async function deleteAgent(agentId: string) {
  console.log(`\n[Test] Deleting ${agentId} to prevent trace bloat...`);
  const res = await fetch(`${GATEWAY_URL}/agents/${agentId}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const text = await res.text();
    console.log(`[Test] Cleanup warning for ${agentId}: ${res.status} ${text}`);
    return;
  }

  console.log(`[Test] ${agentId} deleted through gateway.`);
}

/**
 * Exercises the spawn, chat, A2A, and cleanup flow end to end for the two test
 * agent templates bundled with the gateway.
 */
async function main() {
  let agentAId = "";
  let agentBId = "";
  let agentAA2AUrl = "";
  let agentBA2AUrl = "";
  try {
    // 1. Spawn Test Agent A & Test Agent B
    const agentA = await spawnAgent("Test Agent A", "test_agent_a");
    agentAId = agentA.agentId;
    agentAA2AUrl = agentA.a2aUrl;
    const agentB = await spawnAgent("Test Agent B", "test_agent_b");
    agentBId = agentB.agentId;
    agentBA2AUrl = agentB.a2aUrl;

    // 2. Tell Test Agent A to send an A2A message to Test Agent B
    const prompt =
      `Use the exec tool with curl to POST a JSON-RPC 2.0 message/send request to this A2A URL: ${agentB.a2aUrl}. ` +
      `Use contextId ctx-test-a2a-1. ` +
      `The message should say hello from Test Agent A and ask for an acknowledgement. ` +
      `After sending it, tell me whether the POST succeeded and what came back, and write/update memory/conversations/ctx-test-a2a-1.json.`;
    const chatResult = await sendChatCommand(agentA.agentId, prompt);
    console.log(JSON.stringify(chatResult, null, 2));

    // 3. Poll for conversation state for a while before deciding the result
    console.log(
      `\n[Test] Polling Test Agent B conversation state for up to ${CONVERSATION_WAIT_MS}ms...`,
    );
    const agentBConvos = await waitForConversations(agentB.agentId);

    // 4. Verify Test Agent B actually received the message
    if (agentBConvos.length > 0) {
      console.log(`\n[Success] Test Agent B received the message! Conversations:`, agentBConvos);
    } else {
      console.log(
        `\n[Failure] Test Agent B still has zero conversations after ${CONVERSATION_WAIT_MS}ms.`,
      );
      console.log(`[Test] Agent A A2A URL: ${agentAA2AUrl}`);
      console.log(`[Test] Agent B A2A URL: ${agentBA2AUrl}`);
    }

  } catch (err) {
    console.error(`\n[Fatal Error]`, err);
  } finally {
    if (KEEP_TEST_AGENTS) {
      console.log("\n[Test] KEEP_TEST_AGENTS=1, skipping cleanup.");
      console.log(`[Test] Test Agent A: ${agentAId} (${agentAA2AUrl})`);
      console.log(`[Test] Test Agent B: ${agentBId} (${agentBA2AUrl})`);
      return;
    }

    if (agentAId) await deleteAgent(agentAId);
    if (agentBId) await deleteAgent(agentBId);
    console.log("[Test] Trace cleanup complete.");
  }
}

main();
