# Router + Layout Rules

This project uses file-based routing from `vue-router/auto-routes` together with
`vite-plugin-vue-layouts`.

## Core Pipeline

1. `VueRouter()` generates routes from `src/pages`.
2. `setupLayouts(routes)` wraps page routes into layout routes.
3. `createRouter()` mounts final routes.

The implementation lives in:

- `vite.config.ts`
- `src/router/index.ts`

## Directory Rules

- Pages: `src/pages`
- Layouts: `src/layouts`
- Layout filename = layout name
  Example: `src/layouts/blank.vue` => `meta.layout = 'blank'`

## Page Layout Declaration

Use `<route lang="json5">` in page SFCs:

```vue
<route lang="json5">
{
  meta: {
    layout: 'blank'
  }
}
</route>
```

Defaults and exceptions:

- No `meta.layout` => uses `default.vue`
- `meta.layout = false` => disables layout wrapping

## Team Convention

- Prefer explicit layout names like `blank` for auth pages.
- Avoid hand-written static route tables for page routes.
- Keep `default.vue` and other layout files with `<RouterView />`.

## Verification Checklist

- `/` renders page inside `default.vue`.
- `/login` renders page inside `blank.vue`.
- Removing a page `meta.layout` falls back to `default.vue`.
- `meta.layout = false` renders page without a layout shell.
- Changing files in `src/pages` or `src/layouts` updates via HMR.
