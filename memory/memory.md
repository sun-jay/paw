# Setup

## System Dependencies
- **Bun** v1.3.5 — runtime (native TS, no build step)
- **1Password CLI (op)** v2.32.1 — installed via `brew install --cask 1password-cli`
- **Node** v25.2.1 — available but not primary runtime

## 1Password
- **Vault**: `personal_agent_workspace` (id: `syasa3g7o7luojwif3jipl3fde`)
- **Service account**: read_items + write_items (full CRUD verified)
- **Token location**: root `.env` file (gitignored), variable `OP_SERVICE_ACCOUNT_TOKEN`
- Service account permissions are immutable — must recreate to change

## Items in Vault
- **EdStem** (category: API_CREDENTIAL, field: `credential`)
