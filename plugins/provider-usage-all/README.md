# Combined provider usage

Local replacement for the built-in provider usage footer presentation. Keep the built-in `provider-usage` plugin enabled: this plugin reads its `getUsage` RPC, and makes a separate request for each provider so all sections are populated.

The built-in footer is hidden through `sidebar.hiddenFooterItems`; its backend and settings page remain available. The custom footer has no provider tabs. It retains a machine/source selector for multiple hosts or shared sources.

Validation: `npm test`, `npm run typecheck`, `bb plugin build .`.

Compatibility: built against BB SDK 0.5.29 and the built-in provider-usage `getUsage` contract. Schema changes fail visibly. Recheck this contract after BB upgrades.

Undo: remove `plugin:provider-usage/usage` from `sidebar.hiddenFooterItems` and disable `provider-usage-all`.
