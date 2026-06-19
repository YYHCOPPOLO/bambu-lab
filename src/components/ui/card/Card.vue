<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'bg-card text-card-foreground flex flex-col gap-5 rounded-md border py-5 shadow-sm transition-colors duration-200 hover:border-primary/40',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
