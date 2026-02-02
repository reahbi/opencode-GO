// ecosystem.config.example.cjs
// Copy to ecosystem.config.cjs and customize, or run `bun run setup` to generate interactively.
//
// Usage:
//   pm2 start ecosystem.config.cjs          # Start all instances
//   pm2 start ecosystem.config.cjs --only opencaddy-my-project  # Start one instance
//   pm2 logs                                # View logs
//   pm2 stop ecosystem.config.cjs           # Stop all

module.exports = {
  apps: [
    {
      name: 'opencaddy-my-project',
      script: 'src/main.ts',
      interpreter: 'bun',
      cwd: '/path/to/opencaddy',
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
        BOT_TOKEN: 'your-bot-token-from-botfather',
        ALLOWED_USER_IDS: '123456789',
        DEFAULT_PROJECT: '/path/to/your/project',
        INSTANCE_NAME: 'my-project',
        STATE_DIR: 'data/instances/my-project',
        OPENCODE_SERVER_URL: 'http://127.0.0.1:4096',
        OPENCODE_SERVER_USERNAME: 'opencode',
        OPENCODE_SERVER_PASSWORD: '',
      },
      autorestart: true,
      max_memory_restart: '512M',
    },
    // Add more instances here, or use `bun run setup` to add them
  ],
};
