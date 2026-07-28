// server.js
require("dotenv").config();
const { createApp } = require("./src/app");
const { getRuntimeConfig } = require("./src/config/runtime-config");

const { port, host, serverUrl, contextRoot } = getRuntimeConfig(process.env);
const { app } = createApp(__dirname, { contextRoot });

app.listen(port, host, () => {
  console.log(`✅ Server running: ${serverUrl}`);
});