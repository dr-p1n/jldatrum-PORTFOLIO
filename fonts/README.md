# Fonts

Place the licensed **Adieu** display font here as:

```
fonts/Adieu-Bold.woff2
```

It's referenced by `css/typography.css` via `@font-face` (`/fonts/Adieu-Bold.woff2`).
Adieu is a commercial font and is intentionally **not** committed to the repo —
add your licensed `.woff2` file to this folder and it will load automatically.

Until the file is present, headings gracefully fall back to **DM Sans**
(the fallback declared in `--font-display`).
