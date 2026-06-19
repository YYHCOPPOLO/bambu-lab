import { onScopeDispose, ref } from 'vue'

/**
 * Transient notice message that auto-clears after a timeout.
 * Replaces the per-component showNotice timer logic.
 */
export function useNotice(timeout = 2800) {
  const notice = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function showNotice(message: string): void {
    notice.value = message

    if (timer)
      clearTimeout(timer)

    timer = setTimeout(() => {
      if (notice.value === message)
        notice.value = null

      timer = null
    }, timeout)
  }

  onScopeDispose(() => {
    if (timer)
      clearTimeout(timer)
  })

  return { notice, showNotice }
}
