---
name: project-conventions
description: FE Monorepo project conventions — architecture, patterns, code generation, state management, and best practices for this monorepo (Next.js 16, React 19, TypeScript, TurboRepo). Use when building features, writing components, or integrating APIs in this project.
---

# FE Monorepo Project Conventions

Project conventions for this TurboRepo monorepo with Next.js 16 App Router, React 19, TypeScript 5.5.4, Tailwind CSS, Zustand, SWR, Zod, and Storybook 8.6.x.

## Architecture Layers

1. **App** (`apps/*`): Next.js routes, pages, API routes
2. **Package** (`packages/*`): Business logic, components, services
3. **Base** (`packages/base/*`): Shared utilities & components

## File Naming

| Type           | Pattern                  | Example                 |
| -------------- | ------------------------ | ----------------------- |
| Components     | `kebab-case.tsx`         | `broadcast-table.tsx`   |
| Services       | `*-service.ts`           | `broadcast-service.ts`  |
| Entities/Types | `*-entity.ts`            | `broadcast-entity.ts`   |
| Server Actions | `*-action.ts`            | `broadcast-action.ts`   |
| Hooks          | `*-hook.ts` / `use-*.ts` | `use-broadcast-list.ts` |
| Stores         | `*-store.ts`             | `broadcast-store.ts`    |
| Utils          | `*-utils.ts`             | `date-utils.ts`         |

## Import Order (OPTIONAL but recommended for consistency)

```
1. External libraries (react, zustand, dayjs, etc)
2. Next.js imports (next/*, next-nprogress-bar)
3. Base packages (@base/*)
4. Monorepo packages (@front-monorepo/*)
5. Local imports (./*)
6. Assets (*.svg)
```

## Module Structure

```
feature-name/
├── components/
├── services/
│   ├── feature-entity.ts
│   └── feature-service.ts
├── stores/
│   └── feature-store.ts
├── feature-table.tsx
├── feature-form.tsx
```

## Package Exports

When a feature directory contains both `.ts` (hooks, entities, services, actions) and `.tsx` (components) files, they need separate export entries in `package.json`:

```json
"./feature-name/hooks/*": "./src/feature-name/hooks/*.ts",
"./feature-name/*": "./src/feature-name/*.tsx"
```

- `.ts` files → `*.ts` glob
- `.tsx` files → `*.tsx` glob
- This ensures TypeScript resolution works correctly for both file types

## Server vs Client Components

- **Server (default)**: Fetch data directly, no interactivity
- **Client** (`"use client"`): Interactivity, hooks, SWR
- Prefer Server Component, only use client when interactivity is needed

## State Management

- **useState**: Simple local component state
- **useState\<StateType\>**: Multiple related fields in one component
- **useReducer**: Complex state transitions depending on previous state
- **Zustand**: Complex forms, wizards, global UI, cross-component state

### Zustand Store Pattern

REQUIRED: Use `useShallow` for selectors to prevent excessive re-renders. Export `useMyStoreShallow` helper hook.

## UI Components

- All from `@front-monorepo/uikit/*`
- Icons: `@material-design-icons/svg/outlined/*.svg` + `<MDIcon>`
- Custom SVG icons: place in `@base/dashboardkit/icons/` (only when neither Material Icons nor Lucide has the icon)
- Table: `BaseTable` from `@base/table/base-table` (preferred). Use `@front-monorepo/uikit/components/ui/table` for custom tables.
- Form: `BaseForm` from `@base/form/base-form` (except for complex forms)

## Component Classification: Smart vs Dummy

### Definitions

- **Smart Component** — contains business logic, data fetching (SWR/Server Actions), state management, and side effects. Stays in its feature package/app.
- **Dummy Component** (Presentational) — renders UI based on props, no data fetching, no business logic. Receives all data and callbacks via props. MAY contain local UI state (e.g. dropdown open/close, active tab). Designed to be reusable.

### Rules

1. Separate **smart** (app-specific) from **dummy** (presentational) concerns when building a feature.
2. Dummy components MUST be reusable across projects. Name them by **function**, not by feature (e.g. `back-button.tsx`, not `expense-back-button.tsx`).
3. Place reusable dummy components in `@base/dashboardkit` (`packages/base/dashboardkit/src/`).
4. Smart components stay in their feature package/app.
5. Every dummy component in `@base/dashboardkit` MUST have a Storybook story under `stories/`.
6. When writing stories, always wrap the component with the required Providers (e.g. `SidebarProvider`, `ThemeProvider`) in the `decorators` array or `render` function. Without proper context, the story will fail at runtime or render incorrectly.

### DashboardKit Structure

```
packages/base/dashboardkit/src/
├── [component].tsx              # Dummy component
├── stories/
│   └── [component].stories.tsx  # Storybook story
├── icons/
│   └── [icon-name].svg          # Custom SVG icon (only as fallback)
```

### When to Extract to DashboardKit

Extract when:

- Same UI pattern appears in 2+ projects
- No dependency on feature-specific data fetching
- All dynamic data received via props
- Works standalone or with generic context only

## API Integration (Non UMDT Projects)

- REQUIRED: Use Swagger-generated code via `generator-config.js`
- GET → `useGetXxx` hook (SWR)
- POST/PUT/DELETE → `useXxxMutation` hook (SWR mutation)
- Server-side → call `*-service.ts` directly
- DO NOT use manual `fetch()` without type safety

## UMDT Projects

### General

- UMDT project identifier: has `umdt-info.ts` and `umdt-sdk.ts` files — either in `apps/[name]/` or in its paired `packages/[name]/`
- `umdt-info` contains UMDT configuration (app ID, config IDs) from `UMDT_INFO` env
- `umdt-sdk` is a ready-to-use UMDT SDK instance (server-only)
- Prefer `umdt-sdk` for server-side API calls (unless there are limitations requiring another approach)
- Can use shared components/layout/utils from `@dashboard/umdt`
- For **client-side fetching**, prefer the **client SDK hooks** from `@umdt/sdk` directly (GET → SWR hook, POST/PUT/DELETE → `useSWRMutation` hooks)
- If the client SDK hooks don't cover the specific use case, create:
  - Server action (`*-action.ts`) that wraps the `umdt-sdk` call
  - SWR hook (`*-hook.ts`) that calls the action
- Notes — Server Action Query Pattern: Next.js server actions return a Promise to the client. For **mutations** this is fine, but for **queries** (GET), wrapping the action in a `run()` pattern enables parallel execution from the hook:

  ```ts
  // sla-action.ts — server action for query
  export async function getUniqueServices() {
    const run = async () => {
      const response = await umdtSdk
        .from(umdtInfo.configId.slaInfra)
        .limit(1000)
        .execute();
      // ... process data
      return result;
    };
    return { result: run() }; // ← triggers immediately, returns { result: Promise<T> }
  }

  // sla-hook.ts — SWR hook calling the action
  export function useUniqueServices() {
    return useSWR("key", async () => {
      const response = await getUniqueServices();
      return await response.result; // ← await the inner promise
    });
  }
  ```

- BFF proxy via API route (`/api/umdt/[...all]`) is a **last resort**

### Paired Project

(e.g. `apps/internalkit-web/` + `packages/internalkit/`)

- `umdt-info.ts` and `umdt-sdk.ts` MUST reside in `packages/[name]/src/`, not in `apps/[name]/`
- ALL features (components, services, stores, hooks, actions, etc.) MUST be created inside `packages/[name]/src/`, NOT in the app. The app should only contain Next.js routes/pages that import from the package.

### Standalone (Non-Paired)

(e.g. `apps/testcase-dashboard-web/` without a paired package)

- Place all code in `apps/[name]/app/components/`

### Filtering Strategy for Data Pages

- When creating a page that displays tabular/list data, filtering SHOULD use `searchParams` (URL query params) as the primary mechanism — this enables shareable/bookmarkable URLs, browser back/forward, and SSR compatibility.
- If `searchParams` is not feasible (e.g. complex filter UI with debounced input, or filters that change too rapidly), use **internal component state** (`useState`/`useReducer`) instead.
- Do NOT use Zustand or other global stores for page-level filter state unless the filter state must be shared across unrelated routes.
- **Pattern**: Server Component reads `searchParams` → passes `initialFilters` object → Client Component initializes state from it and syncs changes back to URL:

  ```tsx
  // page.tsx (server)
  type PageProps = { searchParams: Promise<{ search?: string; category?: string; ... }> };
  export default async function Page(props: PageProps) {
    const params = await props.searchParams;
    return <ClientComponent initialFilters={{ search: params.search, ... }} />;
  }

  // client-component.tsx ("use client")
  export function ClientComponent({ initialFilters = {} }: { initialFilters?: InitialFilters }) {
    const { search: initialSearch, ... } = initialFilters;
    const router = useRouter();
    const pathname = usePathname();
    const [params, setParams] = useState<ExpenseListParams>({ page: 1, limit: 10, ...initialFilters });

    // Sync to URL on filter change
    const syncToUrl = (p: Params) => { router.replace(`${pathname}?${qs}`, { scroll: false }); };

    // Sync state back when URL changes (browser back/forward)
    useEffect(() => { setParams(prev => ({ ...prev, ...initialFilters })); }, [initialFilters]);
  }
  ```

## Best Practices

- Prefer Server Components & Server Actions over client-side JavaScript
- Colocate related files within 1 feature folder
- Type everything, no `any`
- Use `useShallow` for Zustand selectors
- Loading & error states must always be handled
- Naming: PascalCase (Components/Types), camelCase (Functions), kebab-case (Files), UPPER_SNAKE_CASE (Constants)
- Validate forms in Zustand stores with `validateForm`
- Handle loading/error states: `if (isLoading) return <Skeleton />; if (error) return <ErrorMessage />;`

## E2E Testing (Playwright)

- When writing E2E tests, first check whether the target component already has `data-testid` attributes. If not, add them before writing test locators.
- Adding `data-testid` should not break existing functionality or cause rendering errors.
- Each `data-testid` value must be unique within the page. Use naming convention aligned with the component/feature name (e.g. `data-testid="broadcast-table"`, `data-testid="submit-button"`).
- Use Playwright MCP to verify locators work correctly and there are no conflicts.

## Common Commands

```bash
npm install              # Install dependencies
npm run chat-dashboard   # Run app (port 4010)
npm run build            # Production build
npm run lint             # Lint
npm run format           # Format code
npm run chat-dashboard:swagger  # Generate from Swagger
```

## Quick Reference

- Branch naming: follow TurboRepo conventions
- API proxy: Client → `/api/everpro/crm/*` → Server → `/everpro/crm/*` → Backend
- Package exports: use `exports` field in `package.json` with `"./feature": "./src/feature/index.ts"` pattern
- Inter font: use `"Semi Bold"` (space), not `"SemiBold"`
