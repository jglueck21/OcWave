# Fonts

OcWave bundles its fonts so the app never contacts a third party and works offline.

| File | What | Licence |
|---|---|---|
| `inter-*.woff2` | [Inter](https://rsms.me/inter/) variable font (weights 100–900), split by script | SIL Open Font License 1.1 |
| `material-symbols-rounded.woff2` | A subset of [Material Symbols Rounded](https://fonts.google.com/icons) with only the icons the app uses | Apache License 2.0 |

Chinese, Japanese and Korean text uses the fonts already installed on the device.

## Adding a new icon

Use the icon in the code (`icon("some_name")`), then rebuild the subset, otherwise the icon appears as plain text:

```bash
python3 assets/fonts/build-icons.py
```

Bump `VERSION` in `sw.js` afterwards so installed copies pick up the new font.
