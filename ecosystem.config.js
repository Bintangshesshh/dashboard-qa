const path = require("node:path");
const root = __dirname;
module.exports = {
  apps: [
    {
      name: "qa-backend",
      cwd: root,
      script: "server/index.mjs",
      node_args: "--env-file=.env",
      instances: 1,
      exec_mode: "fork",
      kill_timeout: 30000,
      max_memory_restart: "2G",
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: 3001 },
    },
    {
      name: "qa-web",
      cwd: path.join(root, "web"),
      script: "server.mjs",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
      env: { NODE_ENV: "production" },
    },
  ],
};
