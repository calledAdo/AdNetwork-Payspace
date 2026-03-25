import { spawnSync } from "node:child_process";
import fs from "node:fs";
const GATEWAY_URL = "http://localhost:8080";
async function spawnAgent(name) {
    console.log(`\n[Test] Spawning ${name}...`);
    const res = await fetch(`${GATEWAY_URL}/agents/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test" }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to spawn ${name}: ${res.status} ${text}`);
    }
    const data = await res.json();
    console.log(`[Test] ${name} spawned! ID: ${data.agentId}, A2A: ${data.a2aUrl}`);
    return data;
}
async function sendChatCommand(agentId, message) {
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
async function checkConversations(agentId) {
    console.log(`\n[Test] Checking conversations for agent ${agentId}...`);
    const res = await fetch(`${GATEWAY_URL}/agents/${agentId}/conversations`);
    const data = await res.json();
    console.log(`[Test] ${data.conversations.length} conversation(s) found.`);
    return data.conversations;
}
function deleteAgent(agentId) {
    console.log(`\n[Test] Deleting ${agentId} to prevent trace bloat...`);
    spawnSync("openclaw", ["agents", "delete", agentId, "--force"], { stdio: "ignore" });
    fs.rmSync(`./test_agents/${agentId}`, { recursive: true, force: true });
}
async function main() {
    let aliceId = "";
    let bobId = "";
    try {
        // 1. Spawn Alice & Bob
        const alice = await spawnAgent("Alice");
        aliceId = alice.agentId;
        const bob = await spawnAgent("Bob");
        bobId = bob.agentId;
        // 2. Tell Alice to send an A2A message to Bob
        const prompt = `Please say a friendly hello to the test agent located at this A2A URL: ${bob.a2aUrl}`;
        const chatResult = await sendChatCommand(alice.agentId, prompt);
        console.log(JSON.stringify(chatResult, null, 2));
        // 3. Wait a few seconds for Bob to process the incoming A2A message (if asynchronous)
        console.log(`\n[Test] Waiting 5 seconds before checking Bob's memory...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        // 4. Verify Bob actually received the message
        const bobConvos = await checkConversations(bob.agentId);
        if (bobConvos.length > 0) {
            console.log(`\n[Success] Bob received the message! Conversations:`, bobConvos);
        }
        else {
            console.log(`\n[Failure] Bob has zero conversations. The A2A routing or processing might have failed.`);
        }
    }
    catch (err) {
        console.error(`\n[Fatal Error]`, err);
    }
    finally {
        if (aliceId)
            deleteAgent(aliceId);
        if (bobId)
            deleteAgent(bobId);
        console.log("[Test] Trace cleanup complete.");
    }
}
main();
//# sourceMappingURL=test_spawn_and_a2a.js.map