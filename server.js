// server.js
require("dotenv").config();
const { createApp } = require("./src/app");

const PORT = process.env.PORT || 3000;
const { app } = createApp(__dirname);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});