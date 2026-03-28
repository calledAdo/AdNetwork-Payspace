import app from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`tracking_payspace_server running on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});
