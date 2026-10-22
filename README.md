# claude-mods

Mods for [Claude Code](https://code.claude.com): small plugins of function hooks that change Claude Code's own interface. This repository is one marketplace that holds several of them, each in its own folder.

## Mods

| Mod | What it does |
| --- | --- |
| [token-dragon](token-dragon/) | A pixel dragon above the prompt that grows one segment per 2% of your 5-hour usage window, changes colour each window, breathes fire, and turns to bones at 100% |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install token-dragon --marketplace zz1996zz/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope. From a shell instead:

```
claude plugin install token-dragon --marketplace zz1996zz/claude-mods
```

## Layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per mod
<mod>/
  .claude-plugin/plugin.json      the mod's manifest
  hooks/hooks.json                names the hooks module
  hooks/register.tsx              the hooks module
  hooks/*.test.tsx                tests, run with `claude plugin test <mod>`
  types/index.d.ts                the mod's $.state contract
  README.md
```

## Adding a mod

1. Make a folder named after the mod, with the files above.
2. Add an entry to `.claude-plugin/marketplace.json`: `{ "name": "<mod>", "source": "./<mod>", "description": "…" }`.
3. Add a row to the table above.
4. Check it: `claude plugin validate <mod>` and `claude plugin test <mod>`.

## License

[MIT](LICENSE)
