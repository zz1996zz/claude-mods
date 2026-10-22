# token-dragon

A pixel dragon that lives above the Claude Code prompt and grows with your 5-hour usage window.

- **Grows** one body segment per 2% of the 5-hour window, from a lone head at 0% to a long eastern dragon near 100%.
- **Changes colour** every window: the hue is taken from the window's reset time, so it stays the same dragon until the window resets.
- **Moves**: the body undulates, the eye blinks, and every few seconds it lifts its head and breathes fire.
- **Dies** at 100%: only bones remain until the window resets.
- Shows the 5-hour and 7-day bars and their reset times on the left.

It reads the rate-limit windows Claude Code reports, so it shows on a Claude subscription; with an API key there is nothing to draw and the band stays empty.

## Install

```
/plugin install token-dragon --marketplace zz1996zz/claude-mods
```

## Terminals

The dragon is an inline image (kitty graphics, drawn as PNG) on iTerm2 3.5+, kitty, Ghostty and Orca with kitty images, and half-block coloured text elsewhere. The `renderer` option (`/config`) forces one: `auto` (default), `image` or `blocks`.

## Develop

```
claude plugin validate token-dragon
claude plugin test token-dragon
```
