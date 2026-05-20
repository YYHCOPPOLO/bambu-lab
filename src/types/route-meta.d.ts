import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    layout?: string | false
    requiresAuth?: boolean
  }
}
