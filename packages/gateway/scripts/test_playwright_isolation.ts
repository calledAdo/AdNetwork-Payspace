import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { startPlaywrightMcp, terminatePlaywrightMcp } from "../src/playwright.js";

/**
 * Boots the shared Playwright MCP server and exercises a minimal navigate plus
 * evaluate flow to confirm the MCP tool surface is reachable.
 */
async function runTest() {
  console.log("1. Starting standalone Playwright MCP Server...");
  // This will spin up the headless browser sidecar on port 9000
  await startPlaywrightMcp();

  console.log("2. Connecting raw MCP Client over SSE...");
  const transport = new SSEClientTransport(new URL("http://localhost:9000/sse"));
  const client = new Client({ name: "isolation-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  console.log("3. Fetching registered Playwright tools...");
  const toolsInfo = await client.listTools();
  console.log(`Discovered ${toolsInfo.tools.length} available tools.`);

  // Find the exact name of the navigation and evaluation tools
  const navTool = toolsInfo.tools.find(t => t.name.includes("navigate"))?.name || "playwright_navigate";
  const evalTool = toolsInfo.tools.find(t => t.name.includes("evaluate"))?.name || "playwright_evaluate";

  console.log(`4. Instructing browser to navigate to local HTML workspace via tool: [${navTool}]`);
  const navResult = await client.callTool({
    name: navTool,
    arguments: { url: "http://localhost:7777/test_ad.html" } // Pointing to our dummy HTML!
  });
  console.log("Navigation Result:", JSON.stringify(navResult, null, 2));

  const evalToolDef = toolsInfo.tools.find(t => t.name === evalTool);
  console.log(`\n5. Schema for ${evalTool}:`, JSON.stringify(evalToolDef?.inputSchema, null, 2));

  console.log(`\n6. Extracting bounding box and geometry via [${evalTool}]`);
  const evalResult = await client.callTool({
    name: evalTool,
    arguments: { 
      // Zod path validation errors previously demanded the parameter mapped to 'script' or 'function'
      script: "document.querySelector('#ad-banner') ? JSON.stringify(document.querySelector('#ad-banner').getBoundingClientRect()) : 'null'",
      function: "() => JSON.stringify(document.querySelector('#ad-banner').getBoundingClientRect())"
    }
  });
  console.log("Evaluation Result:", JSON.stringify(evalResult, null, 2));

  console.log("\n7. Terminating test connection...");
  terminatePlaywrightMcp();
  process.exit(0);
}

/**
 * Logs a failure, tears down the shared Playwright process, and exits non-zero
 * so the script behaves like a standard CI smoke test.
 */
function handleFailure(err: unknown): never {
  console.error("Test failed:", err);
  terminatePlaywrightMcp();
  process.exit(1);
}

runTest().catch(handleFailure);
