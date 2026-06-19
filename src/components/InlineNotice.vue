<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  variant?: 'success' | 'destructive'
  class?: HTMLAttributes['class']
}>()

const surface = {
  success: 'surface-success',
  destructive: 'surface-destructive',
} as const
</script>

<template>
  <div
    :class="cn(
      'rounded-md border px-3 py-2 text-sm',
      surface[props.variant ?? 'success'],
      props.class,
    )"
    role="status"
  >
    <slot />
  </div>
</template>
