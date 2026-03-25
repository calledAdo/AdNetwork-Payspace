import app from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`Payspace backend running on port ${config.port}`);
  console.log(`Data directory: ${process.env.DATA_DIR ?? "./packages/payspace_backend/data"}`);
});
