# Caffeine Energy Tracker

A personal page for one question: given the drinks you logged, how much caffeine is still in you, how much your recent routine would lead you to expect at this time of day, and whether you are above or below that.

It is a static site. The maths run in the browser. Doses and settings stay in local storage on that device. There is no account and no server.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository.
2. Settings → Pages → Build and deployment → Deploy from a branch.
3. Branch `main`, folder `/ (root)`, then save.

The site uses relative paths, so it works both at `https://user.github.io/repo/` and at a user site root. `.nojekyll` is there so GitHub does not run Jekyll over the files.

Opening `index.html` from a folder path will not start the app. Browsers block its modules on `file://`. Use Pages, or from this folder:

```bash
npx serve
```

## Tests

```bash
npm test
```

The engine is `js/engine.js`. It does not touch the page or storage. The tests include the spreadsheet's three sample days.

## Defaults

Suggested defaults are a 4 hour half-life, first-order absorption, overnight carry on, a 7-day memory, recency 0.8, and 30 minutes of smoothing. **Prototype values** in Settings switch to the spreadsheet: instant absorption, no overnight carry, 2 days, recency 0.5, no smoothing, window 06:00–21:00.

Smoothing is symmetric, so the baseline rises a little before a usual drink. With smoothing above zero, a perfectly repeated habit is a small wave around zero rather than a perfectly flat line. Set smoothing to 0 when you want that flat steady state. The engine stays in this site rather than a separate package until those time constants have been lived with.
